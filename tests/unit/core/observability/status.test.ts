import { describe, expect, spyOn, test } from 'bun:test';
import {
  Deferred,
  Effect,
  Exit,
  Fiber,
  Layer,
  ManagedRuntime,
  Metric,
  MetricState,
  Stream,
} from 'effect';
import { LanguageModel } from '@effect/ai';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import {
  AgentStatusService,
  AgentStatusServiceLive,
  trackAgentRun,
  trackAgentStream,
} from '../../../../packages/core/src/observability/status';
import { AgentStatusService as EffectAgentStatusService } from '../../../../packages/core/src/effect/services';
import { AgentStatusService as PublicAgentStatusService } from '../../../../packages/core/src/index';
import { makeFredRuntimeLayer } from '../../../../packages/core/src/services';
import { createMockProvider } from '../../helpers/mock-provider';
import { createMockToolRegistry } from '../../helpers/mock-tool-registry';

const annotation = {
  runId: 'run-1',
  agentId: 'agent-1',
  workflowId: 'workflow-1',
  sessionId: 'session-1',
  startedAt: 1_234,
} as const;

const runningAgentGaugeValue = Effect.map(Metric.snapshot, (metrics) => {
  const gauge = Array.from(metrics).find(
    ({ metricKey, metricState }) =>
      metricKey.name === 'fred_agents_running'
      && MetricState.isGaugeState(metricState)
  );

  return gauge && MetricState.isGaugeState(gauge.metricState)
    ? gauge.metricState.value
    : 0;
});

describe('AgentStatusService', () => {
  test('ignores unannotated fibers', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const fiber = yield* Deferred.succeed(started, undefined).pipe(
          Effect.zipRight(Deferred.await(release)),
          Effect.fork
        );

        yield* Deferred.await(started);
        expect(yield* status.snapshot).toEqual([]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('tracks one run root, ignores descendants, and removes it on completion', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const rootStarted = yield* Deferred.make<void>();
        const childStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const run = yield* trackAgentRun(annotation)(
          Effect.gen(function* () {
            yield* Effect.fork(
              Deferred.succeed(childStarted, undefined).pipe(
                Effect.zipRight(Deferred.await(release))
              )
            );
            yield* Deferred.await(childStarted);
            yield* Deferred.succeed(rootStarted, undefined);
            yield* Deferred.await(release);
          })
        ).pipe(Effect.fork);

        yield* Deferred.await(rootStarted);
        const active = yield* status.snapshot;
        expect(active).toHaveLength(1);
        expect(active[0]).toMatchObject({
          agentId: 'agent-1',
          workflowId: 'workflow-1',
          sessionId: 'session-1',
          state: 'starting',
          startedAt: 1_234,
        });

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);
        expect(yield* status.snapshot).toEqual([]);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('removes an annotated run when its fiber is interrupted', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();

        const run = yield* trackAgentRun(annotation)(
          Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never))
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        expect(yield* status.snapshot).toHaveLength(1);

        yield* Fiber.interrupt(run);
        expect(yield* status.snapshot).toEqual([]);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('emits ordered start, transition, and cleanup snapshots', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const observed = yield* status.changes.pipe(
          Stream.take(3),
          Stream.runCollect,
          Effect.fork
        );
        yield* Effect.yieldNow();

        const run = yield* trackAgentRun(annotation)(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* status.transition('streaming');
            yield* Deferred.await(release);
          })
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);

        const snapshots = Array.from(yield* Fiber.join(observed));
        expect(snapshots.map((snapshot) => snapshot.length)).toEqual([1, 1, 0]);
        expect(snapshots[0]?.[0]?.state).toBe('starting');
        expect(snapshots[1]?.[0]?.state).toBe('streaming');
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('releases a changes subscription when its consumer is interrupted', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const consumer = yield* Stream.runDrain(status.changes).pipe(Effect.fork);
        yield* Effect.yieldNow();

        const exit = yield* Fiber.interrupt(consumer);
        expect(Exit.isInterrupted(exit)).toBe(true);
        expect(yield* status.snapshot).toEqual([]);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('tracks stream scope and records tagged lifecycle metrics', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const metricAnnotation = {
          ...annotation,
          runId: 'metric-run',
          agentId: 'metric-agent',
        };
        const stream = trackAgentStream(metricAnnotation)(
          Stream.fromEffect(Deferred.succeed(started, undefined)).pipe(
            Stream.concat(Stream.never)
          )
        );
        const fiber = yield* Stream.runDrain(stream).pipe(Effect.fork);

        yield* Deferred.await(started);
        expect(yield* status.snapshot).toMatchObject([
          { agentId: 'metric-agent', state: 'starting' },
        ]);

        const activeMetrics = Array.from(yield* Metric.snapshot);
        const activeGauge = activeMetrics.find(
          ({ metricKey, metricState }) =>
            metricKey.name === 'fred_agents_running'
            && MetricState.isGaugeState(metricState)
        );
        expect(
          activeGauge && MetricState.isGaugeState(activeGauge.metricState)
            ? activeGauge.metricState.value
            : undefined
        ).toBe(1);

        yield* Fiber.interrupt(fiber);
        expect(yield* status.snapshot).toEqual([]);

        const completedMetrics = Array.from(yield* Metric.snapshot);
        const taggedMetric = (name: string) => completedMetrics.find(
          ({ metricKey }) =>
            metricKey.name === name
            && metricKey.tags.some(
              ({ key, value }) => key === 'agentId' && value === 'metric-agent'
            )
        );
        const startedCounter = taggedMetric('fred_agent_runs_started_total');
        const completedCounter = taggedMetric('fred_agent_runs_completed_total');
        const duration = taggedMetric('fred_agent_run_duration_ms');
        const completedGauge = completedMetrics.find(
          ({ metricKey, metricState }) =>
            metricKey.name === 'fred_agents_running'
            && MetricState.isGaugeState(metricState)
        );

        expect(
          startedCounter && MetricState.isCounterState(startedCounter.metricState)
            ? startedCounter.metricState.count
            : 0
        ).toBeGreaterThanOrEqual(1);
        expect(
          completedCounter && MetricState.isCounterState(completedCounter.metricState)
            ? completedCounter.metricState.count
            : 0
        ).toBeGreaterThanOrEqual(1);
        expect(
          duration && MetricState.isHistogramState(duration.metricState)
            ? duration.metricState.count
            : 0
        ).toBeGreaterThanOrEqual(1);
        expect(
          completedGauge && MetricState.isGaugeState(completedGauge.metricState)
            ? completedGauge.metricState.value
            : undefined
        ).toBe(0);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('aggregates the running gauge across two independent Fred runtimes', async () => {
    const firstRuntime = ManagedRuntime.make(makeFredRuntimeLayer());
    const secondRuntime = ManagedRuntime.make(makeFredRuntimeLayer());
    const [firstStarted, firstRelease, secondStarted, secondRelease] =
      await Effect.runPromise(
        Effect.all([
          Deferred.make<void>(),
          Deferred.make<void>(),
          Deferred.make<void>(),
          Deferred.make<void>(),
        ])
      );

    const firstRun = firstRuntime.runPromise(
      trackAgentRun({
        ...annotation,
        runId: 'independent-runtime-run-1',
        agentId: 'independent-runtime-agent-1',
      })(
        Deferred.succeed(firstStarted, undefined).pipe(
          Effect.zipRight(Deferred.await(firstRelease))
        )
      )
    );
    const secondRun = secondRuntime.runPromise(
      trackAgentRun({
        ...annotation,
        runId: 'independent-runtime-run-2',
        agentId: 'independent-runtime-agent-2',
      })(
        Deferred.succeed(secondStarted, undefined).pipe(
          Effect.zipRight(Deferred.await(secondRelease))
        )
      )
    );

    try {
      await Effect.runPromise(Effect.all([
        Deferred.await(firstStarted),
        Deferred.await(secondStarted),
      ]));
      expect(await Effect.runPromise(runningAgentGaugeValue)).toBe(2);

      await Effect.runPromise(Deferred.succeed(firstRelease, undefined));
      await firstRun;
      expect(await Effect.runPromise(runningAgentGaugeValue)).toBe(1);

      await Effect.runPromise(Deferred.succeed(secondRelease, undefined));
      await secondRun;
      expect(await Effect.runPromise(runningAgentGaugeValue)).toBe(0);
    } finally {
      await Effect.runPromise(Effect.all([
        Deferred.succeed(firstRelease, undefined),
        Deferred.succeed(secondRelease, undefined),
      ]));
      await Promise.allSettled([firstRun, secondRun]);
      await firstRuntime.dispose();
      await secondRuntime.dispose();
    }
  });

  test('tracks a real AgentFactory invocation with available correlation metadata', async () => {
    const generateSpy = spyOn(LanguageModel, 'generateText');

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* AgentStatusService;
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          generateSpy.mockImplementation(() =>
            Deferred.succeed(started, undefined).pipe(
              Effect.zipRight(Deferred.await(release)),
              Effect.as({ text: 'done', toolCalls: [], toolResults: [], usage: {} })
            ) as any
          );

          const factory = new AgentFactory(createMockToolRegistry());
          factory.setAgentStatusService(status);
          const provider = {
            ...createMockProvider(),
            getModel: () => Effect.succeed(Layer.empty as any),
          };
          const agent = yield* factory.createAgent({
            id: 'factory-status-agent',
            platform: 'openai',
            model: 'gpt-4',
            systemMessage: 'Track this invocation.',
          }, provider);

          const invocation = yield* agent.processMessage('hello', [], {
            workflowId: 'workflow-real',
            sessionId: 'session-real',
          }).pipe(Effect.fork);

          yield* Deferred.await(started);
          expect(yield* status.snapshot).toMatchObject([
            {
              agentId: 'factory-status-agent',
              workflowId: 'workflow-real',
              sessionId: 'session-real',
              state: 'calling_model',
            },
          ]);

          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(invocation);
          expect(yield* status.snapshot).toEqual([]);
        }).pipe(Effect.provide(AgentStatusServiceLive))
      );
    } finally {
      generateSpy.mockRestore();
    }
  });

  test('is supervised by the Fred runtime layer and exported publicly', async () => {
    const [active, completed] = await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const run = yield* trackAgentRun(annotation)(
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Deferred.await(release))
          )
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        const active = yield* status.snapshot;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);
        const completed = yield* status.snapshot;
        return [active, completed] as const;
      }).pipe(Effect.provide(makeFredRuntimeLayer()))
    );

    expect(active).toHaveLength(1);
    expect(completed).toEqual([]);
    expect(EffectAgentStatusService).toBe(AgentStatusService);
    expect(PublicAgentStatusService).toBe(AgentStatusService);
  });
});
