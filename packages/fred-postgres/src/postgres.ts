import { Effect, Schema } from 'effect';
import { Pool } from 'pg';
import {
  PgvectorRequiredError,
  PostgresConfigurationError,
  PostgresMigrationChecksumError,
  PostgresMigrationLockTimeoutError,
  PostgresOperationError,
  type FredPostgresError,
} from './errors';

export const DEFAULT_POSTGRES_SCHEMA = 'fred';
export const POSTGRES_SCHEMA_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const VECTOR_MODES = ['auto', 'install', 'off', 'required'] as const;

export const PgvectorMode = Schema.Literal(...VECTOR_MODES);
export type PgvectorMode = typeof PgvectorMode.Type;

export interface PostgresQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}

export interface PostgresClient {
  query(text: string, values?: unknown[]): Promise<PostgresQueryResult>;
  release(error?: Error | boolean): void;
}

export interface PostgresPool {
  connect(): Promise<PostgresClient>;
  end?(): Promise<void>;
}

export interface FredPostgresMigration {
  readonly module: string;
  readonly version: number;
  readonly checksum: string;
  readonly sql: string;
}

export interface FredPostgresOptions {
  readonly connectionString?: string;
  readonly pool?: PostgresPool;
  readonly schema?: string;
  readonly vector?: PgvectorMode;
  readonly lockTimeoutMs?: number;
}

export interface PgvectorDiagnostics {
  readonly mode: PgvectorMode;
  readonly enabled: boolean;
  readonly version?: string;
}

export interface FredPostgresDiagnostics {
  readonly schema: string;
  readonly pool: 'owned' | 'external';
  readonly modules: readonly {
    readonly module: string;
    readonly version: number;
    readonly checksum: string;
  }[];
  readonly vector: PgvectorDiagnostics;
}

export interface FredPostgres {
  readonly migrate: (
    migrations?: readonly FredPostgresMigration[],
  ) => Effect.Effect<FredPostgresDiagnostics, FredPostgresError>;
  readonly diagnostics: Effect.Effect<FredPostgresDiagnostics, FredPostgresError>;
  readonly close: Effect.Effect<void, PostgresOperationError>;
}

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

export const quotePostgresIdentifier = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

const validSchema = (schema: string): schema is string => POSTGRES_SCHEMA_NAME_PATTERN.test(schema);

/** Return a safely quoted table name in a configured Fred schema. */
export const fredPostgresTable = (schema: string, table: string): string => {
  if (!validSchema(schema) || !validSchema(table)) {
    throw new Error(`Invalid PostgreSQL identifier: ${!validSchema(schema) ? schema : table}`);
  }
  return `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)}`;
};

const operation = <A>(
  name: string,
  run: () => Promise<A>,
): Effect.Effect<A, PostgresOperationError> =>
  Effect.tryPromise({
    try: run,
    catch: (cause) => new PostgresOperationError({ operation: name, message: errorMessage(cause) }),
  });

const release = (client: PostgresClient, destroy: boolean): Effect.Effect<void> =>
  Effect.sync(() => destroy ? client.release(true) : client.release());

const useClient = <A, E>(
  pool: PostgresPool,
  use: (client: PostgresClient, destroy: () => void) => Effect.Effect<A, E>,
): Effect.Effect<A, E | PostgresOperationError> =>
  Effect.acquireUseRelease(
    operation('connect', () => pool.connect()).pipe(
      Effect.map((client) => ({ client, destroy: false })),
    ),
    (lease) => use(lease.client, () => { lease.destroy = true; }),
    (lease) => release(lease.client, lease.destroy),
  );

const query = (
  client: PostgresClient,
  name: string,
  text: string,
  values?: unknown[],
): Effect.Effect<PostgresQueryResult, PostgresOperationError> =>
  operation(name, () => client.query(text, values));

const lockValues = (schema: string): unknown[] => ['fred-postgres', schema];

const readVector = Effect.fn('FredPostgres.readVector')(function* (
  client: PostgresClient,
  mode: PgvectorMode,
) {
  if (mode === 'off') return { mode, enabled: false };
  const result = yield* query(
    client,
    'detectVector',
    "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
  );
  const version = result.rows[0]?.extversion;
  return typeof version === 'string'
    ? { mode, enabled: true, version }
    : { mode, enabled: false };
});

const resolveVector = Effect.fn('FredPostgres.resolveVector')(function* (
  client: PostgresClient,
  mode: PgvectorMode,
) {
  const current = yield* readVector(client, mode);
  if (current.enabled || mode === 'auto' || mode === 'off') return current;
  if (mode === 'required') {
    return yield* new PgvectorRequiredError({
      message: 'pgvector is required but the vector extension is not installed',
    });
  }
  yield* query(client, 'installVector', 'CREATE EXTENSION IF NOT EXISTS vector');
  const installed = yield* readVector(client, mode);
  if (installed.enabled) return installed;
  return yield* new PgvectorRequiredError({
    message: 'pgvector installation completed without exposing the vector extension',
  });
});

const validateMigrations = (
  migrations: readonly FredPostgresMigration[],
): Effect.Effect<readonly FredPostgresMigration[], PostgresConfigurationError> =>
  Effect.sync(() => {
    const versions = new Set<string>();
    for (const migration of migrations) {
      if (!migration.module || !Number.isInteger(migration.version) || migration.version < 1 || !migration.checksum || !migration.sql) {
        throw new Error('Migrations require a non-empty module, positive integer version, checksum, and SQL');
      }
      const key = `${migration.module}:${migration.version}`;
      if (versions.has(key)) throw new Error(`Duplicate migration ${key}`);
      versions.add(key);
    }
    return migrations;
  }).pipe(
    Effect.mapError((cause) => new PostgresConfigurationError({ message: errorMessage(cause) })),
  );

const acquireLock = Effect.fn('FredPostgres.acquireMigrationLock')(function* (
  client: PostgresClient,
  schema: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    const result = yield* query(
      client,
      'acquireMigrationLock',
      'SELECT pg_try_advisory_lock(hashtext($1), hashtext($2)) AS locked',
      lockValues(schema),
    );
    if (result.rows[0]?.locked === true) return;
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      return yield* new PostgresMigrationLockTimeoutError({
        schema,
        timeoutMs,
        message: `Timed out waiting ${timeoutMs}ms for the Fred Postgres migration lock`,
      });
    }
    yield* Effect.sleep(Math.min(100, remaining));
  }
});

const releaseLock = (
  client: PostgresClient,
  schema: string,
): Effect.Effect<void, PostgresOperationError> =>
  query(
    client,
    'releaseMigrationLock',
    'SELECT pg_advisory_unlock(hashtext($1), hashtext($2))',
    lockValues(schema),
  ).pipe(Effect.asVoid);

const migrationRows = Effect.fn('FredPostgres.migrationRows')(function* (
  client: PostgresClient,
  ledger: string,
) {
  const result = yield* query(
    client,
    'readMigrationLedger',
    `SELECT module, version, checksum FROM ${ledger} ORDER BY module, version`,
  );
  return result.rows.flatMap((row) =>
    typeof row.module === 'string' && typeof row.version === 'number' && typeof row.checksum === 'string'
      ? [{ module: row.module, version: row.version, checksum: row.checksum }]
      : [],
  );
});

export const makeFredPostgres = Effect.fn('FredPostgres.make')(function* (
  options: FredPostgresOptions,
) {
  if (options.pool !== undefined && options.connectionString !== undefined) {
    return yield* new PostgresConfigurationError({
      message: 'Provide either pool or connectionString, not both',
    });
  }
  if (options.pool === undefined && !options.connectionString) {
    return yield* new PostgresConfigurationError({
      message: 'Postgres requires a pool or connectionString',
    });
  }

  const schema = options.schema ?? DEFAULT_POSTGRES_SCHEMA;
  if (!validSchema(schema)) {
    return yield* new PostgresConfigurationError({
      message: `Invalid PostgreSQL schema identifier: ${schema}`,
    });
  }
  const lockTimeoutMs = options.lockTimeoutMs ?? 30_000;
  if (!Number.isInteger(lockTimeoutMs) || lockTimeoutMs < 0) {
    return yield* new PostgresConfigurationError({
      message: 'lockTimeoutMs must be a non-negative integer',
    });
  }

  const vectorMode = options.vector ?? 'auto';
  if (!VECTOR_MODES.some((mode) => mode === vectorMode)) {
    return yield* new PostgresConfigurationError({
      message: `Invalid pgvector mode: ${String(vectorMode)}`,
    });
  }
  const ownsPool = options.pool === undefined;
  const pool = options.pool ?? new Pool({ connectionString: options.connectionString });
  const quotedSchema = quotePostgresIdentifier(schema);
  const ledger = `${quotedSchema}.${quotePostgresIdentifier('schema_migrations')}`;

  const collectDiagnostics = (client: PostgresClient): Effect.Effect<FredPostgresDiagnostics, FredPostgresError> =>
    Effect.gen(function* () {
      const exists = yield* query(
        client,
        'checkMigrationLedger',
        'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_tables WHERE schemaname = $1 AND tablename = $2) AS exists',
        [schema, 'schema_migrations'],
      );
      const modules = exists.rows[0]?.exists === true
        ? yield* migrationRows(client, ledger)
        : [];
      const vector = yield* readVector(client, vectorMode);
      return { schema, pool: ownsPool ? 'owned' : 'external', modules, vector };
    });

  const diagnostics = useClient(pool, collectDiagnostics);

  const migrate = (requested: readonly FredPostgresMigration[] = []) =>
    validateMigrations(requested).pipe(
      Effect.flatMap((migrations) => useClient(pool, (client, destroy) =>
        acquireLock(client, schema, lockTimeoutMs).pipe(
          Effect.flatMap(() =>
            Effect.gen(function* () {
              const vector = yield* resolveVector(client, vectorMode);
              yield* query(client, 'beginMigration', 'BEGIN');
              const migration = Effect.gen(function* () {
                yield* query(client, 'createSchema', `CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`);
                yield* query(
                  client,
                  'createMigrationLedger',
                  `CREATE TABLE IF NOT EXISTS ${ledger} (
                    module TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    checksum TEXT NOT NULL,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                    PRIMARY KEY (module, version)
                  )`,
                );
                for (const item of migrations) {
                  const existing = yield* query(
                    client,
                    'readMigration',
                    `SELECT checksum FROM ${ledger} WHERE module = $1 AND version = $2`,
                    [item.module, item.version],
                  );
                  const actual = existing.rows[0]?.checksum;
                  if (typeof actual === 'string') {
                    if (actual !== item.checksum) {
                      return yield* new PostgresMigrationChecksumError({
                        module: item.module,
                        version: item.version,
                        expected: item.checksum,
                        actual,
                        message: `Migration ${item.module}:${item.version} checksum drifted`,
                      });
                    }
                    continue;
                  }
                  yield* query(client, 'applyMigration', item.sql);
                  yield* query(
                    client,
                    'recordMigration',
                    `INSERT INTO ${ledger} (module, version, checksum) VALUES ($1, $2, $3)`,
                    [item.module, item.version, item.checksum],
                  );
                }
                yield* query(client, 'commitMigration', 'COMMIT');
              });
              yield* migration.pipe(
                Effect.catchAll((error) =>
                  query(client, 'rollbackMigration', 'ROLLBACK').pipe(
                    Effect.ignore,
                    Effect.flatMap(() => Effect.fail(error)),
                  ),
                ),
              );
              const modules = yield* migrationRows(client, ledger);
              return { schema, pool: ownsPool ? 'owned' as const : 'external' as const, modules, vector };
            }),
          ),
          Effect.ensuring(
            releaseLock(client, schema).pipe(
              Effect.tapError(() => Effect.sync(destroy)),
              Effect.orDie,
            ),
          ),
        ),
      )),
    );

  const close = ownsPool
    ? operation('close', () => pool.end!())
    : Effect.void;

  const runtime: FredPostgres = { migrate, diagnostics, close };
  return runtime;
});
