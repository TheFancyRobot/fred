/**
 * Phase 62 / STEP-62-04: workflow-level ambient sessions.
 *
 * Proves the phase's acceptance criteria at the "workflow" (multi-agent) level:
 *   - two agents in one workflow share history with no manual id passing;
 *   - a session is auto-created on first input and resumable by id anytime
 *     (`SessionService.use`);
 *   - parallel workflows do NOT leak sessions across fibers.
 *
 * Each "agent" is modeled as an effect that reads the ambient session
 * (`SessionService.current`) and appends its turn to `ContextStorageService`
 * under that id — the exact pattern real agent execution follows — so shared
 * history is observable through storage without threading a conversationId.
 */
import { describe, expect, it } from 'bun:test';
import { Effect, Layer, Option } from 'effect';
import {
  ContextStorageService,
  ContextStorageServiceLive,
} from '../../../../packages/core/src/context/service';
import {
  SessionService,
  SessionServiceLive,
  resolveAmbientConversationId,
} from '../../../../packages/core/src/context/session-service';

const testLayer = Layer.provideMerge(SessionServiceLive, ContextStorageServiceLive);

const run = <A, E>(effect: Effect.Effect<A, E, SessionService | ContextStorageService>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect.pipe(Effect.provide(testLayer))) as Effect.Effect<A, E>);

/** An "agent" turn: read the ambient session, append its exchange to storage. */
const agentTurn = (user: string, assistant: string) =>
  Effect.gen(function* () {
    const session = yield* SessionService;
    const storage = yield* ContextStorageService;
    const current = yield* session.current;
    const id = Option.getOrThrow(current).id as string;
    yield* storage.addMessages(id, [
      { role: 'user', content: user },
      { role: 'assistant', content: assistant },
    ]);
    return id;
  });

describe('workflow-level ambient sessions', () => {
  it('shares one session across two agents with no manual passing', async () => {
    const result = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const storage = yield* ContextStorageService;
        const handle = yield* session.open();

        // Two agents run inside the same ambient session; neither is handed an id.
        const [firstId, secondId] = yield* session.withSession(
          handle,
          Effect.gen(function* () {
            const a = yield* agentTurn('q1', 'a1');
            const b = yield* agentTurn('q2', 'a2');
            return [a, b] as const;
          })
        );

        const history = yield* storage.getHistory(handle.id as string);
        return { firstId, secondId, handleId: handle.id as string, historyLength: history.length };
      })
    );

    // Both agents saw the same ambient id...
    expect(result.firstId).toBe(result.handleId);
    expect(result.secondId).toBe(result.handleId);
    // ...and both turns accumulated in the one shared history.
    expect(result.historyLength).toBe(4);
  });

  it('auto-creates a session on first input and resumes it by id (use)', async () => {
    const result = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const storage = yield* ContextStorageService;

        // First input: no id supplied -> session auto-created, handle returned.
        const first = yield* session.use(undefined, agentTurn('hello', 'hi'));
        const resumeId = first.session.id as string;

        // Later: resume by the returned id and add another turn.
        yield* session.use(resumeId, agentTurn('again', 'welcome back'));

        const history = yield* storage.getHistory(resumeId);
        return { resumeId, seenId: first.result, historyLength: history.length };
      })
    );

    expect(result.seenId).toBe(result.resumeId);
    // First turn (2) + resumed turn (2) accumulated under the same id.
    expect(result.historyLength).toBe(4);
  });

  it('does not leak sessions across parallel workflows on different fibers', async () => {
    const result = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        const storage = yield* ContextStorageService;

        // Two workflows run concurrently, each in its own ambient session.
        const [idA, idB] = yield* Effect.all(
          [
            session.withSession('conv_A', agentTurn('a', 'A')),
            session.withSession('conv_B', agentTurn('b', 'B')),
          ],
          { concurrency: 'unbounded' }
        );

        const histA = yield* storage.getHistory('conv_A');
        const histB = yield* storage.getHistory('conv_B');
        return { idA, idB, histA: histA.length, histB: histB.length };
      })
    );

    // Each fiber observed only its own session; no cross-leak.
    expect(result.idA).toBe('conv_A');
    expect(result.idB).toBe('conv_B');
    expect(result.histA).toBe(2);
    expect(result.histB).toBe(2);
  });
});

describe('resolveAmbientConversationId', () => {
  it('returns undefined when no SessionService is in context', async () => {
    // No requirement is added by the resolver, so it runs without a session.
    const id = await Effect.runPromise(resolveAmbientConversationId());
    expect(id).toBeUndefined();
  });

  it('returns the explicit id verbatim, without consulting the session', async () => {
    const id = await Effect.runPromise(resolveAmbientConversationId('conv_explicit'));
    expect(id).toBe('conv_explicit');
  });

  it('falls back to the ambient session id when no explicit id is given', async () => {
    const id = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.withSession('conv_ambient', resolveAmbientConversationId());
      })
    );
    expect(id).toBe('conv_ambient');
  });

  it('prefers the explicit id over the ambient session', async () => {
    const id = await run(
      Effect.gen(function* () {
        const session = yield* SessionService;
        return yield* session.withSession(
          'conv_ambient',
          resolveAmbientConversationId('conv_explicit')
        );
      })
    );
    expect(id).toBe('conv_explicit');
  });
});
