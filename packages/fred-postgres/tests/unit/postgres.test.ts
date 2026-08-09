import { createHash } from 'node:crypto';
import { describe, expect, test } from 'bun:test';
import { Cause, Effect, Exit, Option } from 'effect';
import {
  fredPostgresStoreMigrations,
  importLegacyFredPostgresStores,
  makeFredPostgres,
  type FredPostgresOptions,
  type PostgresClient,
  type PostgresPool,
} from '../../src';

class FakePool implements PostgresPool {
  readonly queries: string[] = [];
  readonly ledger = new Map<string, string>();
  vectorInstalled = false;
  denyVectorInstall = false;
  lockAvailable = true;
  failMigrationRows = false;
  failUnlock = false;
  readonly releases: (Error | boolean | undefined)[] = [];
  ended = false;

  async connect(): Promise<PostgresClient> {
    return {
      query: async (text, values = []) => {
        this.queries.push(text);
        if (text.includes("extname = 'vector'")) {
          return { rows: this.vectorInstalled ? [{ extversion: '0.8.0' }] : [], rowCount: this.vectorInstalled ? 1 : 0 };
        }
        if (text.startsWith('CREATE EXTENSION')) {
          if (this.denyVectorInstall) throw new Error('permission denied to create extension');
          this.vectorInstalled = true;
          return { rows: [], rowCount: null };
        }
        if (text.includes('pg_try_advisory_lock')) return { rows: [{ locked: this.lockAvailable }], rowCount: 1 };
        if (text.includes('pg_advisory_unlock')) {
          if (this.failUnlock) throw new Error('connection lost while releasing lock');
          return { rows: [{ unlocked: true }], rowCount: 1 };
        }
        if (text.startsWith('SELECT checksum')) {
          const key = `${values[0]}:${values[1]}`;
          const checksum = this.ledger.get(key);
          return { rows: checksum === undefined ? [] : [{ checksum }], rowCount: checksum === undefined ? 0 : 1 };
        }
        if (text.startsWith('INSERT INTO')) {
          this.ledger.set(`${values[0]}:${values[1]}`, String(values[2]));
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('SELECT module')) {
          if (this.failMigrationRows) throw new Error('migration diagnostics failed');
          return {
            rows: [...this.ledger.entries()].map(([key, checksum]) => {
              const [module, version] = key.split(':');
              return { module, version: Number(version), checksum };
            }),
            rowCount: this.ledger.size,
          };
        }
        if (text.includes('pg_catalog.pg_tables')) return { rows: [{ exists: this.ledger.size > 0 }], rowCount: 1 };
        return { rows: [], rowCount: null };
      },
      release: (error) => { this.releases.push(error); },
    };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

class LegacyImportPool implements PostgresPool {
  readonly queries: string[] = [];
  private readonly copied = new Set<string>();
  private readonly ledger = new Map<string, { count: number; checksum: string }>();

  private readonly columns: Readonly<Record<string, readonly string[]>> = {
    conversations: ['id', 'created_at', 'updated_at', 'metadata'],
    messages: ['conversation_id', 'sequence', 'payload', 'created_at'],
    checkpoints: ['run_id', 'pipeline_id', 'step', 'status', 'context', 'created_at', 'updated_at', 'expires_at', 'step_name', 'pause_metadata'],
    fred_api_keys: ['id', 'hash', 'scopes', 'rate_limit', 'revoked', 'verifier_id', 'verifier_version', 'verifier_metadata', 'expires_at', 'created_at'],
    fred_rate_limit_buckets: ['bucket_key', 'window_start', 'request_count', 'expires_at', 'decision_id'],
  };

  async connect(): Promise<PostgresClient> {
    return {
      query: async (text, values = []) => {
        this.queries.push(text);
        if (text.startsWith('SELECT source_table')) {
          return {
            rows: [...this.ledger].map(([source_table, entry]) => ({
              source_table,
              source_count: entry.count,
              source_checksum: entry.checksum,
              destination_count: entry.count,
              destination_checksum: entry.checksum,
            })),
            rowCount: this.ledger.size,
          };
        }
        if (text.startsWith('SELECT COUNT')) {
          const table = Object.keys(this.columns).find((name) => text.includes(`"${name}"`)) ?? 'messages';
          const isSource = text.includes('"public".');
          const present = isSource || this.copied.has(table);
          return { rows: [{ row_count: present ? '1' : '0', checksum: present ? `${table}-checksum` : 'empty' }], rowCount: 1 };
        }
        if (text.includes('information_schema.columns')) {
          const columns = this.columns[String(values[1])] ?? [];
          return { rows: [...columns].sort().map((column_name) => ({ column_name })), rowCount: columns.length };
        }
        if (text.startsWith('INSERT INTO "fred"."legacy_imports"')) {
          const [source_table, count, checksum] = values;
          this.ledger.set(String(source_table), { count: Number(count), checksum: String(checksum) });
          return { rows: [], rowCount: 1 };
        }
        if (text.startsWith('INSERT INTO "fred".')) {
          const table = Object.keys(this.columns).find((name) => text.includes(`"${name}"`));
          if (table !== undefined) this.copied.add(table);
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: null };
      },
      release: () => undefined,
    };
  }
}

test('construction and invalid schema perform no queries', async () => {
  const pool = new FakePool();
  const invalid = await Effect.runPromiseExit(makeFredPostgres({ pool, schema: 'fred; DROP SCHEMA public' }));
  expect(Exit.isFailure(invalid)).toBe(true);
  expect(pool.queries).toEqual([]);
  await Effect.runPromise(makeFredPostgres({ pool }));
  expect(pool.queries).toEqual([]);
});

test('rejects an invalid vector mode before constructing an owned pool', async () => {
  let connectionStringReads = 0;
  const options = new Proxy<FredPostgresOptions>(
    { connectionString: 'postgres://localhost/fred', vector: 'auto' },
    {
      get: (target, property, receiver) => {
        if (property === 'connectionString') connectionStringReads += 1;
        if (property === 'vector') return 'invalid';
        return Reflect.get(target, property, receiver);
      },
    },
  );

  const exit = await Effect.runPromiseExit(makeFredPostgres(options));

  expect(Exit.isFailure(exit)).toBe(true);
  expect(connectionStringReads).toBe(1);
});

describe('Fred Postgres migrations', () => {
  test('defines all store DDL under the requested schema', () => {
    const migrations = fredPostgresStoreMigrations('fred_test');
    const otherSchemaMigrations = fredPostgresStoreMigrations('another_schema');
    expect(migrations.map((migration) => migration.module)).toEqual([
      'context',
      'checkpoints',
      'http-api-keys',
      'http-rate-limits',
      'legacy-imports',
    ]);
    expect(otherSchemaMigrations.map((migration) => migration.checksum)).toEqual(
      migrations.map((migration) => migration.checksum),
    );
    for (const migration of migrations) {
      expect(migration.sql).toContain('"fred_test".');
      expect(migration.sql).not.toContain('"public".');
      const identity = `${migration.module}\0${migration.version}\0${migration.sql.replaceAll('"fred_test".', '"$schema".')}`;
      expect(migration.checksum).toBe(createHash('sha256').update(identity).digest('hex'));
      expect(migration.checksum).not.toBe(createHash('sha256').update(`${identity}\nSELECT 1;`).digest('hex'));
    }
  });

  test('copies legacy public context only after preflight and preserves the source', async () => {
    const pool = new LegacyImportPool();
    const preview = await Effect.runPromise(importLegacyFredPostgresStores({ pool, modules: ['context'], dryRun: true }));
    expect(preview.map((result) => result.status)).toEqual(['pending', 'pending']);
    expect(preview.map((result) => result.rowCount)).toEqual([1, 1]);
    expect(pool.queries).not.toContain('BEGIN');

    const first = await Effect.runPromise(importLegacyFredPostgresStores({ pool, modules: ['context'] }));
    const second = await Effect.runPromise(importLegacyFredPostgresStores({ pool, modules: ['context'] }));

    expect(first.map((result) => result.imported)).toEqual([true, true]);
    expect(first.map((result) => result.status)).toEqual(['imported', 'imported']);
    expect(second.map((result) => result.imported)).toEqual([false, false]);
    expect(second.map((result) => result.status)).toEqual(['verified', 'verified']);
    expect(pool.queries.some((query) => /(?:DELETE|UPDATE|ALTER|DROP)\s+.*"public"/i.test(query))).toBe(false);
    expect(pool.queries.findIndex((query) => query === 'BEGIN')).toBeGreaterThan(
      pool.queries.findIndex((query) => query.includes('information_schema.columns')),
    );
  });

  test('summarizes every legacy table by declared columns and primary key', async () => {
    const pool = new LegacyImportPool();
    await Effect.runPromise(importLegacyFredPostgresStores({ pool, dryRun: true }));

    const expected = [
      ['conversations', ['id', 'created_at', 'updated_at', 'metadata'], ['id']],
      ['messages', ['conversation_id', 'sequence', 'payload', 'created_at'], ['conversation_id', 'sequence']],
      ['checkpoints', ['run_id', 'pipeline_id', 'step', 'status', 'context', 'created_at', 'updated_at', 'expires_at', 'step_name', 'pause_metadata'], ['run_id', 'step']],
      ['fred_api_keys', ['id', 'hash', 'scopes', 'rate_limit', 'revoked', 'verifier_id', 'verifier_version', 'verifier_metadata', 'expires_at', 'created_at'], ['id']],
      ['fred_rate_limit_buckets', ['bucket_key', 'window_start', 'request_count', 'expires_at', 'decision_id'], ['bucket_key']],
    ] as const;
    const summaries = pool.queries.filter((query) => query.startsWith('SELECT COUNT'));

    expect(summaries).toHaveLength(expected.length * 2);
    expect(summaries.every((query) => !query.includes('row_to_json') && !query.includes('ctid'))).toBe(true);
    for (const [table, columns, primaryKey] of expected) {
      const query = summaries.find((candidate) => candidate.includes(`"public"."${table}"`)) ?? '';
      expect(query).toContain(`json_build_array(${columns.map((column) => `source_row."${column}"`).join(', ')})`);
      expect(query).toContain(`ORDER BY ${primaryKey.map((column) => `source_row."${column}"`).join(', ')}`);
    }
  });

  test('runs explicit migrations once and leaves caller-owned pools open', async () => {
    const pool = new FakePool();
    const database = await Effect.runPromise(makeFredPostgres({ pool, vector: 'auto' }));
    const migration = { module: 'connections', version: 1, checksum: 'abc', sql: 'CREATE TABLE test_connections (id TEXT)' };

    const first = await Effect.runPromise(database.migrate([migration]));
    const second = await Effect.runPromise(database.migrate([migration]));

    expect(first.modules).toEqual([{ module: 'connections', version: 1, checksum: 'abc' }]);
    expect(second.modules).toEqual(first.modules);
    expect(pool.queries.filter((query) => query === migration.sql)).toHaveLength(1);
    await Effect.runPromise(database.close);
    expect(pool.ended).toBe(false);
  });

  test('keeps pgvector disabled for auto and installs only when requested', async () => {
    const autoPool = new FakePool();
    const auto = await Effect.runPromise(makeFredPostgres({ pool: autoPool, vector: 'auto' }));
    expect((await Effect.runPromise(auto.migrate())).vector).toEqual({ mode: 'auto', enabled: false });
    expect(autoPool.queries.some((query) => query.startsWith('CREATE EXTENSION'))).toBe(false);

    const installPool = new FakePool();
    const install = await Effect.runPromise(makeFredPostgres({ pool: installPool, vector: 'install' }));
    expect((await Effect.runPromise(install.migrate())).vector).toEqual({ mode: 'install', enabled: true, version: '0.8.0' });
    expect(installPool.queries.some((query) => query.startsWith('CREATE EXTENSION'))).toBe(true);
  });

  test('does not query pgvector when off and fails typed when it is required', async () => {
    const offPool = new FakePool();
    const off = await Effect.runPromise(makeFredPostgres({ pool: offPool, vector: 'off' }));
    expect((await Effect.runPromise(off.migrate())).vector).toEqual({ mode: 'off', enabled: false });
    expect(offPool.queries.some((query) => query.includes('pg_extension'))).toBe(false);

    const required = await Effect.runPromise(makeFredPostgres({ pool: new FakePool(), vector: 'required' }));
    const exit = await Effect.runPromiseExit(required.migrate());
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrNull(Cause.failureOption(exit.cause))?._tag).toBe('PgvectorRequiredError');
    }

    const deniedPool = new FakePool();
    deniedPool.denyVectorInstall = true;
    const denied = await Effect.runPromise(makeFredPostgres({ pool: deniedPool, vector: 'install' }));
    const deniedExit = await Effect.runPromiseExit(denied.migrate());
    expect(Exit.isFailure(deniedExit)).toBe(true);
  });

  test('rolls back checksum drift and times out before migration work when locked', async () => {
    const pool = new FakePool();
    const database = await Effect.runPromise(makeFredPostgres({ pool }));
    await Effect.runPromise(database.migrate([{ module: 'connections', version: 1, checksum: 'first', sql: 'CREATE TABLE first_table (id TEXT)' }]));
    const drift = await Effect.runPromiseExit(database.migrate([
      { module: 'connections', version: 1, checksum: 'second', sql: 'CREATE TABLE second_table (id TEXT)' },
    ]));
    expect(Exit.isFailure(drift)).toBe(true);
    expect(pool.queries).toContain('ROLLBACK');
    expect(pool.queries).not.toContain('CREATE TABLE second_table (id TEXT)');

    const lockedPool = new FakePool();
    lockedPool.lockAvailable = false;
    const locked = await Effect.runPromise(makeFredPostgres({ pool: lockedPool, lockTimeoutMs: 0 }));
    const timeout = await Effect.runPromiseExit(locked.migrate());
    expect(Exit.isFailure(timeout)).toBe(true);
    expect(lockedPool.queries).not.toContain('BEGIN');
  });

  test('does not roll back committed migrations when diagnostics fail', async () => {
    const pool = new FakePool();
    pool.failMigrationRows = true;
    const database = await Effect.runPromise(makeFredPostgres({ pool }));

    const exit = await Effect.runPromiseExit(database.migrate([
      { module: 'connections', version: 1, checksum: 'abc', sql: 'CREATE TABLE connections (id TEXT)' },
    ]));

    expect(Exit.isFailure(exit)).toBe(true);
    expect(pool.queries).toContain('COMMIT');
    expect(pool.queries).not.toContain('ROLLBACK');
  });

  test('destroys a client when releasing its migration lock fails', async () => {
    const pool = new FakePool();
    pool.failUnlock = true;
    const database = await Effect.runPromise(makeFredPostgres({ pool }));

    const exit = await Effect.runPromiseExit(database.migrate());

    expect(Exit.isFailure(exit)).toBe(true);
    expect(pool.releases).toEqual([true]);
  });
});
