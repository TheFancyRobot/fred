import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Effect, Exit, Option } from 'effect';
import {
  API_KEY_TABLE,
  ApiKeyAuthenticationError,
  ApiKeyDuplicateIdError,
  ApiKeyScopeError,
  authorizeApiKey,
  generateApiKey,
  makeMemoryApiKeyStore,
  makePostgresApiKeyStore,
  makeSqliteApiKeyStore,
  type ApiKeyRecord,
  type PostgresApiKeyPool,
} from '../../../packages/fred-http/src';
import { handleKeysCommand } from '../../../packages/cli/src/commands/keys';
import { createFred, defineWorkflow } from '../../../packages/core/src';
import { withHttp } from '../../../packages/fred-http/src';

const databases: Database[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

const failure = async (effect: Effect.Effect<unknown, unknown>) => {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  return Exit.isFailure(exit) ? exit.cause : undefined;
};

describe('API key authorization', () => {
  test('covers absent, malformed, unknown, mismatched, revoked, scoped, and valid keys', async () => {
    const store = makeMemoryApiKeyStore();
    const generated = generateApiKey(['workflows:read', 'workflows:run']);
    await Effect.runPromise(store.insert(generated.record));

    expect(String(await failure(authorizeApiKey(store, undefined)))).toContain(ApiKeyAuthenticationError.name);
    expect(String(await failure(authorizeApiKey(store, 'Basic nope'))).toLowerCase()).toContain('malformed');
    expect(String(await failure(authorizeApiKey(store, `Bearer fred_missing1.${'x'.repeat(43)}`))).toLowerCase()).toContain('unknown');

    const [prefix, secret] = generated.token.split('.');
    const wrongToken = `${prefix}.${secret!.slice(0, -1)}${secret!.endsWith('a') ? 'b' : 'a'}`;
    expect(String(await failure(authorizeApiKey(store, `Bearer ${wrongToken}`))).toLowerCase()).toContain('invalid');
    expect(String(await failure(authorizeApiKey(store, `Bearer ${generated.token}`, ['admin'])))).toContain(ApiKeyScopeError.name);

    const subset = await Effect.runPromise(authorizeApiKey(store, `Bearer ${generated.token}`, ['workflows:run']));
    expect(subset.id).toBe(generated.record.id);
    const superset = await Effect.runPromise(authorizeApiKey(
      store,
      `Bearer ${generated.token}`,
      ['workflows:read', 'workflows:run'],
    ));
    expect(superset.scopes).toEqual(['workflows:read', 'workflows:run']);

    expect(await Effect.runPromise(store.revoke(generated.record.id))).toBe(true);
    expect(String(await failure(authorizeApiKey(store, `Bearer ${generated.token}`))).toLowerCase()).toContain('revoked');
  });

  test('allows exactly one winner for concurrent duplicate ids', async () => {
    const store = makeMemoryApiKeyStore();
    const first = generateApiKey([], { id: 'duplicate-id' });
    const second = generateApiKey([], { id: 'duplicate-id' });
    const exits = await Promise.all([
      Effect.runPromiseExit(store.insert(first.record)),
      Effect.runPromiseExit(store.insert(second.record)),
    ]);
    expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
    expect(exits.filter(Exit.isFailure)).toHaveLength(1);
  });

  test('enforces public and all-required workflow endpoint scopes', async () => {
    const core = await createFred();
    await core.workflows.define(defineWorkflow({
      id: 'scoped',
      entry: 'done',
      nodes: [{ id: 'done', kind: 'function', fn: () => 'ok' }],
      edges: [],
    }));
    await core.workflows.define(defineWorkflow({
      id: 'public',
      entry: 'done',
      nodes: [{ id: 'done', kind: 'function', fn: () => 'ok' }],
      edges: [],
    }));
    const store = makeMemoryApiKeyStore();
    const insufficient = generateApiKey(['workflow:read']);
    const sufficient = generateApiKey(['workflow:read', 'workflow:run']);
    await Effect.runPromise(Effect.all([
      store.insert(insufficient.record),
      store.insert(sufficient.record),
    ]));
    const fred = withHttp(core, {
      apiKeyStore: store,
      workflowEndpoints: {
        scoped: { auth: { scopes: ['workflow:read', 'workflow:run'] } },
        public: { auth: false },
      },
    });
    const handle = await fred.server.listen();
    try {
      const invoke = (path: string, token?: string) => fetch(`${handle.url}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify('input'),
      });
      expect((await invoke('/workflows/scoped')).status).toBe(401);
      expect((await invoke('/workflows/scoped', insufficient.token)).status).toBe(403);
      expect((await invoke('/workflows/scoped', sufficient.token)).status).toBe(200);
      expect((await invoke('/workflows/public')).status).toBe(200);
      expect(handle.authToken).toBeUndefined();
    } finally {
      await fred.shutdown();
    }
  });
});

describe('API key durable stores', () => {
  test('initializes SQLite idempotently and persists hash-only records', async () => {
    const database = new Database(':memory:');
    databases.push(database);
    const store = makeSqliteApiKeyStore(':memory:', database);
    await Effect.runPromise(store.initialize);
    await Effect.runPromise(store.initialize);
    const generated = generateApiKey(['workflow:run'], {
      rateLimit: { maxRequests: 5, windowMs: 1_000 },
    });
    await Effect.runPromise(store.insert(generated.record));

    const row = database.query(`SELECT * FROM ${API_KEY_TABLE} WHERE id = ?`).get(generated.record.id);
    const serialized = JSON.stringify(row);
    expect(serialized).toContain(generated.record.hash);
    expect(serialized).not.toContain(generated.token);
    expect(serialized).not.toContain(generated.token.split('.')[1]!);

    const loaded = await Effect.runPromise(store.findById(generated.record.id));
    expect(Option.isSome(loaded)).toBe(true);
    if (Option.isSome(loaded)) expect(loaded.value.rateLimit).toEqual(generated.record.rateLimit);
    const duplicateExit = await Effect.runPromiseExit(store.insert(generated.record));
    expect(Exit.isFailure(duplicateExit)).toBe(true);
    if (Exit.isFailure(duplicateExit)) expect(String(duplicateExit.cause)).toContain(ApiKeyDuplicateIdError.name);
  });

  test('uses idempotent Postgres DDL and injected pool operations', async () => {
    const records = new Map<string, ApiKeyRecord>();
    let ddlCount = 0;
    const pool: PostgresApiKeyPool = {
      async query(sql: string, values: unknown[] = []) {
        if (sql.startsWith('CREATE TABLE')) {
          ddlCount += 1;
          return { rows: [], rowCount: null };
        }
        if (sql.startsWith('INSERT')) {
          const record: ApiKeyRecord = {
            id: String(values[0]),
            hash: String(values[1]),
            scopes: JSON.parse(String(values[2])),
            rateLimit: values[3] === null ? Option.none() : Option.some(JSON.parse(String(values[3]))),
            revoked: Boolean(values[4]),
            createdAt: values[5] instanceof Date ? values[5] : new Date(String(values[5])),
          };
          records.set(record.id, record);
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT')) {
          const record = records.get(String(values[0]));
          const rows = record === undefined ? [] : [{
            id: record.id,
            hash: record.hash,
            scopes: record.scopes,
            rate_limit: Option.getOrNull(record.rateLimit),
            revoked: record.revoked,
            created_at: record.createdAt,
          }];
          return { rows, rowCount: rows.length };
        }
        const record = records.get(String(values[0]));
        if (record) records.set(record.id, { ...record, revoked: true });
        return { rows: [], rowCount: record ? 1 : 0 };
      },
    };
    const store = makePostgresApiKeyStore(pool);
    await Effect.runPromise(store.initialize);
    await Effect.runPromise(store.initialize);
    expect(ddlCount).toBe(2);
    const generated = generateApiKey(['read']);
    await Effect.runPromise(store.insert(generated.record));
    expect(Option.isSome(await Effect.runPromise(store.findById(generated.record.id)))).toBe(true);
    expect(await Effect.runPromise(store.revoke(generated.record.id))).toBe(true);
  });
});

describe('fred keys create', () => {
  test('rejects memory and emits a raw key only once after durable success', async () => {
    const stdout = spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await handleKeysCommand(['create'], { memory: true })).toBe(1);
    expect(stdout).not.toHaveBeenCalled();

    const path = `/tmp/fred-api-keys-${crypto.randomUUID()}.sqlite`;
    expect(await handleKeysCommand(['create'], {
      sqlite: path,
      scopes: 'workflows:read,workflows:run',
      id: 'cli-test-key',
    })).toBe(0);
    expect(stdout).toHaveBeenCalledTimes(1);
    const token = String(stdout.mock.calls[0]![0]);
    expect(token).toStartWith('fred_cli-test-key.');
    expect(stderr.mock.calls.flat().join(' ')).not.toContain(token);

    const database = new Database(path);
    databases.push(database);
    const row = database.query(`SELECT * FROM ${API_KEY_TABLE}`).get();
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(row)).not.toContain(token.split('.')[1]!);
    expect(await handleKeysCommand(['create'], {
      sqlite: path,
      scopes: 'workflows:run',
      id: 'cli-test-key',
    })).toBe(1);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stderr.mock.calls.flat().join(' ')).not.toContain(token);
    stdout.mockRestore();
    stderr.mockRestore();
    await Bun.file(path).delete();
  });

  test('does not emit a key when persistence fails', async () => {
    const stdout = spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await handleKeysCommand(['create'], { sqlite: '/missing-parent/nope/keys.sqlite' })).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(1);
    stdout.mockRestore();
    stderr.mockRestore();
  });

  test('rejects invalid scopes and an unavailable fred-http package without output', async () => {
    const stdout = spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await handleKeysCommand(['create'], {
      sqlite: ':memory:',
      scopes: 'valid,not valid',
    })).toBe(1);
    expect(await handleKeysCommand(
      ['create'],
      { sqlite: ':memory:' },
      async () => { throw new Error('module unavailable'); },
    )).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).toHaveBeenCalledTimes(2);
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
