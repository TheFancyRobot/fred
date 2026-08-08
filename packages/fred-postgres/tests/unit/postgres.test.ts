import { describe, expect, test } from 'bun:test';
import { Cause, Effect, Exit, Option } from 'effect';
import {
  makeFredPostgres,
  type PostgresClient,
  type PostgresPool,
} from '../../src';

class FakePool implements PostgresPool {
  readonly queries: string[] = [];
  readonly ledger = new Map<string, string>();
  vectorInstalled = false;
  denyVectorInstall = false;
  lockAvailable = true;
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
        if (text.includes('pg_advisory_unlock')) return { rows: [{ unlocked: true }], rowCount: 1 };
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
      release: () => undefined,
    };
  }

  async end(): Promise<void> {
    this.ended = true;
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

describe('Fred Postgres migrations', () => {
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
});
