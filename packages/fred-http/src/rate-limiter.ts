import { Database } from 'bun:sqlite';
import { Clock, Context, Effect, Layer, Schema } from 'effect';
import { randomUUID } from 'node:crypto';
import { DEFAULT_POSTGRES_SCHEMA, fredPostgresTable } from '@fancyrobot/fred-postgres';

export const RATE_LIMIT_TABLE = 'fred_rate_limit_buckets';

export const RateLimitPolicy = Schema.Struct({
  maxRequests: Schema.Number.pipe(Schema.int(), Schema.positive()),
  windowMs: Schema.Number.pipe(Schema.int(), Schema.positive()),
});
export type RateLimitPolicy = typeof RateLimitPolicy.Type;

export const RateLimitDecision = Schema.Struct({
  allowed: Schema.Boolean,
  retryAfterMs: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  remaining: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
  resetAt: Schema.Number.pipe(Schema.int(), Schema.nonNegative()),
});
export type RateLimitDecision = typeof RateLimitDecision.Type;

export class RateLimitStoreError extends Schema.TaggedError<RateLimitStoreError>()(
  'RateLimitStoreError',
  { operation: Schema.String, message: Schema.String },
) {}

export interface RateLimitConsumeInput {
  readonly key: string;
  readonly policy: RateLimitPolicy;
  readonly now: number;
}

export interface RateLimitStoreService {
  readonly backend: 'memory' | 'sqlite' | 'postgres';
  readonly initialize: Effect.Effect<void, RateLimitStoreError>;
  readonly consume: (input: RateLimitConsumeInput) => Effect.Effect<RateLimitDecision, RateLimitStoreError>;
  readonly prune: (now: number) => Effect.Effect<number, RateLimitStoreError>;
  readonly close: Effect.Effect<void, RateLimitStoreError>;
}

export class RateLimitStore extends Context.Tag('@fancyrobot/fred-http/RateLimitStore')<
  RateLimitStore,
  RateLimitStoreService
>() {}

const storeFailure = (operation: string, cause: unknown) => new RateLimitStoreError({
  operation,
  message: cause instanceof Error ? cause.message : String(cause),
});

const validatePolicy = (policy: RateLimitPolicy) =>
  Schema.decodeUnknown(RateLimitPolicy)(policy).pipe(
    Effect.mapError((cause) => storeFailure('validatePolicy', cause)),
  );

interface MemoryBucket {
  readonly count: number;
  readonly resetAt: number;
}

export interface MemoryRateLimitStoreOptions {
  readonly maxBuckets?: number;
  readonly pruneEvery?: number;
}

export const makeMemoryRateLimitStore = (
  options: MemoryRateLimitStoreOptions = {},
): RateLimitStoreService => {
  const buckets = new Map<string, MemoryBucket>();
  const maxBuckets = options.maxBuckets ?? 100_000;
  const pruneEvery = options.pruneEvery ?? 256;
  let consumes = 0;

  const pruneSync = (now: number): number => {
    let removed = 0;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) {
        buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  };

  return {
    backend: 'memory',
    initialize: Effect.void,
    consume: Effect.fn('MemoryRateLimitStore.consume')((input) => Effect.gen(function* () {
      const policy = yield* validatePolicy(input.policy);
      return yield* Effect.suspend(() => {
        consumes += 1;
        if (consumes % pruneEvery === 0) pruneSync(input.now);

        const current = buckets.get(input.key);
        if (current === undefined || current.resetAt <= input.now) {
          if (current === undefined && buckets.size >= maxBuckets) {
            pruneSync(input.now);
            if (buckets.size >= maxBuckets) {
              return Effect.fail(storeFailure('consume', 'Rate limit bucket capacity exceeded'));
            }
          }
          const resetAt = input.now + policy.windowMs;
          buckets.set(input.key, { count: 1, resetAt });
          return Effect.succeed({
            allowed: true,
            retryAfterMs: 0,
            remaining: policy.maxRequests - 1,
            resetAt,
          });
        }

        if (current.count >= policy.maxRequests) {
          return Effect.succeed({
            allowed: false,
            retryAfterMs: Math.max(1, current.resetAt - input.now),
            remaining: 0,
            resetAt: current.resetAt,
          });
        }

        const count = current.count + 1;
        buckets.set(input.key, { ...current, count });
        return Effect.succeed({
          allowed: true,
          retryAfterMs: 0,
          remaining: policy.maxRequests - count,
          resetAt: current.resetAt,
        });
      });
    })),
    prune: (now) => Effect.sync(() => pruneSync(now)),
    close: Effect.sync(() => buckets.clear()),
  };
};

export const RateLimitStoreMemory = Layer.sync(RateLimitStore, makeMemoryRateLimitStore);

const SQLITE_DDL = `CREATE TABLE IF NOT EXISTS ${RATE_LIMIT_TABLE} (
  bucket_key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_${RATE_LIMIT_TABLE}_expires_at ON ${RATE_LIMIT_TABLE} (expires_at);`;

interface SqliteBucketRow {
  readonly request_count: number;
  readonly expires_at: number;
}

export const makeSqliteRateLimitStore = (
  path: string,
  database?: Database,
): RateLimitStoreService => {
  const db = database ?? new Database(path);
  const ownsDatabase = database === undefined;
  let consumes = 0;

  return {
    backend: 'sqlite',
    initialize: Effect.try({
      try: () => { db.exec(SQLITE_DDL); },
      catch: (cause) => storeFailure('initialize', cause),
    }),
    consume: Effect.fn('SqliteRateLimitStore.consume')((input) => Effect.gen(function* () {
      const policy = yield* validatePolicy(input.policy);
      return yield* Effect.try({
        try: () => {
          consumes += 1;
          if (consumes % 256 === 0) {
            db.query(`DELETE FROM ${RATE_LIMIT_TABLE} WHERE bucket_key IN (
              SELECT bucket_key FROM ${RATE_LIMIT_TABLE} WHERE expires_at <= ? LIMIT 1000
            )`).run(input.now);
          }
          const row = db.query<
            SqliteBucketRow,
            [string, number, number, number, number, number, number, number]
          >(
            `INSERT INTO ${RATE_LIMIT_TABLE} (bucket_key, window_start, request_count, expires_at)
             VALUES (?, ?, 1, ?)
             ON CONFLICT(bucket_key) DO UPDATE SET
               window_start = CASE WHEN expires_at <= ? THEN excluded.window_start ELSE window_start END,
               request_count = CASE WHEN expires_at <= ? THEN 1 ELSE request_count + 1 END,
               expires_at = CASE WHEN expires_at <= ? THEN excluded.expires_at ELSE expires_at END
             WHERE expires_at <= ? OR request_count < ?
             RETURNING request_count, expires_at`,
          ).get(
            input.key,
            input.now,
            input.now + policy.windowMs,
            input.now,
            input.now,
            input.now,
            input.now,
            policy.maxRequests,
          );
          const bucket = row ?? db.query<SqliteBucketRow, [string]>(
            `SELECT request_count, expires_at FROM ${RATE_LIMIT_TABLE} WHERE bucket_key = ?`,
          ).get(input.key);
          if (bucket === null) throw new Error('Rate limit bucket disappeared during consume');
          const allowed = row !== null;
          return {
            allowed,
            retryAfterMs: allowed ? 0 : Math.max(1, bucket.expires_at - input.now),
            remaining: allowed ? Math.max(0, policy.maxRequests - bucket.request_count) : 0,
            resetAt: bucket.expires_at,
          };
        },
        catch: (cause) => storeFailure('consume', cause),
      });
    })),
    prune: (now) => Effect.try({
      try: () => db.query(`DELETE FROM ${RATE_LIMIT_TABLE} WHERE expires_at <= ?`).run(now).changes,
      catch: (cause) => storeFailure('prune', cause),
    }),
    close: ownsDatabase
      ? Effect.try({ try: () => db.close(), catch: (cause) => storeFailure('close', cause) })
      : Effect.void,
  };
};

export const RateLimitStoreSqlite = (path: string, database?: Database) =>
  Layer.scoped(
    RateLimitStore,
    Effect.acquireRelease(
      Effect.sync(() => makeSqliteRateLimitStore(path, database)),
      (store) => store.close.pipe(Effect.catchTag('RateLimitStoreError', Effect.logError)),
    ),
  );

export interface PostgresRateLimitPool {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ readonly rows: readonly Record<string, unknown>[]; readonly rowCount: number | null }>;
}

export interface PostgresRateLimitStoreOptions {
  /** Schema prepared by migrateFredPostgresStores. Omit to retain the v1 public-table adapter. */
  readonly schema?: string;
}

const POSTGRES_DDL = `CREATE TABLE IF NOT EXISTS ${RATE_LIMIT_TABLE} (
  bucket_key TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  request_count INTEGER NOT NULL,
  expires_at BIGINT NOT NULL,
  decision_id TEXT
);
ALTER TABLE ${RATE_LIMIT_TABLE} ADD COLUMN IF NOT EXISTS decision_id TEXT;
CREATE INDEX IF NOT EXISTS idx_${RATE_LIMIT_TABLE}_expires_at ON ${RATE_LIMIT_TABLE} (expires_at);`;

export const makePostgresRateLimitStore = (
  pool: PostgresRateLimitPool,
  options: PostgresRateLimitStoreOptions = {},
): RateLimitStoreService => {
  const legacy = options.schema === undefined;
  const table = legacy ? RATE_LIMIT_TABLE : fredPostgresTable(options.schema ?? DEFAULT_POSTGRES_SCHEMA, RATE_LIMIT_TABLE);
  let consumes = 0;
  return {
    backend: 'postgres',
    initialize: legacy
      ? Effect.tryPromise({
          try: async () => { await pool.query(POSTGRES_DDL); },
          catch: (cause) => storeFailure('initialize', cause),
        })
      : Effect.void,
    consume: Effect.fn('PostgresRateLimitStore.consume')((input) => Effect.gen(function* () {
      const policy = yield* validatePolicy(input.policy);
      consumes += 1;
      if (consumes % 256 === 0) {
        yield* Effect.tryPromise({
          try: () => pool.query(`DELETE FROM ${table} WHERE bucket_key IN (
            SELECT bucket_key FROM ${table} WHERE expires_at <= $1 LIMIT 1000
          )`, [input.now]),
          catch: (cause) => storeFailure('prune', cause),
        });
      }
      const decisionId = randomUUID();
      const result = yield* Effect.tryPromise({
        try: () => pool.query(
          `INSERT INTO ${table} AS buckets (bucket_key, window_start, request_count, expires_at, decision_id)
           VALUES ($1, $2, 1, $3, $5)
           ON CONFLICT(bucket_key) DO UPDATE SET
             window_start = CASE WHEN buckets.expires_at <= $2 THEN EXCLUDED.window_start ELSE buckets.window_start END,
             request_count = CASE
               WHEN buckets.expires_at <= $2 THEN 1
               WHEN buckets.request_count < $4 THEN buckets.request_count + 1
               ELSE buckets.request_count
             END,
             expires_at = CASE WHEN buckets.expires_at <= $2 THEN EXCLUDED.expires_at ELSE buckets.expires_at END,
             decision_id = CASE
               WHEN buckets.expires_at <= $2 OR buckets.request_count < $4 THEN EXCLUDED.decision_id
               ELSE buckets.decision_id
             END
           RETURNING request_count, expires_at, decision_id = $5 AS consumed`,
          [input.key, input.now, input.now + policy.windowMs, policy.maxRequests, decisionId],
        ),
        catch: (cause) => storeFailure('consume', cause),
      });
      const row = result.rows[0];
      if (row === undefined) return yield* storeFailure('consume', 'Rate limit bucket disappeared during consume');
      const allowed = row.consumed === true;
      const count = Number(row.request_count);
      const resetAt = Number(row.expires_at);
      return {
        allowed,
        retryAfterMs: allowed ? 0 : Math.max(1, resetAt - input.now),
        remaining: allowed ? Math.max(0, policy.maxRequests - count) : 0,
        resetAt,
      };
    })),
    prune: (now) => Effect.tryPromise({
      try: async () => (await pool.query(`DELETE FROM ${table} WHERE expires_at <= $1`, [now])).rowCount ?? 0,
      catch: (cause) => storeFailure('prune', cause),
    }),
    close: Effect.void,
  };
};

export const RateLimitStorePostgres = (pool: PostgresRateLimitPool, options?: PostgresRateLimitStoreOptions) =>
  Layer.succeed(RateLimitStore, makePostgresRateLimitStore(pool, options));

export interface RateLimitRequest {
  readonly key: string;
  readonly policy: RateLimitPolicy;
}

export const makeRateLimitService = Effect.fn('RateLimitService.make')(function* (
  store: RateLimitStoreService,
) {
  yield* store.initialize;
  const consume = Effect.fn('RateLimitService.consume')(function* (request: RateLimitRequest) {
    const now = yield* Clock.currentTimeMillis;
    return yield* store.consume({ ...request, now });
  });
  return { consume };
});

export class RateLimitService extends Effect.Service<RateLimitService>()(
  '@fancyrobot/fred-http/RateLimitService',
  {
    accessors: true,
    dependencies: [RateLimitStoreMemory],
    effect: Effect.gen(function* () {
      const store = yield* RateLimitStore;
      return yield* makeRateLimitService(store);
    }),
  },
) {}

export const RateLimitServiceLive = (store: RateLimitStoreService = makeMemoryRateLimitStore()) =>
  RateLimitService.DefaultWithoutDependencies.pipe(
    Layer.provide(Layer.succeed(RateLimitStore, store)),
  );
