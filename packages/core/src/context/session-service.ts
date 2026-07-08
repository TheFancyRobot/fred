/**
 * Ambient session context (Phase 62, STEP-62-01).
 *
 * `SessionService` carries the "current session" through the Effect
 * environment so every agent and function inside a workflow reads and writes
 * the same conversation history without threading a `conversationId` /
 * `previousMessages[]` by hand.
 *
 * The current session lives in a `FiberRef<Option<SessionHandle>>`. Setting it
 * with `withSession` uses `Effect.locally`, so the value is scoped to that
 * effect and **inherited by child fibers** — the steps of a workflow, whether
 * run sequentially or forked concurrently, all observe the same session, while
 * sibling workflows on other fibers stay isolated (no cross-fiber leak).
 *
 * This step is additive: the service is standalone and not yet wired into the
 * runtime or agent execution (STEP-62-02 / STEP-62-03).
 */
import { Context, Effect, FiberRef, Layer, Option, Schema } from 'effect';
import { ContextStorageService } from './service';

/**
 * A conversation-session identifier. Branded so it can't be confused with an
 * arbitrary string; maps 1:1 onto the storage layer's `conv_${UUID}` ids.
 */
export const SessionId = Schema.String.pipe(Schema.brand('@fred/SessionId'));
export type SessionId = Schema.Schema.Type<typeof SessionId>;

/** Coerce a raw id into a branded `SessionId`. */
export const makeSessionId = (id: string): SessionId => SessionId.make(id);

/** A handle to an open session. Minimal for now; may carry metadata later. */
export interface SessionHandle {
  readonly id: SessionId;
}

export interface SessionService {
  /**
   * Open a session: resume the given id, or (when omitted) mint a fresh one via
   * the storage layer's id generator. Returns a handle to pass to
   * `withSession`. Opening does not by itself make the session ambient.
   */
  readonly open: (id?: string) => Effect.Effect<SessionHandle, never, ContextStorageService>;

  /** The ambient session on the current fiber, if any. */
  readonly current: Effect.Effect<Option.Option<SessionHandle>>;

  /**
   * Run `effect` with `session` as the ambient session. The binding is scoped
   * to `effect` and inherited by its child fibers; callers outside are
   * unaffected.
   */
  readonly withSession: <A, E, R>(
    session: SessionHandle | string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
}

export const SessionService = Context.GenericTag<SessionService>('@fred/SessionService');

const toHandle = (session: SessionHandle | string): SessionHandle =>
  typeof session === 'string' ? { id: makeSessionId(session) } : session;

/**
 * Live implementation. Scoped because the ambient `FiberRef` is created once
 * per runtime and shared by every fiber that runs against it.
 */
export const SessionServiceLive = Layer.scoped(
  SessionService,
  Effect.gen(function* () {
    const currentRef = yield* FiberRef.make<Option.Option<SessionHandle>>(Option.none());

    const open: SessionService['open'] = (id) =>
      id !== undefined
        ? Effect.succeed<SessionHandle>({ id: makeSessionId(id) })
        : Effect.map(
            Effect.flatMap(ContextStorageService, (storage) => storage.generateConversationId()),
            (generated) => ({ id: makeSessionId(generated) }),
          );

    const withSession: SessionService['withSession'] = (session, effect) =>
      Effect.locally(effect, currentRef, Option.some(toHandle(session)));

    return {
      open,
      current: FiberRef.get(currentRef),
      withSession,
    } satisfies SessionService;
  }),
);
