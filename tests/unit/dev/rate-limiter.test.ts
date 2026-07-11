import { Database } from 'bun:sqlite';
import { describe, expect, it } from 'bun:test';
import { rmSync } from 'node:fs';
import { Duration, Effect, Exit, TestClock, TestContext } from 'effect';
import {
  RATE_LIMIT_TABLE,
  RateLimitStoreError,
  RateLimitStore,
  RateLimitStoreSqlite,
  makeMemoryRateLimitStore,
  makePostgresRateLimitStore,
  makeRateLimitService,
  makeSqliteRateLimitStore,
  type PostgresRateLimitPool,
  type RateLimitStoreService,
} from '../../../packages/fred-http/src/rate-limiter';

const policy = { maxRequests: 2, windowMs: 1_000 };
const consume = (
  store: RateLimitStoreService,
  key: string,
  now: number,
  override = policy,
) => Effect.runPromise(store.consume({ key, now, policy: override }));

class AtomicPostgresPool implements PostgresRateLimitPool {
  readonly buckets = new Map<string, { count: number; expiresAt: number }>();
  queries: string[] = [];

  async query(text: string, values: unknown[] = []) {
    this.queries.push(text);
    if (text.includes(`INSERT INTO ${RATE_LIMIT_TABLE}`)) {
      const [key, now, resetAt, maxRequests] = values as [string, number, number, number, string];
      const current = this.buckets.get(key);
      if (current === undefined || current.expiresAt <= now) {
        this.buckets.set(key, { count: 1, expiresAt: resetAt });
        return { rows: [{ request_count: 1, expires_at: resetAt, consumed: true }], rowCount: 1 };
      }
      if (current.count >= maxRequests) {
        return {
          rows: [{ request_count: current.count, expires_at: current.expiresAt, consumed: false }],
          rowCount: 1,
        };
      }
      const next = { ...current, count: current.count + 1 };
      this.buckets.set(key, next);
      return {
        rows: [{ request_count: next.count, expires_at: next.expiresAt, consumed: true }],
        rowCount: 1,
      };
    }
    if (text.startsWith('DELETE')) {
      const now = Number(values[0]);
      let deleted = 0;
      for (const [key, bucket] of this.buckets) {
        if (bucket.expiresAt <= now) {
          this.buckets.delete(key);
          deleted += 1;
        }
      }
      return { rows: [], rowCount: deleted };
    }
    return { rows: [], rowCount: 0 };
  }
}

const contractCases = (): Array<{
  name: string;
  make: () => { store: RateLimitStoreService; cleanup: () => void };
}> => [
  {
    name: 'memory',
    make: () => ({ store: makeMemoryRateLimitStore(), cleanup: () => undefined }),
  },
  {
    name: 'SQLite',
    make: () => {
      const database = new Database(':memory:');
      return { store: makeSqliteRateLimitStore(':memory:', database), cleanup: () => database.close() };
    },
  },
  {
    name: 'Postgres',
    make: () => ({ store: makePostgresRateLimitStore(new AtomicPostgresPool()), cleanup: () => undefined }),
  },
];

for (const contract of contractCases()) {
  describe(`${contract.name} rate-limit store contract`, () => {
    it('enforces boundaries, rollover, positive retry metadata, and independent buckets', async () => {
      const { store, cleanup } = contract.make();
      try {
        await Effect.runPromise(store.initialize);
        expect(await consume(store, 'first', 0)).toEqual({
          allowed: true,
          retryAfterMs: 0,
          remaining: 1,
          resetAt: 1_000,
        });
        expect((await consume(store, 'first', 100)).allowed).toBe(true);
        const rejected = await consume(store, 'first', 200);
        expect(rejected.allowed).toBe(false);
        expect(rejected.retryAfterMs).toBe(800);
        expect((await consume(store, 'second', 200)).allowed).toBe(true);
        expect((await consume(store, 'first', 1_000)).allowed).toBe(true);
      } finally {
        cleanup();
      }
    });

    it('atomically prevents concurrent requests from exceeding the policy', async () => {
      const { store, cleanup } = contract.make();
      try {
        await Effect.runPromise(store.initialize);
        const decisions = await Promise.all(Array.from({ length: 50 }, () =>
          consume(store, 'concurrent', 10, { maxRequests: 7, windowMs: 1_000 })));
        expect(decisions.filter((decision) => decision.allowed)).toHaveLength(7);
        expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(43);
      } finally {
        cleanup();
      }
    });
  });
}

describe('rate-limit storage safety', () => {
  it('uses the injected Effect Clock for deterministic rollover', async () => {
    const program = Effect.gen(function* () {
      const service = yield* makeRateLimitService(makeMemoryRateLimitStore());
      const first = yield* service.consume({ key: 'clock', policy: { maxRequests: 1, windowMs: 1_000 } });
      const limited = yield* service.consume({ key: 'clock', policy: { maxRequests: 1, windowMs: 1_000 } });
      yield* TestClock.adjust(Duration.millis(1_000));
      const rolled = yield* service.consume({ key: 'clock', policy: { maxRequests: 1, windowMs: 1_000 } });
      return { first, limited, rolled };
    }).pipe(Effect.provide(TestContext.TestContext));

    const result = await Effect.runPromise(program);
    expect(result.first.allowed).toBe(true);
    expect(result.limited.allowed).toBe(false);
    expect(result.rolled.allowed).toBe(true);
  });

  it('rejects invalid policies as typed store failures', async () => {
    const store = makeMemoryRateLimitStore();
    const exit = await Effect.runPromise(Effect.exit(store.consume({
      key: 'invalid',
      now: 0,
      policy: { maxRequests: 0, windowMs: 1_000 },
    })));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(exit.cause)).toContain('RateLimitStoreError');
    }
  });

  it('fails closed when bounded memory capacity contains only active buckets', async () => {
    const store = makeMemoryRateLimitStore({ maxBuckets: 1, pruneEvery: 1 });
    expect((await consume(store, 'one', 0)).allowed).toBe(true);
    const exit = await Effect.runPromise(Effect.exit(store.consume({ key: 'two', now: 0, policy })));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it('prunes expired memory and SQLite buckets without scanning request history', async () => {
    const memory = makeMemoryRateLimitStore();
    await consume(memory, 'expired', 0);
    expect(await Effect.runPromise(memory.prune(1_000))).toBe(1);

    const database = new Database(':memory:');
    const sqlite = makeSqliteRateLimitStore(':memory:', database);
    await Effect.runPromise(sqlite.initialize);
    await consume(sqlite, 'expired', 0);
    expect(await Effect.runPromise(sqlite.prune(1_000))).toBe(1);
    const indexes = database.query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = '${RATE_LIMIT_TABLE}'`,
    ).all();
    expect(indexes.some(({ name }) => name.includes('expires_at'))).toBe(true);
    database.close();
  });

  it('does not close an injected SQLite database', async () => {
    const database = new Database(':memory:');
    const store = makeSqliteRateLimitStore(':memory:', database);
    await Effect.runPromise(store.initialize);
    await Effect.runPromise(store.close);
    expect(database.query('SELECT 1 AS value').get()).toEqual({ value: 1 });
    database.close();
  });

  it('closes an owned SQLite database when its Layer scope closes', async () => {
    const path = `/tmp/fred-rate-limit-${crypto.randomUUID()}.sqlite`;
    let captured: RateLimitStoreService | undefined;
    try {
      await Effect.runPromise(Effect.scoped(
        Effect.gen(function* () {
          captured = yield* RateLimitStore;
          yield* captured.initialize;
          yield* captured.consume({ key: 'owned', now: 0, policy });
        }).pipe(Effect.provide(RateLimitStoreSqlite(path))),
      ));
      if (captured === undefined) throw new Error('Rate limit store was not captured');
      const exit = await Effect.runPromise(Effect.exit(
        captured.consume({ key: 'closed', now: 0, policy }),
      ));
      expect(Exit.isFailure(exit)).toBe(true);
    } finally {
      rmSync(path, { force: true });
    }
  });

  it('uses an atomic indexed Postgres upsert contract', async () => {
    const pool = new AtomicPostgresPool();
    const store = makePostgresRateLimitStore(pool);
    await Effect.runPromise(store.initialize);
    await consume(store, 'key', 0);
    const consumeSql = pool.queries.find((sql) => sql.includes(`INSERT INTO ${RATE_LIMIT_TABLE}`)) ?? '';
    const ddl = pool.queries[0] ?? '';
    expect(consumeSql).toContain('ON CONFLICT(bucket_key) DO UPDATE');
    expect(ddl).toContain('expires_at');
    expect(ddl).toContain('CREATE INDEX');
  });

  it('surfaces backend outages as RateLimitStoreError', async () => {
    const store = makePostgresRateLimitStore({
      query: async () => { throw new Error('database unavailable'); },
    });
    const exit = await Effect.runPromise(Effect.exit(store.initialize));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain(RateLimitStoreError.name);
  });
});
