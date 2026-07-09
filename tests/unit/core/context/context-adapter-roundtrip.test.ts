/**
 * Phase 62 / STEP-62-04: Promise-adapter round-trip.
 *
 * The canonical storage is the Effect-typed `ContextStorageService`. The
 * SQLite/Postgres backends implement the Promise `ContextStorage` interface and
 * are plugged in via `replaceStorage`, which wraps them in the internal
 * `ExternalStorageAdapter`. These tests exercise that adapter boundary with an
 * in-memory `ContextStorage` stand-in (same interface the real backends
 * implement) to prove writes and reads round-trip through the Promise layer.
 */
import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  ContextStorageService,
  ContextStorageServiceLive,
} from '../../../../packages/core/src/context/service';
import type {
  ContextStorage,
  ConversationContext,
  SessionSummary,
} from '../../../../packages/core/src/context/context';

/** A Promise-based ContextStorage, exactly the shape SQLite/Postgres implement. */
const makePromiseStorage = () => {
  const store = new Map<string, ConversationContext>();
  const adapter: ContextStorage = {
    get: async (id) => store.get(id) ?? null,
    set: async (id, context) => {
      store.set(id, context);
    },
    delete: async (id) => {
      store.delete(id);
    },
    clear: async () => {
      store.clear();
    },
    listSessions: async (): Promise<SessionSummary[]> =>
      Array.from(store.values()).map((context) => ({
        id: context.id,
        createdAt: context.metadata.createdAt,
        updatedAt: context.metadata.updatedAt,
        messageCount: context.messages.length,
      })),
  };
  return { adapter, store };
};

const run = <A>(effect: Effect.Effect<A, unknown, ContextStorageService>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(ContextStorageServiceLive)) as Effect.Effect<A>);

describe('ContextStorageService Promise-adapter round-trip', () => {
  it('persists and reads back messages through the Promise adapter', async () => {
    const { adapter, store } = makePromiseStorage();

    const history = await run(
      Effect.gen(function* () {
        const storage = yield* ContextStorageService;
        yield* storage.replaceStorage(adapter);
        yield* storage.addMessages('conv_rt', [
          { role: 'user', content: 'hello' },
          { role: 'assistant', content: 'hi there' },
        ]);
        return yield* storage.getHistory('conv_rt');
      })
    );

    // Round-tripped through the Promise adapter, not the in-memory default.
    expect(history).toHaveLength(2);
    expect(store.has('conv_rt')).toBe(true);
    expect(store.get('conv_rt')?.messages).toHaveLength(2);
  });

  it('lists sessions from the Promise adapter', async () => {
    const { adapter } = makePromiseStorage();

    const sessions = await run(
      Effect.gen(function* () {
        const storage = yield* ContextStorageService;
        yield* storage.replaceStorage(adapter);
        yield* storage.addMessage('conv_a', { role: 'user', content: 'a' });
        yield* storage.addMessage('conv_b', { role: 'user', content: 'b' });
        return yield* storage.listSessions();
      })
    );

    expect(sessions.map((s) => s.id).sort()).toEqual(['conv_a', 'conv_b']);
  });

  it('clears a conversation through the Promise adapter', async () => {
    const { adapter, store } = makePromiseStorage();

    await run(
      Effect.gen(function* () {
        const storage = yield* ContextStorageService;
        yield* storage.replaceStorage(adapter);
        yield* storage.addMessage('conv_del', { role: 'user', content: 'x' });
        yield* storage.clearContext('conv_del');
      })
    );

    expect(store.has('conv_del')).toBe(false);
  });
});
