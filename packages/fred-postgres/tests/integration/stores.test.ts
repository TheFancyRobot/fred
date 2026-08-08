import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { Pool } from 'pg';
import {
  makeFredPostgres,
  migrateFredPostgresStores,
  PostgresCheckpointStorage,
  PostgresContextStorage,
} from '../../src';

const connectionString = process.env.FRED_TEST_POSTGRES_URL;
const integration = connectionString === undefined ? test.skip : test;
const testSchema = () => `fred_test_${randomUUID().replaceAll('-', '')}`;

integration('migrates schema-qualified stores without runtime DDL', async () => {
  const pool = new Pool({ connectionString });
  const schema = testSchema();
  const sentinel = testSchema();
  try {
    await pool.query(`CREATE SCHEMA ${sentinel}`);
    await pool.query(`CREATE TABLE ${sentinel}.sentinel (payload TEXT NOT NULL)`);
    await pool.query(`INSERT INTO ${sentinel}.sentinel (payload) VALUES ('unchanged')`);

    const database = await Effect.runPromise(makeFredPostgres({ pool, schema, vector: 'off' }));
    await Effect.runPromise(migrateFredPostgresStores(database));
    const context = new PostgresContextStorage({ pool, schema });
    const checkpoints = new PostgresCheckpointStorage({ pool, schema });

    await context.set('conversation-1', {
      id: 'conversation-1',
      messages: [],
      metadata: { createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    });
    await checkpoints.save({
      runId: 'run-1', pipelineId: 'pipeline-1', step: 0, status: 'pending',
      context: { pipelineId: 'pipeline-1', input: 'test', outputs: {}, history: [], metadata: {} },
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect((await context.get('conversation-1'))?.id).toBe('conversation-1');
    expect((await checkpoints.getLatest('run-1'))?.runId).toBe('run-1');
    expect((await pool.query(`SELECT payload FROM ${sentinel}.sentinel`)).rows).toEqual([{ payload: 'unchanged' }]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${sentinel} CASCADE`);
    await pool.end();
  }
});
