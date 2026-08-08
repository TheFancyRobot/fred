import { Database } from 'bun:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import { Context, Effect, Layer, Option, Schema } from 'effect';
import { DEFAULT_POSTGRES_SCHEMA, fredPostgresTable } from '@fancyrobot/fred-postgres';
import {
  API_KEY_VERIFIER_IDS,
  ApiKeyVerifierDescriptor,
  LEGACY_SHA256_DESCRIPTOR,
  makeDefaultApiKeyVerifierRegistry,
  type ApiKeyVerifierConfigurationError,
  type ApiKeyVerifierOperationError,
  type ApiKeyVerifierRegistryService,
} from './api-key-verifiers';

export const API_KEY_TABLE = 'fred_api_keys';
export const API_KEY_TOKEN_PREFIX = 'fred';

export const ApiKeyRateLimit = Schema.Struct({
  maxRequests: Schema.Number.pipe(Schema.int(), Schema.positive()),
  windowMs: Schema.Number.pipe(Schema.int(), Schema.positive()),
});
export type ApiKeyRateLimit = typeof ApiKeyRateLimit.Type;

export const ApiKeyRecord = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{8,64}$/)),
  hash: Schema.String.pipe(Schema.minLength(32), Schema.maxLength(512)),
  verifier: Schema.optionalWith(ApiKeyVerifierDescriptor, {
    default: () => LEGACY_SHA256_DESCRIPTOR,
  }),
  scopes: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  rateLimit: Schema.OptionFromNullOr(ApiKeyRateLimit),
  revoked: Schema.Boolean,
  expiresAt: Schema.optionalWith(Schema.OptionFromNullOr(Schema.DateFromString), {
    default: () => Option.none<Date>(),
  }),
  createdAt: Schema.DateFromString,
});
export type ApiKeyRecord = typeof ApiKeyRecord.Type;

export interface AuthenticatedApiKeyIdentity {
  readonly id: string;
  readonly scopes: readonly string[];
  readonly rateLimit: Option.Option<ApiKeyRateLimit>;
}

export class ApiKeyStoreError extends Schema.TaggedError<ApiKeyStoreError>()(
  'ApiKeyStoreError',
  { operation: Schema.String, message: Schema.String },
) {}

export class ApiKeyDuplicateIdError extends Schema.TaggedError<ApiKeyDuplicateIdError>()(
  'ApiKeyDuplicateIdError',
  { id: Schema.String, message: Schema.String },
) {}

export class ApiKeyAuthenticationError extends Schema.TaggedError<ApiKeyAuthenticationError>()(
  'ApiKeyAuthenticationError',
  {
    reason: Schema.Literal('absent', 'malformed', 'unknown', 'mismatch', 'revoked', 'expired', 'verifier'),
    message: Schema.String,
  },
) {}

export class ApiKeyScopeError extends Schema.TaggedError<ApiKeyScopeError>()(
  'ApiKeyScopeError',
  { keyId: Schema.String, missingScopes: Schema.Array(Schema.String), message: Schema.String },
) {}

export class ApiKeyGenerationError extends Schema.TaggedError<ApiKeyGenerationError>()(
  'ApiKeyGenerationError',
  { message: Schema.String },
) {}

export interface ApiKeyStoreService {
  readonly backend: 'memory' | 'sqlite' | 'postgres';
  readonly initialize: Effect.Effect<void, ApiKeyStoreError>;
  readonly findById: (id: string) => Effect.Effect<Option.Option<ApiKeyRecord>, ApiKeyStoreError>;
  readonly insert: (record: ApiKeyRecord) => Effect.Effect<void, ApiKeyStoreError | ApiKeyDuplicateIdError>;
  readonly revoke: (id: string) => Effect.Effect<boolean, ApiKeyStoreError>;
  readonly compareAndSwapVerifier: (
    id: string,
    expectedHash: string,
    replacement: Pick<ApiKeyRecord, 'hash' | 'verifier'>,
  ) => Effect.Effect<boolean, ApiKeyStoreError>;
}

export class ApiKeyStore extends Context.Tag('@fancyrobot/fred-http/ApiKeyStore')<
  ApiKeyStore,
  ApiKeyStoreService
>() {}

export class AuthenticatedApiKey extends Context.Reference<AuthenticatedApiKey>()(
  '@fancyrobot/fred-http/AuthenticatedApiKey',
  { defaultValue: () => Option.none<AuthenticatedApiKeyIdentity>() },
) {}

export interface ApiKeyAuthorizationService {
  readonly authorize: (
    authorization: string | undefined,
    requiredScopes?: readonly string[],
  ) => Effect.Effect<
    AuthenticatedApiKeyIdentity,
    ApiKeyStoreError | ApiKeyAuthenticationError | ApiKeyScopeError | ApiKeyVerifierConfigurationError | ApiKeyVerifierOperationError
  >;
}

export class ApiKeyAuthorization extends Context.Tag('@fancyrobot/fred-http/ApiKeyAuthorization')<
  ApiKeyAuthorization,
  ApiKeyAuthorizationService
>() {}

const storeFailure = (operation: string, cause: unknown) => new ApiKeyStoreError({
  operation,
  message: cause instanceof Error ? cause.message : String(cause),
});

const duplicate = (id: string) => new ApiKeyDuplicateIdError({
  id,
  message: `An API key with id "${id}" already exists`,
});

const parseRecord = (value: unknown): Effect.Effect<ApiKeyRecord, ApiKeyStoreError> =>
  Schema.decodeUnknown(ApiKeyRecord)(value).pipe(
    Effect.mapError((cause) => storeFailure('decode', cause)),
  );

export const makeMemoryApiKeyStore = (): ApiKeyStoreService => {
  const records = new Map<string, ApiKeyRecord>();
  return {
    backend: 'memory',
    initialize: Effect.void,
    findById: (id) => Effect.succeed(Option.fromNullable(records.get(id))),
    insert: (record) => Effect.suspend(() => {
      if (records.has(record.id)) return Effect.fail(duplicate(record.id));
      records.set(record.id, record);
      return Effect.void;
    }),
    revoke: (id) => Effect.sync(() => {
      const record = records.get(id);
      if (!record) return false;
      records.set(id, { ...record, revoked: true });
      return true;
    }),
    compareAndSwapVerifier: (id, expectedHash, replacement) => Effect.sync(() => {
      const record = records.get(id);
      if (record === undefined || record.hash !== expectedHash || record.revoked) return false;
      records.set(id, { ...record, ...replacement });
      return true;
    }),
  };
};

export const ApiKeyStoreMemory = Layer.sync(ApiKeyStore, makeMemoryApiKeyStore);

const SQLITE_DDL = `CREATE TABLE IF NOT EXISTS ${API_KEY_TABLE} (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  rate_limit TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  verifier_id TEXT,
  verifier_version INTEGER,
  verifier_metadata TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
)`;

const SQLITE_ADDITIVE_COLUMNS = [
  ['verifier_id', 'TEXT'],
  ['verifier_version', 'INTEGER'],
  ['verifier_metadata', 'TEXT'],
  ['expires_at', 'TEXT'],
] as const;

interface SqliteApiKeyRow {
  readonly id: string;
  readonly hash: string;
  readonly scopes: string;
  readonly rate_limit: string | null;
  readonly revoked: number;
  readonly verifier_id: string | null;
  readonly verifier_version: number | null;
  readonly verifier_metadata: string | null;
  readonly expires_at: string | null;
  readonly created_at: string;
}

const sqliteRecord = (row: SqliteApiKeyRow) => parseRecord({
  id: row.id,
  hash: row.hash,
  verifier: row.verifier_id === null
    ? LEGACY_SHA256_DESCRIPTOR
    : {
        id: row.verifier_id,
        version: row.verifier_version ?? 1,
        metadata: row.verifier_metadata === null ? {} : JSON.parse(row.verifier_metadata),
      },
  scopes: JSON.parse(row.scopes),
  rateLimit: row.rate_limit === null ? null : JSON.parse(row.rate_limit),
  revoked: row.revoked === 1,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
});

export const makeSqliteApiKeyStore = (
  path: string,
  database?: Database,
): ApiKeyStoreService => {
  const db = database ?? new Database(path);
  return {
    backend: 'sqlite',
    initialize: Effect.try({
      try: () => {
        db.exec(SQLITE_DDL);
        const columns = new Set((db.query<{ name: string }, []>(`PRAGMA table_info(${API_KEY_TABLE})`).all()).map((row) => row.name));
        for (const [name, type] of SQLITE_ADDITIVE_COLUMNS) {
          if (!columns.has(name)) db.exec(`ALTER TABLE ${API_KEY_TABLE} ADD COLUMN ${name} ${type}`);
        }
      },
      catch: (cause) => storeFailure('initialize', cause),
    }),
    findById: (id) => Effect.try({
      try: () => db.query<SqliteApiKeyRow, [string]>(
        `SELECT id, hash, scopes, rate_limit, revoked, verifier_id, verifier_version, verifier_metadata, expires_at, created_at FROM ${API_KEY_TABLE} WHERE id = ?`,
      ).get(id),
      catch: (cause) => storeFailure('findById', cause),
    }).pipe(
      Effect.flatMap((row) => row === null ? Effect.succeed(Option.none()) : Effect.map(sqliteRecord(row), Option.some)),
    ),
    insert: (record) => Effect.try({
      try: () => {
        db.query(
          `INSERT INTO ${API_KEY_TABLE} (id, hash, scopes, rate_limit, revoked, verifier_id, verifier_version, verifier_metadata, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          record.id,
          record.hash,
          JSON.stringify(record.scopes),
          Option.match(record.rateLimit, { onNone: () => null, onSome: JSON.stringify }),
          record.revoked ? 1 : 0,
          record.verifier.id,
          record.verifier.version,
          JSON.stringify(record.verifier.metadata),
          Option.match(record.expiresAt, { onNone: () => null, onSome: (date) => date.toISOString() }),
          record.createdAt.toISOString(),
        );
      },
      catch: (cause) => {
        const message = cause instanceof Error ? cause.message : String(cause);
        return message.includes('UNIQUE') || message.includes('PRIMARY KEY')
          ? duplicate(record.id)
          : storeFailure('insert', cause);
      },
    }),
    revoke: (id) => Effect.try({
      try: () => db.query(`UPDATE ${API_KEY_TABLE} SET revoked = 1 WHERE id = ?`).run(id).changes > 0,
      catch: (cause) => storeFailure('revoke', cause),
    }),
    compareAndSwapVerifier: (id, expectedHash, replacement) => Effect.try({
      try: () => db.query(
        `UPDATE ${API_KEY_TABLE} SET hash = ?, verifier_id = ?, verifier_version = ?, verifier_metadata = ? WHERE id = ? AND hash = ? AND revoked = 0`,
      ).run(
        replacement.hash,
        replacement.verifier.id,
        replacement.verifier.version,
        JSON.stringify(replacement.verifier.metadata),
        id,
        expectedHash,
      ).changes > 0,
      catch: (cause) => storeFailure('compareAndSwapVerifier', cause),
    }),
  };
};

export const ApiKeyStoreSqlite = (path: string, database?: Database) =>
  Layer.succeed(ApiKeyStore, makeSqliteApiKeyStore(path, database));

export interface PostgresApiKeyPool {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number | null }>;
}

export interface PostgresApiKeyStoreOptions {
  /** Schema prepared by migrateFredPostgresStores. */
  readonly schema?: string;
}

export const makePostgresApiKeyStore = (
  pool: PostgresApiKeyPool,
  options: PostgresApiKeyStoreOptions = {},
): ApiKeyStoreService => {
  const table = fredPostgresTable(options.schema ?? DEFAULT_POSTGRES_SCHEMA, API_KEY_TABLE);
  return {
  backend: 'postgres',
  // Postgres DDL is applied only by @fancyrobot/fred-postgres migrations.
  initialize: Effect.void,
  findById: (id) => Effect.tryPromise({
    try: () => pool.query(
      `SELECT id, hash, scopes, rate_limit, revoked, verifier_id, verifier_version, verifier_metadata, expires_at, created_at FROM ${table} WHERE id = $1`,
      [id],
    ),
    catch: (cause) => storeFailure('findById', cause),
  }).pipe(
    Effect.flatMap((result) => {
      const row = result.rows[0];
      return row === undefined
        ? Effect.succeed(Option.none())
        : Effect.map(parseRecord({
            id: row.id,
            hash: row.hash,
            verifier: row.verifier_id === null || row.verifier_id === undefined
              ? LEGACY_SHA256_DESCRIPTOR
              : { id: row.verifier_id, version: row.verifier_version ?? 1, metadata: row.verifier_metadata ?? {} },
            scopes: row.scopes,
            rateLimit: row.rate_limit,
            revoked: row.revoked,
            expiresAt: row.expires_at instanceof Date ? row.expires_at.toISOString() : (row.expires_at ?? null),
            createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
          }), Option.some);
    }),
  ),
  insert: (record) => Effect.tryPromise({
    try: async () => {
      await pool.query(
        `INSERT INTO ${table} (id, hash, scopes, rate_limit, revoked, verifier_id, verifier_version, verifier_metadata, expires_at, created_at) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          record.id,
          record.hash,
          JSON.stringify(record.scopes),
          Option.match(record.rateLimit, { onNone: () => null, onSome: JSON.stringify }),
          record.revoked,
          record.verifier.id,
          record.verifier.version,
          JSON.stringify(record.verifier.metadata),
          Option.getOrNull(record.expiresAt),
          record.createdAt,
        ],
      );
    },
    catch: (cause) => {
      const code = typeof cause === 'object' && cause !== null && 'code' in cause ? cause.code : undefined;
      return code === '23505' ? duplicate(record.id) : storeFailure('insert', cause);
    },
  }),
  revoke: (id) => Effect.tryPromise({
    try: async () => (await pool.query(
      `UPDATE ${table} SET revoked = TRUE WHERE id = $1`, [id],
    )).rowCount !== 0,
    catch: (cause) => storeFailure('revoke', cause),
  }),
  compareAndSwapVerifier: (id, expectedHash, replacement) => Effect.tryPromise({
    try: async () => (await pool.query(
      `UPDATE ${table} SET hash = $1, verifier_id = $2, verifier_version = $3, verifier_metadata = $4::jsonb WHERE id = $5 AND hash = $6 AND revoked = FALSE`,
      [replacement.hash, replacement.verifier.id, replacement.verifier.version, JSON.stringify(replacement.verifier.metadata), id, expectedHash],
    )).rowCount !== 0,
    catch: (cause) => storeFailure('compareAndSwapVerifier', cause),
  }),
  };
};

export const ApiKeyStorePostgres = (pool: PostgresApiKeyPool, options?: PostgresApiKeyStoreOptions) =>
  Layer.succeed(ApiKeyStore, makePostgresApiKeyStore(pool, options));

export const hashApiKey = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

export interface GeneratedApiKey {
  readonly token: string;
  readonly record: ApiKeyRecord;
}

export const generateApiKey = (
  scopes: readonly string[],
  options: {
    readonly id?: string;
    readonly rateLimit?: ApiKeyRateLimit;
    readonly expiresAt?: Date;
    readonly verifierId?: string;
    readonly verifierRegistry?: ApiKeyVerifierRegistryService;
  } = {},
): Effect.Effect<GeneratedApiKey, ApiKeyGenerationError | ApiKeyVerifierConfigurationError | ApiKeyVerifierOperationError> => Effect.gen(function* () {
  const id = options.id ?? randomBytes(9).toString('base64url');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    return yield* new ApiKeyGenerationError({ message: 'API key id must contain 8-64 letters, numbers, underscores, or dashes' });
  }
  if (scopes.some((scope) => !/^[A-Za-z0-9:_-]+$/.test(scope))) {
    return yield* new ApiKeyGenerationError({ message: 'API key scopes contain an invalid value' });
  }
  if (options.rateLimit !== undefined
    && (!Number.isSafeInteger(options.rateLimit.maxRequests)
      || options.rateLimit.maxRequests <= 0
      || !Number.isSafeInteger(options.rateLimit.windowMs)
      || options.rateLimit.windowMs <= 0)) {
    return yield* new ApiKeyGenerationError({ message: 'API key rate limit values must be positive integers' });
  }
  const secret = randomBytes(32).toString('base64url');
  const token = `${API_KEY_TOKEN_PREFIX}_${id}.${secret}`;
  const registry = options.verifierRegistry ?? makeDefaultApiKeyVerifierRegistry();
  const derived = yield* registry.derive(options.verifierId ?? registry.defaultVerifierId, token);
  return {
    token,
    record: {
      id,
      hash: derived.hash,
      verifier: derived.verifier,
      scopes: [...new Set(scopes)].sort(),
      rateLimit: Option.fromNullable(options.rateLimit),
      revoked: false,
      expiresAt: Option.fromNullable(options.expiresAt),
      createdAt: new Date(),
    },
  };
});

const tokenId = (token: string): string | undefined => {
  const match = /^fred_([A-Za-z0-9_-]{8,64})\.[A-Za-z0-9_-]{32,}$/.exec(token);
  return match?.[1];
};

export const authorizeApiKey = Effect.fn('ApiKeyStore.authorize')(function* (
  store: ApiKeyStoreService,
  authorization: string | undefined,
  requiredScopes: readonly string[] = [],
  options: {
    readonly verifierRegistry?: ApiKeyVerifierRegistryService;
    readonly upgradeVerifierId?: string | false;
    readonly now?: Date;
  } = {},
) {
  if (authorization === undefined) {
    return yield* new ApiKeyAuthenticationError({ reason: 'absent', message: 'API key is required' });
  }
  if (!authorization.startsWith('Bearer ')) {
    return yield* new ApiKeyAuthenticationError({ reason: 'malformed', message: 'Malformed authorization header' });
  }
  const token = authorization.slice('Bearer '.length);
  const id = tokenId(token);
  if (id === undefined) {
    return yield* new ApiKeyAuthenticationError({ reason: 'malformed', message: 'Malformed API key' });
  }
  const found = yield* store.findById(id);
  if (Option.isNone(found)) {
    return yield* new ApiKeyAuthenticationError({ reason: 'unknown', message: 'Unknown API key' });
  }
  const record = found.value;
  const registry = options.verifierRegistry ?? makeDefaultApiKeyVerifierRegistry();
  const verified = yield* registry.verify(token, record.hash, record.verifier).pipe(
    Effect.mapError(() => new ApiKeyAuthenticationError({ reason: 'verifier', message: 'API key verifier is unavailable' })),
  );
  if (!verified) {
    return yield* new ApiKeyAuthenticationError({ reason: 'mismatch', message: 'Invalid API key' });
  }
  if (record.revoked) {
    return yield* new ApiKeyAuthenticationError({ reason: 'revoked', message: 'API key is revoked' });
  }
  if (Option.isSome(record.expiresAt) && record.expiresAt.value.getTime() <= (options.now ?? new Date()).getTime()) {
    return yield* new ApiKeyAuthenticationError({ reason: 'expired', message: 'API key is expired' });
  }
  const granted = new Set(record.scopes);
  const missingScopes = requiredScopes.filter((scope) => !granted.has(scope));
  if (missingScopes.length > 0) {
    return yield* new ApiKeyScopeError({
      keyId: record.id,
      missingScopes,
      message: 'API key does not grant every required scope',
    });
  }
  const upgradeVerifierId = options.upgradeVerifierId === false
    ? undefined
    : (options.upgradeVerifierId
      ?? (record.verifier.id === API_KEY_VERIFIER_IDS.legacySha256
        ? registry.defaultVerifierId
        : record.verifier.id));
  const shouldUpgrade = upgradeVerifierId === undefined
    ? false
    : yield* registry.needsUpgrade(record.verifier, upgradeVerifierId);
  if (upgradeVerifierId !== undefined && shouldUpgrade) {
    const replacement = yield* registry.derive(upgradeVerifierId, token).pipe(Effect.either);
    if (replacement._tag === 'Right') {
      yield* store.compareAndSwapVerifier(record.id, record.hash, replacement.right).pipe(Effect.either);
    }
  }
  return {
    id: record.id,
    scopes: record.scopes,
    rateLimit: record.rateLimit,
  } satisfies AuthenticatedApiKeyIdentity;
});

export const makeApiKeyAuthorization = (store: ApiKeyStoreService): ApiKeyAuthorizationService => ({
  authorize: (authorization, requiredScopes = []) =>
    authorizeApiKey(store, authorization, requiredScopes),
});

export const ApiKeyAuthorizationLive = (store: ApiKeyStoreService) =>
  Layer.succeed(ApiKeyAuthorization, makeApiKeyAuthorization(store));
