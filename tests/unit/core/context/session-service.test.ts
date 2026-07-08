/**
 * Phase 62 / STEP-62-01: SessionService ambient context.
 *
 * The critical property is fiber isolation: concurrent workflows on different
 * fibers must not leak sessions into each other, while child fibers of one
 * workflow inherit its session.
 */
import { describe, expect, it } from 'bun:test';
import { Effect, Fiber, Layer, Option } from 'effect';
import {
  SessionService,
  SessionServiceLive,
  makeSessionId,
} from '../../../../packages/core/src/context/session-service';
import { ContextStorageServiceLive } from '../../../../packages/core/src/context/service';

const runSession = <A, E>(effect: Effect.Effect<A, E, SessionService>): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.provide(effect, SessionServiceLive)));

const runWithStorage = <A, E>(effect: Effect.Effect<A, E, any>): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.provide(effect, Layer.merge(SessionServiceLive, ContextStorageServiceLive))),
  );

const currentId = (svc: SessionService) =>
  Effect.map(svc.current, Option.map((h) => h.id as string));

describe('SessionService.current / withSession', () => {
  it('has no ambient session by default', async () => {
    const result = await runSession(Effect.flatMap(SessionService, (svc) => svc.current));
    expect(Option.isNone(result)).toBe(true);
  });

  it('exposes the ambient session inside withSession and clears it after', async () => {
    const { inside, after } = await runSession(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        const inside = yield* svc.withSession('conv_a', currentId(svc));
        const after = yield* currentId(svc);
        return { inside, after };
      }),
    );
    expect(inside).toEqual(Option.some('conv_a'));
    expect(Option.isNone(after)).toBe(true);
  });

  it('child fibers inherit the ambient session', async () => {
    const result = await runSession(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.withSession(
          'conv_child',
          Effect.gen(function* () {
            const fiber = yield* Effect.fork(currentId(svc));
            return yield* Fiber.join(fiber);
          }),
        );
      }),
    );
    expect(result).toEqual(Option.some('conv_child'));
  });

  it('nested withSession overrides then restores the outer session', async () => {
    const seen = await runSession(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* svc.withSession(
          'outer',
          Effect.gen(function* () {
            const inner = yield* svc.withSession('inner', currentId(svc));
            const backToOuter = yield* currentId(svc);
            return { inner, backToOuter };
          }),
        );
      }),
    );
    expect(seen.inner).toEqual(Option.some('inner'));
    expect(seen.backToOuter).toEqual(Option.some('outer'));
  });

  it('CRITICAL: concurrent fibers do not leak sessions across each other', async () => {
    const readAfterDelay = (svc: SessionService, id: string) =>
      svc.withSession(
        id,
        Effect.gen(function* () {
          // Yield so the two fibers interleave; a leak would surface here.
          yield* Effect.sleep('15 millis');
          return yield* currentId(svc);
        }),
      );

    const [a, b, c] = await runSession(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        return yield* Effect.all(
          [readAfterDelay(svc, 'conv_a'), readAfterDelay(svc, 'conv_b'), readAfterDelay(svc, 'conv_c')],
          { concurrency: 'unbounded' },
        );
      }),
    );

    expect(a).toEqual(Option.some('conv_a'));
    expect(b).toEqual(Option.some('conv_b'));
    expect(c).toEqual(Option.some('conv_c'));
  });
});

describe('SessionService.open', () => {
  it('resumes the exact id when one is provided', async () => {
    const handle = await runWithStorage(Effect.flatMap(SessionService, (svc) => svc.open('conv_resume')));
    expect(handle.id).toBe(makeSessionId('conv_resume'));
  });

  it('mints a fresh id via storage when none is provided', async () => {
    const handle = await runWithStorage(Effect.flatMap(SessionService, (svc) => svc.open()));
    expect(typeof handle.id).toBe('string');
    expect((handle.id as string).length).toBeGreaterThan(0);
  });

  it('opened handles can be made ambient via withSession', async () => {
    const seen = await runWithStorage(
      Effect.gen(function* () {
        const svc = yield* SessionService;
        const handle = yield* svc.open('conv_open_then_use');
        return yield* svc.withSession(handle, currentId(svc));
      }),
    );
    expect(seen).toEqual(Option.some('conv_open_then_use'));
  });
});
