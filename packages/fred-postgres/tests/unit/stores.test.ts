import { expect, spyOn, test } from 'bun:test';
import { Pool } from 'pg';
import {
  PostgresCheckpointStorage,
  PostgresContextStorage,
  type PostgresStorePool,
} from '../../src';

test('context and checkpoint stores close only pools they own', async () => {
  let ownedCloseCount = 0;
  const end = spyOn(Pool.prototype, 'end').mockImplementation(async function (this: Pool) {
    ownedCloseCount += 1;
  });
  try {
    await new PostgresContextStorage({ connectionString: 'postgres://fred:fred@127.0.0.1/fred' }).close();
    await new PostgresCheckpointStorage({ connectionString: 'postgres://fred:fred@127.0.0.1/fred' }).close();
    expect(ownedCloseCount).toBe(2);

    let externalCloseCount = 0;
    const external: PostgresStorePool = {
      connect: async () => { throw new Error('not used'); },
      end: async () => { externalCloseCount += 1; },
    };
    await new PostgresContextStorage({ pool: external }).close();
    await new PostgresCheckpointStorage({ pool: external }).close();
    expect(externalCloseCount).toBe(0);
  } finally {
    end.mockRestore();
  }
});

const failingTransactionPool = (original: Error) => {
  const queries: string[] = [];
  const pool: PostgresStorePool = {
    connect: async () => ({
      query: async (sql) => {
        queries.push(sql);
        if (sql === 'BEGIN') return { rows: [], rowCount: null };
        if (sql === 'ROLLBACK') throw new Error('rollback failed');
        throw original;
      },
      release: () => undefined,
    }),
  };
  return { pool, queries };
};

test('context transactions preserve the original error when rollback fails', async () => {
  const operations = [
    (storage: PostgresContextStorage) => storage.set('conversation', {
      id: 'conversation',
      messages: [],
      metadata: { createdAt: new Date(0), updatedAt: new Date(0) },
    }),
    (storage: PostgresContextStorage) => storage.delete('conversation'),
    (storage: PostgresContextStorage) => storage.clear(),
  ];

  for (const operation of operations) {
    const original = new Error('write failed');
    const { pool, queries } = failingTransactionPool(original);
    await expect(operation(new PostgresContextStorage({ pool }))).rejects.toBe(original);
    expect(queries).toContain('ROLLBACK');
  }
});

test('context saves insert every message in one ordered query', async () => {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const pool: PostgresStorePool = {
    connect: async () => ({
      query: async (sql, values) => {
        queries.push({ sql, values });
        return { rows: [], rowCount: null };
      },
      release: () => undefined,
    }),
  };
  const messages = [
    { role: 'user' as const, content: 'first' },
    { role: 'assistant' as const, content: 'second' },
  ];

  await new PostgresContextStorage({ pool }).set('conversation', {
    id: 'conversation',
    messages,
    metadata: { createdAt: new Date(0), updatedAt: new Date(0) },
  });

  const inserts = queries.filter(({ sql }) => sql.includes('jsonb_array_elements'));
  expect(inserts).toHaveLength(1);
  expect(inserts[0]?.sql).toContain('WITH ORDINALITY');
  expect(inserts[0]?.sql).toContain('(ordinality - 1)::integer');
  expect(JSON.parse(String(inserts[0]?.values?.[1]))).toEqual(messages);

  queries.length = 0;
  await new PostgresContextStorage({ pool }).set('empty', {
    id: 'empty',
    messages: [],
    metadata: { createdAt: new Date(0), updatedAt: new Date(0) },
  });
  expect(queries.filter(({ sql }) => sql.includes('jsonb_array_elements'))).toHaveLength(0);
});

test('checkpoint transactions preserve the original error when rollback fails', async () => {
  const original = new Error('write failed');
  const { pool, queries } = failingTransactionPool(original);
  await expect(new PostgresCheckpointStorage({ pool }).deleteRun('run')).rejects.toBe(original);
  expect(queries).toContain('ROLLBACK');
});
