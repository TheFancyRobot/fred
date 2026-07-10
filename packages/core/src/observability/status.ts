/**
 * Live agent-run status backed by Effect supervision.
 *
 * Supervisor callbacks are synchronous, so lifecycle state crosses that
 * boundary through a private MutableRef and PubSub. The public contract stays
 * Effect-native: callers read an Effect snapshot and subscribe to a Stream of
 * lifecycle changes.
 */

import {
  Context,
  Effect,
  Exit,
  Fiber,
  FiberId,
  FiberRef,
  HashMap,
  Layer,
  MutableRef,
  Option,
  PubSub,
  Stream,
  Supervisor,
} from 'effect';

export type AgentRunState =
  | 'starting'
  | 'calling_model'
  | 'streaming'
  | 'running_tool'
  | 'paused';

export interface AgentRunInfo {
  readonly fiberId: string;
  readonly agentId: string;
  readonly workflowId?: string;
  readonly sessionId?: string;
  readonly state: AgentRunState;
  readonly startedAt: number;
}

/**
 * Metadata inherited by the one child fiber that owns an agent run.
 * `runId` distinguishes a run root from its incidental descendant fibers.
 */
export interface AgentRunAnnotation {
  readonly runId: string;
  readonly agentId: string;
  readonly workflowId?: string;
  readonly sessionId?: string;
  readonly state?: AgentRunState;
  readonly startedAt?: number;
}

export type AgentStatusSnapshot = ReadonlyArray<AgentRunInfo>;

export interface AgentStatusService {
  readonly snapshot: Effect.Effect<AgentStatusSnapshot>;
  readonly changes: Stream.Stream<AgentStatusSnapshot>;
  readonly transition: (state: AgentRunState) => Effect.Effect<void>;
}

export const AgentStatusService = Context.GenericTag<AgentStatusService>(
  'AgentStatusService'
);

/**
 * Fork depth stays outside the public annotation value. The first fork is the
 * run root; later descendants carry the same runId and are ignored.
 */
const annotationDepths = new WeakMap<AgentRunAnnotation, number>();

const forkAnnotation = (
  annotation: Option.Option<AgentRunAnnotation>
): Option.Option<AgentRunAnnotation> =>
  Option.map(annotation, (current) => {
    const forked = { ...current };
    annotationDepths.set(forked, (annotationDepths.get(current) ?? 0) + 1);
    return forked;
  });

export const AgentRunAnnotationRef = FiberRef.unsafeMake<
  Option.Option<AgentRunAnnotation>
>(Option.none(), {
  fork: forkAnnotation,
  join: (parent) => parent,
});

interface TrackedAgentRun {
  readonly runId: string;
  readonly info: AgentRunInfo;
}

type TrackedRuns = HashMap.HashMap<string, TrackedAgentRun>;

const toFiberId = (fiber: Fiber.RuntimeFiber<unknown, unknown>): string =>
  FiberId.threadName(fiber.id());

const toSnapshot = (runs: TrackedRuns): AgentStatusSnapshot =>
  Array.from(HashMap.values(runs), ({ info }) => info).sort(
    (left, right) =>
      left.startedAt - right.startedAt || left.fiberId.localeCompare(right.fiberId)
  );

const activeAnnotation = (
  annotation: Option.Option<AgentRunAnnotation>
): Option.Option<AgentRunAnnotation> =>
  Option.filter(annotation, (value) => (annotationDepths.get(value) ?? 0) > 0);

class AgentRunSupervisor extends Supervisor.AbstractSupervisor<AgentStatusSnapshot> {
  constructor(
    private readonly runs: MutableRef.MutableRef<TrackedRuns>,
    private readonly publish: (snapshot: AgentStatusSnapshot) => void
  ) {
    super();
  }

  get value(): Effect.Effect<AgentStatusSnapshot> {
    return Effect.sync(() => toSnapshot(MutableRef.get(this.runs)));
  }

  onStart<A, E, R>(
    _context: Context.Context<R>,
    _effect: Effect.Effect<A, E, R>,
    parent: Option.Option<Fiber.RuntimeFiber<unknown, unknown>>,
    fiber: Fiber.RuntimeFiber<A, E>
  ): void {
    const annotation = activeAnnotation(fiber.getFiberRef(AgentRunAnnotationRef));
    if (Option.isNone(annotation)) return;

    const parentAnnotation = Option.flatMap(parent, (parentFiber) =>
      activeAnnotation(parentFiber.getFiberRef(AgentRunAnnotationRef))
    );
    if (
      Option.isSome(parentAnnotation) &&
      parentAnnotation.value.runId === annotation.value.runId
    ) {
      return;
    }

    const fiberId = toFiberId(fiber);
    const info: AgentRunInfo = {
      fiberId,
      agentId: annotation.value.agentId,
      workflowId: annotation.value.workflowId,
      sessionId: annotation.value.sessionId,
      state: annotation.value.state ?? 'starting',
      startedAt: annotation.value.startedAt ?? fiber.id().startTimeMillis,
    };
    const next = HashMap.set(MutableRef.get(this.runs), fiberId, {
      runId: annotation.value.runId,
      info,
    });
    MutableRef.set(this.runs, next);
    this.publish(toSnapshot(next));
  }

  onEnd<A, E>(
    _exit: Exit.Exit<A, E>,
    fiber: Fiber.RuntimeFiber<A, E>
  ): void {
    const fiberId = toFiberId(fiber);
    const current = MutableRef.get(this.runs);
    if (!HashMap.has(current, fiberId)) return;

    const next = HashMap.remove(current, fiberId);
    MutableRef.set(this.runs, next);
    this.publish(toSnapshot(next));
  }
}

/** Execute an effect in one annotated child fiber. */
export const trackAgentRun =
  (annotation: AgentRunAnnotation) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
    const seed = { ...annotation };
    annotationDepths.set(seed, 0);
    return Effect.locally(
      Effect.flatMap(Effect.fork(effect), Fiber.join),
      AgentRunAnnotationRef,
      Option.some(seed)
    );
  };

const makeAgentStatusLayer = Effect.gen(function* () {
  const changes = yield* Effect.acquireRelease(
    PubSub.unbounded<AgentStatusSnapshot>(),
    PubSub.shutdown
  );
  const runs = MutableRef.make<TrackedRuns>(HashMap.empty());

  const publish = (snapshot: AgentStatusSnapshot): void => {
    changes.unsafeOffer(snapshot);
  };
  const supervisor = new AgentRunSupervisor(runs, publish);
  const snapshot = Effect.sync(() => toSnapshot(MutableRef.get(runs)));

  const transition = Effect.fn('AgentStatusService.transition')(
    function* (state: AgentRunState) {
      const annotation = yield* FiberRef.get(AgentRunAnnotationRef);
      if (Option.isNone(annotation)) return;

      const current = MutableRef.get(runs);
      let next = current;
      for (const [fiberId, tracked] of current) {
        if (tracked.runId === annotation.value.runId && tracked.info.state !== state) {
          next = HashMap.set(next, fiberId, {
            ...tracked,
            info: { ...tracked.info, state },
          });
        }
      }

      if (next !== current) {
        MutableRef.set(runs, next);
        publish(toSnapshot(next));
      }
    }
  );

  const service: AgentStatusService = {
    snapshot,
    changes: Stream.fromPubSub(changes),
    transition,
  };

  return Layer.merge(
    Layer.succeed(AgentStatusService, service),
    Supervisor.addSupervisor(supervisor)
  );
});

/** One independent lifecycle tracker per scoped runtime. */
export const AgentStatusServiceLive: Layer.Layer<AgentStatusService> =
  Layer.unwrapScoped(makeAgentStatusLayer);
