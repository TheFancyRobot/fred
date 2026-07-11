import { Database } from 'bun:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Context, Effect, Layer, Option, Schema } from 'effect';

export const API_KEY_TABLE = 'fred_api_keys';
export const API_KEY_TOKEN_PREFIX = 'fred';

export const ApiKeyRateLimit = Schema.Struct({
  maxRequests: Schema.Number.pipe(Schema.int(), Schema.positive()),
  windowMs: Schema.Number.pipe(Schema.int(), Schema.positive()),
});
export type ApiKeyRateLimit = typeof ApiKeyRateLimit.Type;

export const ApiKeyRecord = Schema.Struct({
  id: Schema.String.pipe(Schema.pattern(/^[A-Za-z0-9_-]{8,64}$/)),
  hash: Schema.String.pipe(Schema.pattern(/^[a-f0-9]{64}$/)),
  scopes: Schema.Array(Schema.String.pipe(Schema.minLength(1))),
  rateLimit: Schema.OptionFromNullOr(ApiKeyRateLimit),
  revoked: Schema.Boolean,
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
    reason: Schema.Literal('absent', 'malformed', 'unknown', 'mismatch', 'revoked'),
    message: Schema.String,
  },
) {}

export class ApiKeyScopeError extends Schema.TaggedError<ApiKeyScopeError>()(
  'ApiKeyScopeError',
  { keyId: Schema.String, missingScopes: Schema.Array(Schema.String), message: Schema.String },
) {}

export interface ApiKeyStoreService {
  readonly backend: 'memory' | 'sqlite' | 'postgres';
  readonly initialize: Effect.Effect<void, ApiKeyStoreError>;
  readonly findById: (id: string) => Effect.Effect<Option.Option<ApiKeyRecord>, ApiKeyStoreError>;
  readonly insert: (record: ApiKeyRecord) => Effect.Effect<void, ApiKeyStoreError | ApiKeyDuplicateIdError>;
  readonly revoke: (id: string) => Effect.Effect<boolean, ApiKeyStoreError>;
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
    ApiKeyStoreError | ApiKeyAuthenticationError | ApiKeyScopeError
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
  };
};

export const ApiKeyStoreMemory = Layer.sync(ApiKeyStore, makeMemoryApiKeyStore);

const SQLITE_DDL = `CREATE TABLE IF NOT EXISTS ${API_KEY_TABLE} (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  scopes TEXT NOT NULL,
  rate_limit TEXT,
  revoked INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
)`;

interface SqliteApiKeyRow {
  readonly id: string;
  readonly hash: string;
  readonly scopes: string;
  readonly rate_limit: string | null;
  readonly revoked: number;
  readonly created_at: string;
}

const sqliteRecord = (row: SqliteApiKeyRow) => parseRecord({
  id: row.id,
  hash: row.hash,
  scopes: JSON.parse(row.scopes),
  rateLimit: row.rate_limit === null ? null : JSON.parse(row.rate_limit),
  revoked: row.revoked === 1,
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
      try: () => { db.exec(SQLITE_DDL); },
      catch: (cause) => storeFailure('initialize', cause),
    }),
    findById: (id) => Effect.try({
      try: () => db.query<SqliteApiKeyRow, [string]>(
        `SELECT id, hash, scopes, rate_limit, revoked, created_at FROM ${API_KEY_TABLE} WHERE id = ?`,
      ).get(id),
      catch: (cause) => storeFailure('findById', cause),
    }).pipe(
      Effect.flatMap((row) => row === null ? Effect.succeed(Option.none()) : Effect.map(sqliteRecord(row), Option.some)),
    ),
    insert: (record) => Effect.try({
      try: () => {
        db.query(
          `INSERT INTO ${API_KEY_TABLE} (id, hash, scopes, rate_limit, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          record.id,
          record.hash,
          JSON.stringify(record.scopes),
          Option.match(record.rateLimit, { onNone: () => null, onSome: JSON.stringify }),
          record.revoked ? 1 : 0,
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
  };
};

export const ApiKeyStoreSqlite = (path: string, database?: Database) =>
  Layer.succeed(ApiKeyStore, makeSqliteApiKeyStore(path, database));

const POSTGRES_DDL = `CREATE TABLE IF NOT EXISTS ${API_KEY_TABLE} (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL,
  scopes JSONB NOT NULL,
  rate_limit JSONB,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
)`;

export interface PostgresApiKeyPool {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number | null }>;
}

export const makePostgresApiKeyStore = (pool: PostgresApiKeyPool): ApiKeyStoreService => ({
  backend: 'postgres',
  initialize: Effect.tryPromise({
    try: async () => { await pool.query(POSTGRES_DDL); },
    catch: (cause) => storeFailure('initialize', cause),
  }),
  findById: (id) => Effect.tryPromise({
    try: () => pool.query(
      `SELECT id, hash, scopes, rate_limit, revoked, created_at FROM ${API_KEY_TABLE} WHERE id = $1`,
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
            scopes: row.scopes,
            rateLimit: row.rate_limit,
            revoked: row.revoked,
            createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
          }), Option.some);
    }),
  ),
  insert: (record) => Effect.tryPromise({
    try: async () => {
      await pool.query(
        `INSERT INTO ${API_KEY_TABLE} (id, hash, scopes, rate_limit, revoked, created_at) VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6)`,
        [
          record.id,
          record.hash,
          JSON.stringify(record.scopes),
          Option.match(record.rateLimit, { onNone: () => null, onSome: JSON.stringify }),
          record.revoked,
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
      `UPDATE ${API_KEY_TABLE} SET revoked = TRUE WHERE id = $1`, [id],
    )).rowCount !== 0,
    catch: (cause) => storeFailure('revoke', cause),
  }),
});

export const ApiKeyStorePostgres = (pool: PostgresApiKeyPool) =>
  Layer.succeed(ApiKeyStore, makePostgresApiKeyStore(pool));

export const hashApiKey = (token: string): string =>
  createHash('sha256').update(token, 'utf8').digest('hex');

const secureHashEqual = (actual: string, expected: string): boolean => {
  const actualBytes = Buffer.from(actual, 'hex');
  const expectedBytes = Buffer.from(expected, 'hex');
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
};

export interface GeneratedApiKey {
  readonly token: string;
  readonly record: ApiKeyRecord;
}

export const generateApiKey = (
  scopes: readonly string[],
  options: { readonly id?: string; readonly rateLimit?: ApiKeyRateLimit } = {},
): GeneratedApiKey => {
  const id = options.id ?? randomBytes(9).toString('base64url');
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
    throw new Error('API key id must contain 8-64 letters, numbers, underscores, or dashes');
  }
  if (scopes.some((scope) => !/^[A-Za-z0-9:_-]+$/.test(scope))) {
    throw new Error('API key scopes contain an invalid value');
  }
  if (options.rateLimit !== undefined
    && (!Number.isSafeInteger(options.rateLimit.maxRequests)
      || options.rateLimit.maxRequests <= 0
      || !Number.isSafeInteger(options.rateLimit.windowMs)
      || options.rateLimit.windowMs <= 0)) {
    throw new Error('API key rate limit values must be positive integers');
  }
  const secret = randomBytes(32).toString('base64url');
  const token = `${API_KEY_TOKEN_PREFIX}_${id}.${secret}`;
  return {
    token,
    record: {
      id,
      hash: hashApiKey(token),
      scopes: [...new Set(scopes)].sort(),
      rateLimit: Option.fromNullable(options.rateLimit),
      revoked: false,
      createdAt: new Date(),
    },
  };
};

const tokenId = (token: string): string | undefined => {
  const match = /^fred_([A-Za-z0-9_-]{8,64})\.[A-Za-z0-9_-]{32,}$/.exec(token);
  return match?.[1];
};

export const authorizeApiKey = Effect.fn('ApiKeyStore.authorize')(function* (
  store: ApiKeyStoreService,
  authorization: string | undefined,
  requiredScopes: readonly string[] = [],
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
  if (!secureHashEqual(hashApiKey(token), record.hash)) {
    return yield* new ApiKeyAuthenticationError({ reason: 'mismatch', message: 'Invalid API key' });
  }
  if (record.revoked) {
    return yield* new ApiKeyAuthenticationError({ reason: 'revoked', message: 'API key is revoked' });
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
