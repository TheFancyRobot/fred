import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { Pool } from 'pg';
import { makeFredPostgres } from '../../src';

const connectionString = process.env.FRED_TEST_POSTGRES_URL;
const integration = connectionString === undefined ? test.skip : test;

const testSchema = (): string => `fred_test_${randomUUID().replaceAll('-', '')}`;

integration('serializes explicit migrations without touching sentinel data', async () => {
  const pool = new Pool({ connectionString });
  const schema = testSchema();
  const sentinel = testSchema();
  try {
    await pool.query(`CREATE SCHEMA ${sentinel}`);
    await pool.query(`CREATE TABLE ${sentinel}.sentinel (payload TEXT NOT NULL)`);
    await pool.query(`INSERT INTO ${sentinel}.sentinel (payload) VALUES ('unchanged')`);

    const first = await Effect.runPromise(makeFredPostgres({ pool, schema }));
    const second = await Effect.runPromise(makeFredPostgres({ pool, schema }));
    const migration = {
      module: 'connections',
      version: 1,
      checksum: 'connections-v1',
      sql: `CREATE TABLE ${schema}.managed_connections (id TEXT PRIMARY KEY)`,
    };

    await Promise.all([
      Effect.runPromise(first.migrate([migration])),
      Effect.runPromise(second.migrate([migration])),
    ]);

    expect((await pool.query(`SELECT payload FROM ${sentinel}.sentinel`)).rows).toEqual([{ payload: 'unchanged' }]);
    expect((await pool.query(`SELECT module, version, checksum FROM ${schema}.schema_migrations`)).rows).toEqual([
      { module: 'connections', version: 1, checksum: 'connections-v1' },
    ]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${sentinel} CASCADE`);
    await pool.end();
  }
});
