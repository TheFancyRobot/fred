import { describe, expect, test } from 'bun:test';
import { SessionService, makeSessionId } from '@fancyrobot/fred/effect';
import { Effect, Layer, Option, Stream } from 'effect';
import {
  resolveSessionId,
  useSession,
  useSessionStream,
} from '../../../packages/fred-http/src/handlers/session';

describe('HTTP session binding', () => {
  test('uses the session header or requests a generated id', () => {
    expect(resolveSessionId('header')).toBe('header');
    expect(resolveSessionId(undefined)).toBeUndefined();
  });

  test('binds the resolved id ambiently and returns it for response headers', async () => {
    const service: SessionService = {
      open: (id) => Effect.succeed({ id: makeSessionId(id ?? 'generated') }),
      current: Effect.succeed(Option.none()),
      withSession: (_session, effect) => effect,
      use: (id, effect) => Effect.map(effect, (result) => ({
        session: { id: makeSessionId(id ?? 'generated') },
        result,
      })),
    };

    const result = await Effect.runPromise(
      useSession(undefined, Effect.succeed('ok')).pipe(
        Effect.provide(Layer.succeed(SessionService, service)),
      ),
    );

    expect(result).toEqual({ sessionId: 'generated', result: 'ok' });
  });

  test('keeps the ambient binding active while a stream is pulled', async () => {
    let bindings = 0;
    const service: SessionService = {
      open: (id) => Effect.succeed({ id: makeSessionId(id ?? 'generated') }),
      current: Effect.succeed(Option.none()),
      withSession: (_session, effect) => Effect.suspend(() => {
        bindings += 1;
        return effect;
      }),
      use: (id, effect) => Effect.map(effect, (result) => ({
        session: { id: makeSessionId(id ?? 'generated') },
        result,
      })),
    };

    const values = await Effect.runPromise(
      Effect.gen(function* () {
        const used = yield* useSessionStream('stream-session', Stream.make('a', 'b'));
        return yield* used.stream.pipe(Stream.runCollect);
      }).pipe(Effect.provide(Layer.succeed(SessionService, service))),
    );

    expect(Array.from(values)).toEqual(['a', 'b']);
    expect(bindings).toBeGreaterThanOrEqual(2);
  });
});
