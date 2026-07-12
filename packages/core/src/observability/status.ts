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
  Deferred,
  Effect,
  Exit,
  Fiber,
  FiberId,
  FiberRef,
  HashMap,
  Layer,
  Metric,
  MetricBoundaries,
  MetricLabel,
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

export type AgentStatusListener = (snapshot: AgentStatusSnapshot) => void;

export type AgentStatusUnsubscribe = () => Promise<void>;

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
  readonly metricStartedAt: number;
}

type TrackedRuns = HashMap.HashMap<string, TrackedAgentRun>;

interface AgentStatusState {
  readonly version: number;
  readonly runs: TrackedRuns;
}

interface AgentStatusChange {
  readonly version: number;
  readonly snapshot: AgentStatusSnapshot;
}

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

const agentsRunning = Metric.gauge('fred_agents_running', {
  description: 'Number of agent invocations currently running',
});
const agentRunsStarted = Metric.counter('fred_agent_runs_started_total', {
  description: 'Total agent invocations started',
});
const agentRunsCompleted = Metric.counter('fred_agent_runs_completed_total', {
  description: 'Total agent invocations completed',
});
const agentRunDuration = Metric.histogram(
  'fred_agent_run_duration_ms',
  MetricBoundaries.exponential({ start: 1, factor: 2, count: 20 }),
  'Agent invocation duration in milliseconds'
);

const agentMetricLabels = (agentId: string) => [
  MetricLabel.make('agentId', agentId),
];

class AgentRunSupervisor extends Supervisor.AbstractSupervisor<AgentStatusSnapshot> {
  constructor(
    private readonly status: MutableRef.MutableRef<AgentStatusState>,
    private readonly publish: (runs: TrackedRuns) => void
  ) {
    super();
  }

  get value(): Effect.Effect<AgentStatusSnapshot> {
    return Effect.sync(() => toSnapshot(MutableRef.get(this.status).runs));
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
    const current = MutableRef.get(this.status).runs;
    if (HashMap.has(current, fiberId)) return;

    const info: AgentRunInfo = {
      fiberId,
      agentId: annotation.value.agentId,
      workflowId: annotation.value.workflowId,
      sessionId: annotation.value.sessionId,
      state: annotation.value.state ?? 'starting',
      startedAt: annotation.value.startedAt ?? fiber.id().startTimeMillis,
    };
    const next = HashMap.set(current, fiberId, {
      runId: annotation.value.runId,
      info,
      metricStartedAt: Date.now(),
    });
    this.publish(next);
    agentsRunning.unsafeModify(1, []);
    agentRunsStarted.unsafeUpdate(1, agentMetricLabels(info.agentId));
  }

  onEnd<A, E>(
    exit: Exit.Exit<A, E>,
    fiber: Fiber.RuntimeFiber<A, E>
  ): void {
    const fiberId = toFiberId(fiber);
    const current = MutableRef.get(this.status).runs;
    const tracked = HashMap.get(current, fiberId);
    if (Option.isNone(tracked)) return;

    const next = HashMap.remove(current, fiberId);
    this.publish(next);
    const labels = [
      ...agentMetricLabels(tracked.value.info.agentId),
      MetricLabel.make(
        'exit',
        Exit.isSuccess(exit) ? 'success' : Exit.isInterrupted(exit) ? 'interrupted' : 'failure'
      ),
    ];
    agentsRunning.unsafeModify(-1, []);
    agentRunsCompleted.unsafeUpdate(1, labels);
    agentRunDuration.unsafeUpdate(
      Math.max(0, Date.now() - tracked.value.metricStartedAt),
      labels
    );
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

/** Keep one supervised run root alive for the lifetime of a stream scope. */
export const trackAgentStream =
  (annotation: AgentRunAnnotation) =>
  <A, E, R>(stream: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    Stream.unwrapScoped(
      Effect.gen(function* () {
        const started = yield* Deferred.make<void>();
        yield* trackAgentRun(annotation)(
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Effect.never)
          )
        ).pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        return stream;
      })
    );

/** Apply a transition from outside the annotated run fiber (for stream taps). */
export const transitionAgentRun = (
  service: AgentStatusService,
  annotation: AgentRunAnnotation,
  state: AgentRunState
): Effect.Effect<void> =>
  Effect.locally(
    service.transition(state),
    AgentRunAnnotationRef,
    Option.some(annotation)
  );

const makeAgentStatusLayer = Effect.gen(function* () {
  // The scoped client retains its runtime after Layer.toRuntime returns, while
  // the temporary construction Scope closes. This PubSub owns no external
  // resource, so keeping it runtime-owned avoids ending `changes` as soon as
  // createFred() resolves. Stream subscribers still release their scoped
  // PubSub subscriptions when their consumer fibers are interrupted.
  const changes = yield* PubSub.unbounded<AgentStatusChange>();
  const status = MutableRef.make<AgentStatusState>({
    version: 0,
    runs: HashMap.empty(),
  });

  const publish = (runs: TrackedRuns): void => {
    const current = MutableRef.get(status);
    const next = {
      version: current.version + 1,
      runs,
    };
    MutableRef.set(status, next);
    changes.unsafeOffer({
      version: next.version,
      snapshot: toSnapshot(runs),
    });
  };
  const supervisor = new AgentRunSupervisor(status, publish);
  const snapshot = Effect.sync(() => toSnapshot(MutableRef.get(status).runs));
  const changeSnapshots = Stream.unwrapScoped(
    Effect.gen(function* () {
      // Subscribe before capturing the current version. Any update that lands
      // between those operations is queued, while the version filter prevents
      // that already-captured state from being replayed after the snapshot.
      const liveChanges = yield* Stream.fromPubSub(changes, { scoped: true });
      const initial = MutableRef.get(status);

      return Stream.concat(
        Stream.make(toSnapshot(initial.runs)),
        liveChanges.pipe(
          Stream.filter((change) => change.version > initial.version),
          Stream.map((change) => change.snapshot),
        ),
      );
    }),
  );

  const transition = Effect.fn('AgentStatusService.transition')(
    function* (state: AgentRunState) {
      const annotation = yield* FiberRef.get(AgentRunAnnotationRef);
      if (Option.isNone(annotation)) return;

      const current = MutableRef.get(status).runs;
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
        publish(next);
      }
    }
  );

  const service: AgentStatusService = {
    snapshot,
    changes: changeSnapshots,
    transition,
  };

  return Layer.merge(
    Layer.succeed(AgentStatusService, service),
    Supervisor.addSupervisor(supervisor)
  );
});

/** One independent lifecycle tracker per Fred runtime. */
export const AgentStatusServiceLive: Layer.Layer<AgentStatusService> =
  Layer.unwrapEffect(makeAgentStatusLayer);
