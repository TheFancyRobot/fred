import { HttpServerResponse } from '@effect/platform';
import { SessionService } from '@fancyrobot/fred/effect';
import { Effect, Stream } from 'effect';

export const SESSION_ID_HEADER = 'x-session-id';

export const resolveSessionId = (
  headerSessionId: string | undefined,
): string | undefined => headerSessionId;

export const useSession = Effect.fn('FredHttp.useSession')(
  function* <A, E, R>(sessionId: string | undefined, effect: Effect.Effect<A, E, R>) {
    const sessions = yield* SessionService;
    const used = yield* sessions.use(sessionId, effect);
    return { sessionId: used.session.id as string, result: used.result } as const;
  },
);

export const useSessionStream = Effect.fn('FredHttp.useSessionStream')(
  function* <A, E, R>(sessionId: string | undefined, stream: Stream.Stream<A, E, R>) {
    const sessions = yield* SessionService;
    const session = yield* sessions.open(sessionId);
    const bound = Stream.fromPull(
      sessions.withSession(session, Stream.toPull(stream)).pipe(
        Effect.map((pull) => sessions.withSession(session, pull)),
      ),
    );
    return { sessionId: session.id as string, stream: bound } as const;
  },
);

export const withSessionHeader = (
  response: HttpServerResponse.HttpServerResponse,
  sessionId: string,
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.setHeader(response, SESSION_ID_HEADER, sessionId);
