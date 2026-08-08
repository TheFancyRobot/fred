import { Context, Effect, Layer, Option, Redacted, Schema } from 'effect';
import {
  ProviderConnectionCredentialsSchema,
  ProviderConnectionSchema,
  ProviderConnectionStore,
  ProviderConnectionStoreError,
  type ProviderConnection,
  type ProviderConnectionCredentials,
  type ProviderConnectionId,
  type ProviderConnectionStore as ProviderConnectionStoreService,
} from '@fancyrobot/fred';
import { Pool } from 'pg';
import {
  DEFAULT_POSTGRES_SCHEMA,
  fredPostgresTable,
  type FredPostgres,
  type FredPostgresMigration,
  type PostgresClient,
  type PostgresPool,
} from './postgres';
import {
  ProviderConnectionStorageError,
  ProviderCredentialEncryptionError,
  ProviderCredentialKeyError,
  ProviderCredentialVersionConflictError,
} from './errors';

const ENVELOPE_VERSION = 1;
const ENVELOPE_ALGORITHM = 'AES-256-GCM';
const AES_256_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;

export interface ProviderCredentialKey {
  readonly id: string;
  readonly key: Redacted.Redacted<Uint8Array>;
}

/** Application-owned key material. Fred stores only its identifier on each envelope. */
export interface ProviderCredentialKeyRingService {
  readonly current: Effect.Effect<ProviderCredentialKey, ProviderCredentialKeyError>;
  readonly get: (keyId: string) => Effect.Effect<Option.Option<ProviderCredentialKey>, ProviderCredentialKeyError>;
}

export const ProviderCredentialKeyRing = Context.GenericTag<ProviderCredentialKeyRingService>(
  '@fancyrobot/fred-postgres/ProviderCredentialKeyRing',
);

export const makeProviderCredentialKeyRing = (
  keys: readonly ProviderCredentialKey[],
  currentKeyId: string,
): ProviderCredentialKeyRingService => {
  const values = new Map(keys.map((key) => [key.id, key]));
  const invalid = (keyId: string, message: string) =>
    Effect.fail(new ProviderCredentialKeyError({ keyId, message }));
  const current = values.get(currentKeyId);
  return {
    current: current === undefined
      ? invalid(currentKeyId, 'The configured current provider credential key is unavailable.')
      : Effect.succeed(current),
    get: (keyId) => Effect.succeed(Option.fromNullable(values.get(keyId))),
  };
};

export interface ProviderCredentialEnvelope {
  readonly version: typeof ENVELOPE_VERSION;
  readonly algorithm: typeof ENVELOPE_ALGORITHM;
  readonly keyId: string;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface ProviderCredentialCryptoInput {
  readonly connection: Pick<ProviderConnection, 'id' | 'providerId' | 'auth'>;
  readonly credentials: ProviderConnectionCredentials;
  readonly key: ProviderCredentialKey;
}

const text = new TextEncoder();

const arrayBuffer = (value: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};

const encryptionError = (connectionId: string, message: string) =>
  new ProviderCredentialEncryptionError({ connectionId, message });

const keyMaterial = (key: ProviderCredentialKey): Effect.Effect<Uint8Array, ProviderCredentialKeyError> =>
  Effect.try({
    try: () => {
      const material = Redacted.value(key.key);
      if (!key.id || material.byteLength !== AES_256_KEY_BYTES) {
        throw new Error('invalid provider credential key');
      }
      return material;
    },
    catch: () => new ProviderCredentialKeyError({
      keyId: key.id,
      message: 'Provider credential keys must have a non-empty id and contain exactly 32 bytes.',
    }),
  });

const credentialPayload = (credentials: ProviderConnectionCredentials): Record<string, string | undefined> => {
  switch (credentials.kind) {
    case 'none':
      return { kind: credentials.kind };
    case 'api-key':
      return { kind: credentials.kind, apiKey: Redacted.value(credentials.apiKey) };
    case 'basic':
      return {
        kind: credentials.kind,
        username: Redacted.value(credentials.username),
        password: Redacted.value(credentials.password),
      };
    case 'oauth2-bearer':
      return {
        kind: credentials.kind,
        accessToken: Redacted.value(credentials.accessToken),
        refreshToken: credentials.refreshToken === undefined ? undefined : Redacted.value(credentials.refreshToken),
      };
  }
};

const aad = (connection: Pick<ProviderConnection, 'id' | 'providerId' | 'auth'>): Uint8Array =>
  text.encode(JSON.stringify({ version: ENVELOPE_VERSION, connectionId: connection.id, providerId: connection.providerId, auth: connection.auth.kind }));

const assertCredentialKind = (connection: Pick<ProviderConnection, 'id' | 'auth'>, credentials: ProviderConnectionCredentials) =>
  credentials.kind === connection.auth.kind
    ? Effect.void
    : Effect.fail(encryptionError(connection.id, 'Credential kind does not match the connection authentication method.'));

/** Encrypt runtime-only credentials using a fresh AES-GCM nonce and bound AAD. */
export const encryptProviderCredentials = (
  input: ProviderCredentialCryptoInput,
): Effect.Effect<ProviderCredentialEnvelope, ProviderCredentialKeyError | ProviderCredentialEncryptionError> =>
  Effect.gen(function* () {
    yield* assertCredentialKind(input.connection, input.credentials);
    const material = yield* keyMaterial(input.key);
    const nonce = crypto.getRandomValues(new Uint8Array(GCM_NONCE_BYTES));
    const ciphertext = yield* Effect.tryPromise({
      try: async () => {
        const key = await crypto.subtle.importKey('raw', arrayBuffer(material), { name: 'AES-GCM' }, false, ['encrypt']);
        const plaintext = text.encode(JSON.stringify(credentialPayload(input.credentials)));
        return new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: arrayBuffer(nonce), additionalData: arrayBuffer(aad(input.connection)) }, key, arrayBuffer(plaintext)));
      },
      catch: () => encryptionError(input.connection.id, 'Unable to encrypt provider credentials.'),
    });
    return { version: ENVELOPE_VERSION, algorithm: ENVELOPE_ALGORITHM, keyId: input.key.id, nonce, ciphertext };
  });

/** Decrypt and schema-validate a credential envelope without exposing its plaintext in errors. */
export const decryptProviderCredentials = (
  connection: Pick<ProviderConnection, 'id' | 'providerId' | 'auth'>,
  envelope: ProviderCredentialEnvelope,
  key: ProviderCredentialKey,
): Effect.Effect<ProviderConnectionCredentials, ProviderCredentialKeyError | ProviderCredentialEncryptionError> =>
  Effect.gen(function* () {
    if (envelope.version !== ENVELOPE_VERSION || envelope.algorithm !== ENVELOPE_ALGORITHM || envelope.nonce.byteLength !== GCM_NONCE_BYTES) {
      return yield* encryptionError(connection.id, 'Provider credential envelope is invalid.');
    }
    const material = yield* keyMaterial(key);
    const plaintext = yield* Effect.tryPromise({
      try: async () => {
        const cryptoKey = await crypto.subtle.importKey('raw', arrayBuffer(material), { name: 'AES-GCM' }, false, ['decrypt']);
        return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: arrayBuffer(envelope.nonce), additionalData: arrayBuffer(aad(connection)) }, cryptoKey, arrayBuffer(envelope.ciphertext)));
      },
      catch: () => encryptionError(connection.id, 'Provider credential envelope could not be authenticated.'),
    });
    return yield* Effect.try({
      try: () => {
        const credentials = Schema.decodeUnknownSync(ProviderConnectionCredentialsSchema)(JSON.parse(new TextDecoder().decode(plaintext)));
        if (credentials.kind !== connection.auth.kind) throw new Error('credential kind mismatch');
        return credentials;
      },
      catch: () => encryptionError(connection.id, 'Provider credential envelope contains an invalid payload.'),
    });
  });

export interface ProviderConnectionStorageOptions {
  readonly connectionString?: string;
  readonly pool?: PostgresPool;
  readonly schema?: string;
  readonly keyRing: ProviderCredentialKeyRingService;
}

export interface ProviderConnectionStorageLayerOptions {
  readonly connectionString?: string;
  readonly pool?: PostgresPool;
  readonly schema?: string;
}

export interface ProviderConnectionMetadata {
  readonly connection: ProviderConnection;
  readonly credentialVersion: number;
  readonly expiresAt: Date | undefined;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PostgresProviderConnectionStore extends ProviderConnectionStoreService {
  readonly close: Effect.Effect<void, ProviderConnectionStorageError>;
  readonly save: (
    connection: ProviderConnection,
    credentials: ProviderConnectionCredentials,
    expiresAt?: Date,
  ) => Effect.Effect<void, ProviderCredentialKeyError | ProviderCredentialEncryptionError | ProviderCredentialVersionConflictError | ProviderConnectionStorageError>;
  readonly getMetadata: (id: ProviderConnectionId) => Effect.Effect<Option.Option<ProviderConnectionMetadata>, ProviderConnectionStorageError>;
  readonly compareAndSetCredentials: (
    id: ProviderConnectionId,
    credentials: ProviderConnectionCredentials,
    expectedVersion: number,
    expiresAt?: Date,
  ) => Effect.Effect<boolean, ProviderCredentialKeyError | ProviderCredentialEncryptionError | ProviderConnectionStorageError>;
  readonly rotateCredentials: (
    batchSize?: number,
  ) => Effect.Effect<{ readonly rotated: number; readonly remaining: boolean }, ProviderCredentialKeyError | ProviderCredentialEncryptionError | ProviderConnectionStorageError>;
}

const storageError = (operation: string) =>
  new ProviderConnectionStorageError({ operation, message: 'Provider connection storage operation failed.' });

const storeError = (operation: string) =>
  new ProviderConnectionStoreError({ operation, message: 'Provider connection storage operation failed.' });

const asStoreError = <A, E>(operation: string, effect: Effect.Effect<A, E>) =>
  effect.pipe(Effect.mapError(() => storeError(operation)));

const operation = <A>(name: string, run: () => Promise<A>): Effect.Effect<A, ProviderConnectionStorageError> =>
  Effect.tryPromise({ try: run, catch: () => storageError(name) });

const useClient = <A, E>(
  pool: PostgresPool,
  use: (client: PostgresClient) => Effect.Effect<A, E>,
): Effect.Effect<A, E | ProviderConnectionStorageError> =>
  Effect.acquireUseRelease(operation('connect', () => pool.connect()), use, (client) => Effect.sync(() => client.release()));

const query = (client: PostgresClient, name: string, sql: string, values?: unknown[]) =>
  operation(name, () => client.query(sql, values));

const transaction = <A, E>(pool: PostgresPool, use: (client: PostgresClient) => Effect.Effect<A, E | ProviderConnectionStorageError>) =>
  useClient(pool, (client) =>
    Effect.gen(function* () {
      yield* query(client, 'begin', 'BEGIN');
      return yield* use(client).pipe(
        Effect.tap(() => query(client, 'commit', 'COMMIT')),
        Effect.catchAll((error) => query(client, 'rollback', 'ROLLBACK').pipe(Effect.ignore, Effect.zipRight(Effect.fail(error)))),
      );
    }),
  );

const readString = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new Error(`invalid ${name}`);
  return value;
};

const readDate = (value: unknown, name: string): Date => {
  const date = value instanceof Date ? value : new Date(readString(value, name));
  if (Number.isNaN(date.valueOf())) throw new Error(`invalid ${name}`);
  return date;
};

const readVersion = (value: unknown): number => {
  const version = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error('invalid credential version');
  return version;
};

const bytes = (value: unknown, name: string): Uint8Array => {
  if (!(value instanceof Uint8Array)) throw new Error(`invalid ${name}`);
  return new Uint8Array(value);
};

const metadata = (row: Record<string, unknown>): ProviderConnectionMetadata => {
  const connection = Schema.decodeUnknownSync(ProviderConnectionSchema)({
    id: readString(row.id, 'connection id'),
    label: readString(row.label, 'label'),
    providerId: readString(row.provider_id, 'provider id'),
    endpoint: row.endpoint === null ? undefined : readString(row.endpoint, 'endpoint'),
    protocol: row.protocol === null ? undefined : readString(row.protocol, 'protocol'),
    auth: { kind: readString(row.auth_kind, 'authentication method') },
    status: readString(row.status, 'status'),
  });
  return {
    connection,
    credentialVersion: readVersion(row.credential_version),
    expiresAt: row.expires_at === null || row.expires_at === undefined ? undefined : readDate(row.expires_at, 'expires at'),
    createdAt: readDate(row.created_at, 'created at'),
    updatedAt: readDate(row.updated_at, 'updated at'),
  };
};

const parseMetadata = (row: Record<string, unknown>) => Effect.try({
  try: () => metadata(row),
  catch: () => storageError('decodeMetadata'),
});

const envelope = (connectionId: string, row: Record<string, unknown>): Effect.Effect<ProviderCredentialEnvelope, ProviderCredentialEncryptionError> =>
  Effect.try({
    try: () => {
      const version = readVersion(row.envelope_version);
      const algorithm = readString(row.algorithm, 'algorithm');
      const keyId = readString(row.key_id, 'key id');
      const nonce = bytes(row.nonce, 'nonce');
      const ciphertext = bytes(row.ciphertext, 'ciphertext');
      if (version !== ENVELOPE_VERSION || algorithm !== ENVELOPE_ALGORITHM || !keyId || nonce.byteLength !== GCM_NONCE_BYTES || ciphertext.byteLength === 0) {
        throw new Error('invalid credential envelope');
      }
      return { version: ENVELOPE_VERSION, algorithm: ENVELOPE_ALGORITHM, keyId, nonce, ciphertext };
    },
    catch: () => encryptionError(connectionId, 'Provider credential envelope is invalid.'),
  });

const keyForEnvelope = (
  ring: ProviderCredentialKeyRingService,
  keyId: string,
): Effect.Effect<ProviderCredentialKey, ProviderCredentialKeyError> =>
  ring.get(keyId).pipe(
    Effect.flatMap(Option.match({
      onNone: () => Effect.fail(new ProviderCredentialKeyError({ keyId, message: 'Provider credential key is unavailable.' })),
      onSome: Effect.succeed,
    })),
  );

const labelKey = (label: string): Effect.Effect<string, ProviderConnectionStorageError> =>
  Effect.try({
    try: () => {
      const normalized = label.trim().toLocaleLowerCase();
      if (!normalized) throw new Error('empty label');
      return normalized;
    },
    catch: () => new ProviderConnectionStorageError({ operation: 'validateLabel', message: 'Provider connection labels must not be empty.' }),
  });

export const fredPostgresProviderConnectionMigrations = (
  schema = DEFAULT_POSTGRES_SCHEMA,
): readonly FredPostgresMigration[] => {
  const connections = fredPostgresTable(schema, 'provider_connections');
  const credentials = fredPostgresTable(schema, 'provider_credentials');
  return [{
    module: 'provider-connections',
    version: 1,
    checksum: 'fred-provider-connections-v1',
    sql: `
CREATE TABLE ${connections} (
  id UUID PRIMARY KEY,
  provider_id TEXT NOT NULL,
  label TEXT NOT NULL,
  label_normalized TEXT NOT NULL,
  endpoint TEXT,
  protocol TEXT,
  auth_kind TEXT NOT NULL CHECK (auth_kind IN ('none', 'api-key', 'basic', 'oauth2-bearer')),
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'deleted')),
  credential_version BIGINT NOT NULL DEFAULT 1 CHECK (credential_version >= 1),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider_id, label_normalized)
);
CREATE INDEX idx_provider_connections_provider_status ON ${connections} (provider_id, status);
CREATE TABLE ${credentials} (
  connection_id UUID PRIMARY KEY REFERENCES ${connections}(id) ON DELETE CASCADE,
  envelope_version SMALLINT NOT NULL CHECK (envelope_version = 1),
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  key_id TEXT NOT NULL,
  nonce BYTEA NOT NULL CHECK (octet_length(nonce) = 12),
  ciphertext BYTEA NOT NULL CHECK (octet_length(ciphertext) > 16),
  credential_version BIGINT NOT NULL CHECK (credential_version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`,
  }];
};

/** Apply the provider-connection schema explicitly before constructing its store. */
export const migrateFredPostgresProviderConnections = (database: FredPostgres) =>
  database.diagnostics.pipe(
    Effect.flatMap(({ schema }) => database.migrate(fredPostgresProviderConnectionMigrations(schema))),
  );

const metadataColumns = 'id, label, provider_id, endpoint, protocol, auth_kind, status, credential_version, expires_at, created_at, updated_at';

/**
 * Create the Postgres implementation of Fred's connection-store boundary.
 * Callers must run `migrateFredPostgresProviderConnections` first; runtime methods never issue DDL.
 */
export const makePostgresProviderConnectionStore = (
  options: ProviderConnectionStorageOptions,
): PostgresProviderConnectionStore => {
  if (options.pool !== undefined && options.connectionString !== undefined) {
    throw new Error('Provider connection storage accepts either connectionString or pool, not both.');
  }
  if (options.pool === undefined && options.connectionString === undefined) {
    throw new Error('Provider connection storage requires a connectionString or pool.');
  }
  const pool = options.pool ?? new Pool({ connectionString: options.connectionString });
  const ownsPool = options.pool === undefined;
  const connections = fredPostgresTable(options.schema ?? DEFAULT_POSTGRES_SCHEMA, 'provider_connections');
  const credentials = fredPostgresTable(options.schema ?? DEFAULT_POSTGRES_SCHEMA, 'provider_credentials');

  const getMetadata = (id: ProviderConnectionId) => useClient(pool, (client) =>
    query(client, 'getMetadata', `SELECT ${metadataColumns} FROM ${connections} WHERE id = $1`, [id]).pipe(
      Effect.flatMap((result) => result.rows[0] === undefined
        ? Effect.succeed(Option.none())
        : parseMetadata(result.rows[0]).pipe(Effect.map(Option.some))),
    ));

  const get = (id: ProviderConnectionId) => asStoreError('get', useClient(pool, (client) =>
    query(client, 'get', `SELECT c.${metadataColumns.replaceAll(', ', ', c.')}, k.envelope_version, k.algorithm, k.key_id, k.nonce, k.ciphertext FROM ${connections} c JOIN ${credentials} k ON k.connection_id = c.id WHERE c.id = $1`, [id]).pipe(
      Effect.flatMap((result) => {
        const row = result.rows[0];
        if (row === undefined) return Effect.succeed(Option.none());
        return Effect.gen(function* () {
          const saved = yield* parseMetadata(row);
          const encrypted = yield* envelope(saved.connection.id, row);
          const key = yield* keyForEnvelope(options.keyRing, encrypted.keyId);
          const runtimeCredentials = yield* decryptProviderCredentials(saved.connection, encrypted, key);
          return Option.some({ connection: saved.connection, credentials: runtimeCredentials });
        });
      }),
    )));

  const writeEnvelope = (
    client: PostgresClient,
    connection: ProviderConnection,
    encrypted: ProviderCredentialEnvelope,
    expectedVersion: number,
    labelNormalized: string,
    expiresAt?: Date,
  ) => Effect.gen(function* () {
    const nextVersion = expectedVersion + 1;
    const updated = yield* query(
      client,
      'updateConnection',
      `UPDATE ${connections}
       SET provider_id = $2, label = $3, label_normalized = $4, endpoint = $5, protocol = $6, auth_kind = $7, status = $8,
           credential_version = $9, expires_at = COALESCE($10, expires_at), updated_at = NOW()
       WHERE id = $1 AND credential_version = $11`,
      [connection.id, connection.providerId, connection.label, labelNormalized, connection.endpoint ?? null, connection.protocol ?? null, connection.auth.kind, connection.status, nextVersion, expiresAt ?? null, expectedVersion],
    );
    if (updated.rowCount !== 1) {
      return yield* new ProviderCredentialVersionConflictError({
        connectionId: connection.id,
        expectedVersion,
        message: 'Provider credential version changed before the update could be committed.',
      });
    }
    const saved = yield* query(
      client,
      'updateCredential',
      `UPDATE ${credentials}
       SET envelope_version = $2, algorithm = $3, key_id = $4, nonce = $5, ciphertext = $6, credential_version = $7, updated_at = NOW()
       WHERE connection_id = $1 AND credential_version = $8`,
      [connection.id, encrypted.version, encrypted.algorithm, encrypted.keyId, encrypted.nonce, encrypted.ciphertext, nextVersion, expectedVersion],
    );
    if (saved.rowCount !== 1) {
      return yield* new ProviderCredentialVersionConflictError({
        connectionId: connection.id,
        expectedVersion,
        message: 'Provider credential version changed before the update could be committed.',
      });
    }
  });

  const save: PostgresProviderConnectionStore['save'] = (connection, runtimeCredentials, expiresAt) => Effect.gen(function* () {
    const normalized = yield* labelKey(connection.label);
    const key = yield* options.keyRing.current;
    const encrypted = yield* encryptProviderCredentials({ connection, credentials: runtimeCredentials, key });
    yield* transaction(pool, (client) => Effect.gen(function* () {
      const existing = yield* query(client, 'lockConnection', `SELECT credential_version FROM ${connections} WHERE id = $1 FOR UPDATE`, [connection.id]);
      const row = existing.rows[0];
      if (row === undefined) {
        yield* query(
          client,
          'insertConnection',
          `INSERT INTO ${connections} (id, provider_id, label, label_normalized, endpoint, protocol, auth_kind, status, credential_version, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, $9)`,
          [connection.id, connection.providerId, connection.label, normalized, connection.endpoint ?? null, connection.protocol ?? null, connection.auth.kind, connection.status, expiresAt ?? null],
        );
        yield* query(
          client,
          'insertCredential',
          `INSERT INTO ${credentials} (connection_id, envelope_version, algorithm, key_id, nonce, ciphertext, credential_version)
           VALUES ($1, $2, $3, $4, $5, $6, 1)`,
          [connection.id, encrypted.version, encrypted.algorithm, encrypted.keyId, encrypted.nonce, encrypted.ciphertext],
        );
        return;
      }
      yield* writeEnvelope(client, connection, encrypted, readVersion(row.credential_version), normalized, expiresAt);
    }));
  });

  const put: PostgresProviderConnectionStore['put'] = (record) => asStoreError('put', save(record.connection, record.credentials));

  const remove = (id: ProviderConnectionId) => asStoreError('remove', transaction(pool, (client) =>
    query(client, 'deleteConnection', `DELETE FROM ${connections} WHERE id = $1`, [id]).pipe(
      Effect.map((result) => result.rowCount === 1),
    )));

  const compareAndSetCredentials = (
    id: ProviderConnectionId,
    runtimeCredentials: ProviderConnectionCredentials,
    expectedVersion: number,
    expiresAt?: Date,
  ) => Effect.gen(function* () {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
      return false;
    }
    const current = yield* getMetadata(id);
    if (Option.isNone(current) || current.value.credentialVersion !== expectedVersion) return false;
    const key = yield* options.keyRing.current;
    const encrypted = yield* encryptProviderCredentials({ connection: current.value.connection, credentials: runtimeCredentials, key });
    const updated = yield* transaction(pool, (client) =>
      writeEnvelope(client, current.value.connection, encrypted, expectedVersion, current.value.connection.label.trim().toLocaleLowerCase(), expiresAt).pipe(
        Effect.as(true),
        Effect.catchTag('ProviderCredentialVersionConflictError', () => Effect.succeed(false)),
      ));
    return updated;
  });

  const rotateCredentials = (batchSize = 100) => Effect.gen(function* () {
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 1_000) {
      return yield* new ProviderConnectionStorageError({ operation: 'rotateCredentials', message: 'batchSize must be an integer from 1 through 1000.' });
    }
    const currentKey = yield* options.keyRing.current;
    const rows = yield* useClient(pool, (client) => query(
      client,
      'listCredentialRotationBatch',
      `SELECT c.${metadataColumns.replaceAll(', ', ', c.')}, k.envelope_version, k.algorithm, k.key_id, k.nonce, k.ciphertext
       FROM ${connections} c JOIN ${credentials} k ON k.connection_id = c.id
       WHERE k.key_id <> $1 ORDER BY c.updated_at, c.id LIMIT $2`,
      [currentKey.id, batchSize],
    ));
    let rotated = 0;
    for (const row of rows.rows) {
      const saved = yield* parseMetadata(row);
      const oldEnvelope = yield* envelope(saved.connection.id, row);
      const oldKey = yield* keyForEnvelope(options.keyRing, oldEnvelope.keyId);
      const runtimeCredentials = yield* decryptProviderCredentials(saved.connection, oldEnvelope, oldKey);
      const nextEnvelope = yield* encryptProviderCredentials({ connection: saved.connection, credentials: runtimeCredentials, key: currentKey });
      const updated = yield* transaction(pool, (client) =>
        writeEnvelope(client, saved.connection, nextEnvelope, saved.credentialVersion, saved.connection.label.trim().toLocaleLowerCase()).pipe(
          Effect.as(true),
          Effect.catchTag('ProviderCredentialVersionConflictError', () => Effect.succeed(false)),
        ));
      if (updated) rotated += 1;
    }
    return { rotated, remaining: rows.rows.length === batchSize };
  });

  const end = pool.end;
  const close = ownsPool && end !== undefined ? operation('close', end) : Effect.void;

  return { list: () => asStoreError('list', useClient(pool, (client) =>
    query(client, 'list', `SELECT ${metadataColumns} FROM ${connections} ORDER BY provider_id, label_normalized`).pipe(
      Effect.flatMap((result) => Effect.forEach(result.rows, parseMetadata).pipe(Effect.map((records) => records.map((record) => record.connection)))),
    ))), get, put, remove, close, save, getMetadata, compareAndSetCredentials, rotateCredentials };
};

/** Compose the Postgres store under the core persistence boundary using an injected key ring. */
export const makePostgresProviderConnectionStoreLayer = (options: ProviderConnectionStorageLayerOptions) =>
  Layer.effect(
    ProviderConnectionStore,
    Effect.map(ProviderCredentialKeyRing, (keyRing) => makePostgresProviderConnectionStore({ ...options, keyRing })),
  );
