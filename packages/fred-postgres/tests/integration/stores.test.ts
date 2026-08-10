import { test, expect } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Effect } from 'effect';
import { Pool } from 'pg';
import {
  importLegacyFredPostgresStores,
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
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ],
      metadata: { createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z') },
    });
    await checkpoints.save({
      runId: 'run-1', pipelineId: 'pipeline-1', step: 0, status: 'pending',
      context: { pipelineId: 'pipeline-1', input: 'test', outputs: {}, history: [], metadata: {} },
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });

    expect(await context.get('conversation-1')).toMatchObject({
      id: 'conversation-1',
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ],
    });
    expect((await checkpoints.getLatest('run-1'))?.runId).toBe('run-1');
    expect((await pool.query(`SELECT payload FROM ${sentinel}.sentinel`)).rows).toEqual([{ payload: 'unchanged' }]);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.query(`DROP SCHEMA IF EXISTS ${sentinel} CASCADE`);
    await pool.end();
  }
});

integration('imports legacy context with different physical column order', async () => {
  const pool = new Pool({ connectionString });
  const schema = testSchema();
  let conversationsCreated = false;
  let messagesCreated = false;
  try {
    const existing = await pool.query(`SELECT to_regclass('public.conversations') AS conversations, to_regclass('public.messages') AS messages`);
    expect(existing.rows[0]).toEqual({ conversations: null, messages: null });

    const database = await Effect.runPromise(makeFredPostgres({ pool, schema, vector: 'off' }));
    await Effect.runPromise(migrateFredPostgresStores(database));
    await pool.query(`CREATE TABLE "public"."conversations" (metadata JSONB NOT NULL, id TEXT PRIMARY KEY, updated_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL)`);
    conversationsCreated = true;
    await pool.query(`CREATE TABLE "public"."messages" (payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, sequence INTEGER NOT NULL, conversation_id TEXT NOT NULL, PRIMARY KEY (conversation_id, sequence))`);
    messagesCreated = true;
    await pool.query(`INSERT INTO "public"."conversations" (id, created_at, updated_at, metadata) VALUES ('b', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', '{"position":2}'), ('a', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '{"position":1}')`);
    await pool.query(`INSERT INTO "public"."messages" (conversation_id, sequence, payload, created_at) VALUES ('b', 0, '{"content":"second"}', '2026-01-02T00:00:00Z'), ('a', 0, '{"content":"first"}', '2026-01-01T00:00:00Z')`);

    const imported = await Effect.runPromise(importLegacyFredPostgresStores({ pool, schema, modules: ['context'] }));
    const verified = await Effect.runPromise(importLegacyFredPostgresStores({ pool, schema, modules: ['context'] }));

    expect(imported.map((result) => [result.rowCount, result.status])).toEqual([[2, 'imported'], [2, 'imported']]);
    expect(verified.map((result) => result.status)).toEqual(['verified', 'verified']);
    expect((await pool.query(`SELECT id FROM "${schema}"."conversations" ORDER BY id`)).rows).toEqual([{ id: 'a' }, { id: 'b' }]);
  } finally {
    if (messagesCreated) await pool.query(`DROP TABLE "public"."messages"`);
    if (conversationsCreated) await pool.query(`DROP TABLE "public"."conversations"`);
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});

integration('serializes concurrent legacy imports into the same schema', async () => {
  const pool = new Pool({ connectionString });
  const schema = testSchema();
  let sourceCreated = false;
  let releaseBegins = () => undefined;
  const bothBegun = new Promise<void>((resolve) => { releaseBegins = resolve; });
  let beginCount = 0;
  const synchronizedPool = {
    connect: async () => {
      const client = await pool.connect();
      return {
        query: async (text: string, values?: unknown[]) => {
          const result = await client.query(text, values);
          if (text === 'BEGIN') {
            beginCount += 1;
            if (beginCount === 2) releaseBegins();
            await bothBegun;
          }
          return result;
        },
        release: () => client.release(),
      };
    },
  };
  try {
    const existing = await pool.query(`SELECT to_regclass('public.checkpoints') AS checkpoints`);
    expect(existing.rows[0]).toEqual({ checkpoints: null });

    const database = await Effect.runPromise(makeFredPostgres({ pool, schema, vector: 'off' }));
    await Effect.runPromise(migrateFredPostgresStores(database));
    await pool.query(`CREATE TABLE "public"."checkpoints" (run_id TEXT NOT NULL, pipeline_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, context JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL, expires_at TIMESTAMPTZ, step_name TEXT, pause_metadata JSONB, PRIMARY KEY (run_id, step))`);
    sourceCreated = true;
    await pool.query(`INSERT INTO "public"."checkpoints" (run_id, pipeline_id, step, status, context, created_at, updated_at) VALUES ('run-1', 'pipeline-1', 0, 'pending', '{}', NOW(), NOW())`);

    const imports = await Promise.all([
      Effect.runPromise(importLegacyFredPostgresStores({ pool: synchronizedPool, schema, modules: ['checkpoints'] })),
      Effect.runPromise(importLegacyFredPostgresStores({ pool: synchronizedPool, schema, modules: ['checkpoints'] })),
    ]);

    expect(imports.map(([result]) => result?.status).sort()).toEqual(['imported', 'verified']);
    expect((await pool.query(`SELECT COUNT(*)::integer AS count FROM "${schema}"."checkpoints"`)).rows).toEqual([{ count: 1 }]);
    expect((await pool.query(`SELECT COUNT(*)::integer AS count FROM "${schema}"."legacy_imports" WHERE source_table = 'checkpoints'`)).rows).toEqual([{ count: 1 }]);
  } finally {
    if (sourceCreated) await pool.query(`DROP TABLE "public"."checkpoints"`);
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
