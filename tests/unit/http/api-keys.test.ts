import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { Effect, Exit, Option, Schema } from 'effect';
import {
  API_KEY_VERIFIER_IDS,
  API_KEY_TABLE,
  ApiKeyAuthenticationError,
  ApiKeyDuplicateIdError,
  ApiKeyVerifierConfigurationError,
  ApiKeyScopeError,
  LEGACY_SHA256_DESCRIPTOR,
  authorizeApiKey,
  generateApiKey,
  hashApiKey,
  makeApiKeyVerifierRegistry,
  makeArgon2idApiKeyVerifier,
  makeHmacApiKeyVerifier,
  makeMemoryApiKeyStore,
  makePbkdf2ApiKeyVerifier,
  makePostgresApiKeyStore,
  makeScryptApiKeyVerifier,
  makeSqliteApiKeyStore,
  type ApiKeyVerifier,
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
  test('defaults to Argon2id and dispatches every built-in plus a custom verifier', async () => {
    const custom: ApiKeyVerifier = {
      id: 'test-custom-v1',
      metadataSchema: Schema.Struct({ marker: Schema.Literal('test') }),
      canDerive: true,
      derive: (token) => Effect.succeed({
        verifier: { id: 'test-custom-v1', version: 1, metadata: { marker: 'test' } },
        hash: `custom:${hashApiKey(token)}`,
      }),
      verify: (token, hash) => Effect.succeed(hash === `custom:${hashApiKey(token)}`),
    };
    const hmac = makeHmacApiKeyVerifier({
      currentKeyId: 'current',
      keys: { current: 'c'.repeat(32), previous: 'p'.repeat(32) },
    });
    const verifiers = [
      makeArgon2idApiKeyVerifier({ memoryCost: 4_096, timeCost: 1 }),
      makeScryptApiKeyVerifier({ cost: 4_096 }),
      makePbkdf2ApiKeyVerifier(100_000),
      hmac,
      custom,
    ];
    for (const verifier of verifiers) {
      const registry = makeApiKeyVerifierRegistry(verifiers, verifier.id);
      const generated = await Effect.runPromise(generateApiKey([], { verifierRegistry: registry }));
      expect(generated.record.verifier.id).toBe(verifier.id);
      const store = makeMemoryApiKeyStore();
      await Effect.runPromise(store.insert(generated.record));
      expect((await Effect.runPromise(authorizeApiKey(
        store,
        `Bearer ${generated.token}`,
        [],
        { verifierRegistry: registry, upgradeVerifierId: false },
      ))).id).toBe(generated.record.id);
    }
    const generated = await Effect.runPromise(generateApiKey([]));
    expect(generated.record.verifier.id).toBe(API_KEY_VERIFIER_IDS.argon2id);
  });

  test('fails closed for unknown providers and invalid verifier metadata', async () => {
    const store = makeMemoryApiKeyStore();
    const token = `fred_unknown1.${'x'.repeat(43)}`;
    await Effect.runPromise(store.insert({
      id: 'unknown1',
      hash: hashApiKey(token),
      verifier: { id: 'disabled-v1', version: 1, metadata: {} },
      scopes: [],
      rateLimit: Option.none(),
      revoked: false,
      expiresAt: Option.none(),
      createdAt: new Date(),
    }));
    expect(String(await failure(authorizeApiKey(store, `Bearer ${token}`)))).toContain('verifier');

    const generated = await Effect.runPromise(generateApiKey([], {
      verifierRegistry: makeApiKeyVerifierRegistry([makeScryptApiKeyVerifier({ cost: 4_096 })], API_KEY_VERIFIER_IDS.scrypt),
    }));
    const invalidStore = makeMemoryApiKeyStore();
    await Effect.runPromise(invalidStore.insert({
      ...generated.record,
      verifier: { ...generated.record.verifier, metadata: { cost: 99 } },
    }));
    expect(String(await failure(authorizeApiKey(invalidStore, `Bearer ${generated.token}`)))).toContain('verifier');
  });

  test('validates registry ids and verifier parameters with typed configuration errors', async () => {
    const invalidVerifier: ApiKeyVerifier = {
      id: 'INVALID',
      metadataSchema: Schema.Struct({}),
      canDerive: true,
      derive: () => Effect.die('not called'),
      verify: () => Effect.die('not called'),
    };
    expect(() => makeApiKeyVerifierRegistry([invalidVerifier], invalidVerifier.id)).toThrow(ApiKeyVerifierConfigurationError);
    expect(() => makeScryptApiKeyVerifier({ cost: 5_000 })).toThrow(ApiKeyVerifierConfigurationError);
    expect(() => makePbkdf2ApiKeyVerifier(99_999)).toThrow(ApiKeyVerifierConfigurationError);

    const registry = makeApiKeyVerifierRegistry([makeArgon2idApiKeyVerifier({ memoryCost: 4_096, timeCost: 1 })]);
    expect(String(await failure(registry.register({ ...invalidVerifier, id: 'no spaces' })))).toContain(ApiKeyVerifierConfigurationError.name);
  });

  test('verifies legacy SHA-256 and lazily upgrades exactly once under concurrency', async () => {
    const store = makeMemoryApiKeyStore();
    const token = `fred_legacy01.${randomToken()}`;
    await Effect.runPromise(store.insert({
      id: 'legacy01',
      hash: hashApiKey(token),
      verifier: LEGACY_SHA256_DESCRIPTOR,
      scopes: ['run'],
      rateLimit: Option.none(),
      revoked: false,
      expiresAt: Option.none(),
      createdAt: new Date(),
    }));
    let successfulUpgrades = 0;
    const original = store.compareAndSwapVerifier;
    store.compareAndSwapVerifier = (id, expectedHash, replacement) => original(id, expectedHash, replacement).pipe(
      Effect.tap((updated) => Effect.sync(() => { if (updated) successfulUpgrades += 1; })),
    );
    await Promise.all([
      Effect.runPromise(authorizeApiKey(store, `Bearer ${token}`, ['run'])),
      Effect.runPromise(authorizeApiKey(store, `Bearer ${token}`, ['run'])),
    ]);
    expect(successfulUpgrades).toBe(1);
    const loaded = await Effect.runPromise(store.findById('legacy01'));
    expect(Option.isSome(loaded) && loaded.value.verifier.id).toBe(API_KEY_VERIFIER_IDS.argon2id);
  });

  test('does not upgrade revoked, expired, or insufficient-scope legacy records', async () => {
    for (const state of ['revoked', 'expired', 'scope'] as const) {
      const store = makeMemoryApiKeyStore();
      const id = `${state}001`;
      const token = `fred_${id}.${randomToken()}`;
      await Effect.runPromise(store.insert({
        id,
        hash: hashApiKey(token),
        verifier: LEGACY_SHA256_DESCRIPTOR,
        scopes: [],
        rateLimit: Option.none(),
        revoked: state === 'revoked',
        expiresAt: state === 'expired' ? Option.some(new Date(0)) : Option.none(),
        createdAt: new Date(),
      }));
      await failure(authorizeApiKey(store, `Bearer ${token}`, state === 'scope' ? ['run'] : []));
      const loaded = await Effect.runPromise(store.findById(id));
      expect(Option.isSome(loaded) && loaded.value.verifier.id).toBe(API_KEY_VERIFIER_IDS.legacySha256);
    }
  });

  test('rotates stale HMAC key ids without persisting pepper material', async () => {
    const previous = makeApiKeyVerifierRegistry([
      makeHmacApiKeyVerifier({ currentKeyId: 'previous', keys: { previous: 'p'.repeat(32) } }),
    ], API_KEY_VERIFIER_IDS.hmac);
    const generated = await Effect.runPromise(generateApiKey([], { verifierRegistry: previous }));
    const current = makeApiKeyVerifierRegistry([
      makeHmacApiKeyVerifier({
        currentKeyId: 'current',
        keys: { current: 'c'.repeat(32), previous: 'p'.repeat(32) },
      }),
    ], API_KEY_VERIFIER_IDS.hmac);
    const store = makeMemoryApiKeyStore();
    await Effect.runPromise(store.insert(generated.record));
    await Effect.runPromise(authorizeApiKey(store, `Bearer ${generated.token}`, [], { verifierRegistry: current }));
    expect(JSON.stringify(generated.record)).not.toContain('p'.repeat(32));
    expect(generated.record.verifier.metadata).toEqual({ keyId: 'previous', digest: 'sha256' });
    const rotated = await Effect.runPromise(store.findById(generated.record.id));
    expect(Option.isSome(rotated) && rotated.value.verifier.metadata).toEqual({ keyId: 'current', digest: 'sha256' });
    const currentOnly = makeApiKeyVerifierRegistry([
      makeHmacApiKeyVerifier({ currentKeyId: 'current', keys: { current: 'c'.repeat(32) } }),
    ], API_KEY_VERIFIER_IDS.hmac);
    await Effect.runPromise(authorizeApiKey(store, `Bearer ${generated.token}`, [], { verifierRegistry: currentOnly }));
  });

  test('does not rewrite valid custom verifier records to the registry default', async () => {
    const custom: ApiKeyVerifier = {
      id: 'custom-stable-v1',
      metadataSchema: Schema.Struct({ marker: Schema.Literal('stable') }),
      canDerive: true,
      derive: (token) => Effect.succeed({
        verifier: { id: 'custom-stable-v1', version: 1, metadata: { marker: 'stable' } },
        hash: `custom:${hashApiKey(token)}`,
      }),
      verify: (token, hash) => Effect.succeed(hash === `custom:${hashApiKey(token)}`),
    };
    const registry = makeApiKeyVerifierRegistry([
      makeArgon2idApiKeyVerifier({ memoryCost: 4_096, timeCost: 1 }),
      custom,
    ]);
    const generated = await Effect.runPromise(generateApiKey([], {
      verifierId: custom.id,
      verifierRegistry: registry,
    }));
    const store = makeMemoryApiKeyStore();
    await Effect.runPromise(store.insert(generated.record));
    await Effect.runPromise(authorizeApiKey(store, `Bearer ${generated.token}`, [], { verifierRegistry: registry }));
    const loaded = await Effect.runPromise(store.findById(generated.record.id));
    expect(Option.isSome(loaded) && loaded.value.verifier.id).toBe(custom.id);
  });

  test('covers absent, malformed, unknown, mismatched, revoked, scoped, and valid keys', async () => {
    const store = makeMemoryApiKeyStore();
    const generated = await Effect.runPromise(generateApiKey(['workflows:read', 'workflows:run']));
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
    const first = await Effect.runPromise(generateApiKey([], { id: 'duplicate-id' }));
    const second = await Effect.runPromise(generateApiKey([], { id: 'duplicate-id' }));
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
    const insufficient = await Effect.runPromise(generateApiKey(['workflow:read']));
    const sufficient = await Effect.runPromise(generateApiKey(['workflow:read', 'workflow:run']));
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
      expect((await invoke('/workflows/%73coped', insufficient.token)).status).toBe(403);
      expect((await invoke('/workflows/%73coped', sufficient.token)).status).toBe(200);
      expect((await invoke('/workflows/public')).status).toBe(200);
      expect(handle.authToken).toBeUndefined();
    } finally {
      await fred.shutdown();
    }
  });
});

const randomToken = (): string => crypto.getRandomValues(new Uint8Array(32)).toBase64({ alphabet: 'base64url', omitPadding: true });

describe('API key durable stores', () => {
  test('migrates a pre-verifier SQLite table idempotently and lazily upgrades its legacy row', async () => {
    const database = new Database(':memory:');
    databases.push(database);
    database.exec(`CREATE TABLE ${API_KEY_TABLE} (
      id TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      scopes TEXT NOT NULL,
      rate_limit TEXT,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    const token = `fred_migrate1.${randomToken()}`;
    database.query(
      `INSERT INTO ${API_KEY_TABLE} (id, hash, scopes, rate_limit, revoked, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('migrate1', hashApiKey(token), '[]', null, 0, new Date().toISOString());
    const store = makeSqliteApiKeyStore(':memory:', database);
    await Effect.runPromise(store.initialize);
    await Effect.runPromise(store.initialize);
    const before = await Effect.runPromise(store.findById('migrate1'));
    expect(Option.isSome(before) && before.value.verifier.id).toBe(API_KEY_VERIFIER_IDS.legacySha256);
    await Effect.runPromise(authorizeApiKey(store, `Bearer ${token}`));
    const after = await Effect.runPromise(store.findById('migrate1'));
    expect(Option.isSome(after) && after.value.verifier.id).toBe(API_KEY_VERIFIER_IDS.argon2id);
    const row = database.query(`SELECT * FROM ${API_KEY_TABLE} WHERE id = ?`).get('migrate1');
    expect(JSON.stringify(row)).not.toContain(token);
  });

  test('initializes SQLite idempotently and persists hash-only records', async () => {
    const database = new Database(':memory:');
    databases.push(database);
    const store = makeSqliteApiKeyStore(':memory:', database);
    await Effect.runPromise(store.initialize);
    await Effect.runPromise(store.initialize);
    const generated = await Effect.runPromise(generateApiKey(['workflow:run'], {
      rateLimit: { maxRequests: 5, windowMs: 1_000 },
    }));
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
            verifier: {
              id: String(values[5]),
              version: Number(values[6]),
              metadata: JSON.parse(String(values[7])),
            },
            scopes: JSON.parse(String(values[2])),
            rateLimit: values[3] === null ? Option.none() : Option.some(JSON.parse(String(values[3]))),
            revoked: Boolean(values[4]),
            expiresAt: values[8] === null ? Option.none() : Option.some(new Date(String(values[8]))),
            createdAt: values[9] instanceof Date ? values[9] : new Date(String(values[9])),
          };
          records.set(record.id, record);
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith('SELECT')) {
          const record = records.get(String(values[0]));
          const rows = record === undefined ? [] : [{
            id: record.id,
            hash: record.hash,
            verifier_id: record.verifier.id,
            verifier_version: record.verifier.version,
            verifier_metadata: record.verifier.metadata,
            scopes: record.scopes,
            rate_limit: Option.getOrNull(record.rateLimit),
            revoked: record.revoked,
            expires_at: Option.getOrNull(record.expiresAt),
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
    const generated = await Effect.runPromise(generateApiKey(['read']));
    await Effect.runPromise(store.insert(generated.record));
    expect(Option.isSome(await Effect.runPromise(store.findById(generated.record.id)))).toBe(true);
    expect(await Effect.runPromise(store.revoke(generated.record.id))).toBe(true);
  });
});

describe('fred keys create', () => {
  test('binds API-key migrations and storage to the canonical Postgres schema', async () => {
    const source = await Bun.file('packages/cli/src/commands/keys.ts').text();
    expect(source).toContain('process.env.FRED_POSTGRES_SCHEMA ?? postgres.DEFAULT_POSTGRES_SCHEMA');
    expect(source).toContain('makeFredPostgres({ pool, schema })');
    expect(source).toContain('fredPostgresStoreMigrations(schema)');
    expect(source).toContain('makePostgresApiKeyStore(pool, { schema })');
  });

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

  test('rejects non-ISO expiration values and verifier ids that require a programmatic registry', async () => {
    const stdout = spyOn(console, 'log').mockImplementation(() => undefined);
    const stderr = spyOn(console, 'error').mockImplementation(() => undefined);
    expect(await handleKeysCommand(['create'], {
      sqlite: ':memory:',
      'expires-at': 'January 1, 2027',
    })).toBe(1);
    expect(await handleKeysCommand(['create'], {
      sqlite: ':memory:',
      'expires-at': '2027-02-30T00:00:00Z',
    })).toBe(1);
    expect(await handleKeysCommand(['create'], {
      sqlite: ':memory:',
      verifier: API_KEY_VERIFIER_IDS.hmac,
    })).toBe(1);
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr.mock.calls.flat().join(' ')).toContain('programmatic registry');
    stdout.mockRestore();
    stderr.mockRestore();
  });
});
