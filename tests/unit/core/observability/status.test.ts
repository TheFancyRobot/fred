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
  Runtime,
  Stream,
} from 'effect';
import { LanguageModel, Model, Response } from '@effect/ai';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import type { AgentInstance } from '../../../../packages/core/src/agent/agent';
import type { AgentManagerLike } from '../../../../packages/core/src/pipeline/executor';
import {
  type AgentRunState,
  type AgentStatusListener,
  type AgentStatusSnapshot,
  type AgentStatusUnsubscribe,
  AgentStatusService,
  AgentStatusServiceLive,
  trackAgentRun,
  trackAgentStream,
} from '../../../../packages/core/src/observability/status';
import { AgentStatusService as EffectAgentStatusService } from '../../../../packages/core/src/effect/services';
import {
  AgentStatusService as PublicAgentStatusService,
  createFred,
  type FredClient,
} from '../../../../packages/core/src/index';
import { makeFredRuntimeLayer } from '../../../../packages/core/src/services';
import {
  ObservabilityService,
  ObservabilityServiceLive,
} from '../../../../packages/core/src/observability/service';
import { compilePipelineV1 } from '../../../../packages/core/src/workflow/compile';
import { executeWorkflowEffect } from '../../../../packages/core/src/workflow/execute';
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

const subscribeAgentStatus = (
  fred: FredClient,
  listener: AgentStatusListener,
): Promise<AgentStatusUnsubscribe> => fred.effects.run(
  Effect.gen(function* () {
    const status = yield* AgentStatusService;
    const fiber = yield* status.changes.pipe(
      Stream.runForEach((snapshot) =>
        Effect.sync(() => listener(snapshot)).pipe(
          Effect.catchAllCause(() => Effect.void),
        )
      ),
      Effect.forkDaemon,
    );
    let active = true;
    return async () => {
      if (!active) return;
      active = false;
      await fred.effects.run(Fiber.interrupt(fiber));
    };
  }),
);

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

  test('tracks three concurrent workflow executions with correlation metadata', async () => {
    const generateSpy = spyOn(LanguageModel, 'generateText');

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* AgentStatusService;
          const release = yield* Deferred.make<void>();
          const modelStarted = yield* Effect.all([
            Deferred.make<void>(),
            Deferred.make<void>(),
            Deferred.make<void>(),
          ]);
          let modelCallIndex = 0;

          generateSpy.mockImplementation(() => {
            const started = modelStarted[modelCallIndex++];
            if (!started) {
              return Effect.dieMessage('Unexpected extra model invocation');
            }
            return Deferred.succeed(started, undefined).pipe(
              Effect.zipRight(Deferred.await(release)),
              Effect.as(new LanguageModel.GenerateTextResponse([
                Response.textPart({ text: 'done' }),
              ])),
            );
          });

          const factory = new AgentFactory(createMockToolRegistry());
          factory.setAgentStatusService(status);
          const config = {
            id: 'workflow-status-agent',
            platform: 'mock',
            model: 'mock-model',
            systemMessage: 'Track workflow status.',
          };
          const createdAgent = yield* factory.createAgent(config, {
            ...createMockProvider('mock'),
            getModel: () => Effect.succeed(Model.make('mock', Layer.empty)),
          });
          const agent: AgentInstance = { ...createdAgent, id: config.id, config };
          const agentManager: AgentManagerLike = {
            getAgent: (id) => id === agent.id ? agent : undefined,
            hasAgent: (id) => id === agent.id,
          };
          const fixtures = [
            { workflowId: 'concurrent-workflow-1', sessionId: 'concurrent-session-1' },
            { workflowId: 'concurrent-workflow-2', sessionId: 'concurrent-session-2' },
            { workflowId: 'concurrent-workflow-3', sessionId: 'concurrent-session-3' },
          ];

          const fibers = yield* Effect.forEach(fixtures, ({ workflowId, sessionId }) =>
            executeWorkflowEffect(
              compilePipelineV1({ id: workflowId, agents: [agent.id] }),
              `message for ${sessionId}`,
              { agentManager, conversationId: sessionId },
            ).pipe(Effect.fork),
          );

          yield* Effect.all(modelStarted.map(Deferred.await));

          const active = yield* status.snapshot;
          expect(active).toHaveLength(3);
          expect(active).toEqual(expect.arrayContaining(fixtures.map(({ workflowId, sessionId }) =>
            expect.objectContaining({
              agentId: agent.id,
              workflowId,
              sessionId,
              state: 'calling_model',
            })
          )));
          expect(yield* runningAgentGaugeValue).toBe(3);

          yield* Deferred.succeed(release, undefined);
          yield* Effect.forEach(fibers, Fiber.join);
          expect(yield* status.snapshot).toEqual([]);
          expect(yield* runningAgentGaugeValue).toBe(0);
        }).pipe(Effect.provide(AgentStatusServiceLive)),
      );
    } finally {
      generateSpy.mockRestore();
    }
  });

  test('cleans up snapshots and the gauge after every exit path', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const modes = ['success', 'failure', 'defect', 'interruption'] as const;

        for (const mode of modes) {
          const started = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const terminal = mode === 'success'
            ? Effect.void
            : mode === 'failure'
              ? Effect.fail('expected typed failure')
              : mode === 'defect'
                ? Effect.dieMessage('expected defect')
                : Effect.never;
          const run = yield* trackAgentRun({
            ...annotation,
            runId: `exit-${mode}`,
            agentId: `exit-agent-${mode}`,
          })(
            Deferred.succeed(started, undefined).pipe(
              Effect.zipRight(Deferred.await(release)),
              Effect.zipRight(terminal),
            ),
          ).pipe(Effect.fork);

          yield* Deferred.await(started);
          expect(yield* status.snapshot).toHaveLength(1);
          expect(yield* runningAgentGaugeValue).toBe(1);

          const exit = mode === 'interruption'
            ? yield* Fiber.interrupt(run)
            : yield* Deferred.succeed(release, undefined).pipe(
                Effect.zipRight(Fiber.await(run)),
              );

          if (mode === 'success') {
            expect(Exit.isSuccess(exit)).toBe(true);
          } else if (mode === 'interruption') {
            expect(Exit.isInterrupted(exit)).toBe(true);
          } else {
            expect(Exit.isFailure(exit)).toBe(true);
          }
          expect(yield* status.snapshot).toEqual([]);
          expect(yield* runningAgentGaugeValue).toBe(0);
        }
      }).pipe(Effect.provide(AgentStatusServiceLive)),
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
          Stream.take(4),
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
        expect(snapshots.map((snapshot) => snapshot.length)).toEqual([0, 1, 1, 0]);
        expect(snapshots[1]?.[0]?.state).toBe('starting');
        expect(snapshots[2]?.[0]?.state).toBe('streaming');
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('subscribes after a run is active and then observes cleanup', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const initialObserved = yield* Deferred.make<void>();

        const run = yield* trackAgentRun(annotation)(
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Deferred.await(release)),
          ),
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        const observed = yield* status.changes.pipe(
          Stream.tap((snapshot) =>
            snapshot.length === 1
              ? Deferred.succeed(initialObserved, undefined)
              : Effect.void
          ),
          Stream.take(2),
          Stream.runCollect,
          Effect.fork,
        );

        yield* Deferred.await(initialObserved);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);

        const snapshots = Array.from(yield* Fiber.join(observed));
        expect(snapshots).toHaveLength(2);
        expect(snapshots[0]).toMatchObject([
          { agentId: 'agent-1', state: 'starting' },
        ]);
        expect(snapshots[1]).toEqual([]);
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

  test('exports live-status metrics through the existing OTLP snapshot', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const observability = yield* ObservabilityService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const exportAnnotation = {
          ...annotation,
          runId: 'otel-export-run',
          agentId: 'otel-export-agent',
        };
        const run = yield* trackAgentRun(exportAnnotation)(
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Deferred.await(release)),
          ),
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        expect(yield* status.snapshot).toHaveLength(1);

        const activeExport = yield* observability.exportMetricsOtel();
        const activeMetrics = activeExport.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? [];
        const running = activeMetrics.find(({ name }) => name === 'fred_agents_running');
        const startedMetric = activeMetrics.find(
          ({ name }) => name === 'fred_agent_runs_started_total',
        );
        const startedPoint = startedMetric?.sum?.dataPoints.find(
          ({ attributes }) => attributes.agentId === 'otel-export-agent',
        );

        expect(running?.gauge?.dataPoints).toContainEqual({
          attributes: {},
          value: 1,
          timeUnixNano: expect.any(String),
        });
        expect(startedPoint?.value).toBeGreaterThanOrEqual(1);
        expect(startedPoint?.attributes).toEqual({ agentId: 'otel-export-agent' });

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);

        const completedExport = yield* observability.exportMetricsOtel();
        const completedMetrics = completedExport.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? [];
        const completedGauge = completedMetrics.find(
          ({ name }) => name === 'fred_agents_running',
        );
        const completedMetric = completedMetrics.find(
          ({ name }) => name === 'fred_agent_runs_completed_total',
        );
        const durationMetric = completedMetrics.find(
          ({ name }) => name === 'fred_agent_run_duration_ms',
        );
        const completedPoint = completedMetric?.sum?.dataPoints.find(
          ({ attributes }) => attributes.agentId === 'otel-export-agent',
        );
        const durationPoint = durationMetric?.histogram?.dataPoints.find(
          ({ attributes }) => attributes.agentId === 'otel-export-agent',
        );

        expect(completedGauge?.gauge?.dataPoints).toContainEqual({
          attributes: {},
          value: 0,
          timeUnixNano: expect.any(String),
        });
        expect(completedPoint?.attributes).toEqual({
          agentId: 'otel-export-agent',
          exit: 'success',
        });
        expect(durationPoint?.attributes).toEqual({
          agentId: 'otel-export-agent',
          exit: 'success',
        });
        expect(durationPoint?.count).toBeGreaterThanOrEqual(1);
        expect(durationPoint?.bucketCounts.length).toBe(
          durationPoint?.explicitBounds.length === undefined
            ? undefined
            : durationPoint.explicitBounds.length + 1,
        );
      }).pipe(
        Effect.provide(Layer.mergeAll(
          AgentStatusServiceLive,
          ObservabilityServiceLive,
        )),
      ),
    );
  });

  test('aggregates the running gauge across two independent service runtimes', async () => {
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

  test('seeds stream status before the first model event and skips repeated token transitions', async () => {
    const streamSpy = spyOn(LanguageModel, 'streamText');

    try {
      await Effect.runPromise(
        Effect.gen(function* () {
          const status = yield* AgentStatusService;
          const modelStarted = yield* Deferred.make<void>();
          const releaseModel = yield* Deferred.make<void>();
          const transitions: AgentRunState[] = [];
          const observedStatus = {
            ...status,
            transition: (state: AgentRunState) =>
              Effect.sync(() => transitions.push(state)).pipe(
                Effect.zipRight(status.transition(state)),
              ),
          };

          streamSpy.mockImplementation(() =>
            Stream.fromEffect(
              Deferred.succeed(modelStarted, undefined).pipe(
                Effect.zipRight(Deferred.await(releaseModel)),
                Effect.as(Response.textDeltaPart({ id: 'text-1', delta: 'one' })),
              ),
            ).pipe(
              Stream.concat(Stream.make(
                Response.textDeltaPart({ id: 'text-1', delta: ' two' }),
                Response.textDeltaPart({ id: 'text-1', delta: ' three' }),
                Response.finishPart({
                  reason: 'stop',
                  usage: new Response.Usage({
                    inputTokens: 1,
                    outputTokens: 3,
                    totalTokens: 4,
                  }),
                }),
              )),
            )
          );

          const factory = new AgentFactory(createMockToolRegistry());
          factory.setAgentStatusService(observedStatus);
          const agent = yield* factory.createAgent({
            id: 'factory-stream-status-agent',
            platform: 'mock',
            model: 'mock-model',
            systemMessage: 'Track this streaming invocation.',
          }, {
            ...createMockProvider('mock'),
            getModel: () => Effect.succeed(Model.make('mock', Layer.empty)),
          });

          const invocation = yield* agent.streamMessage('hello', [], {
            workflowId: 'workflow-stream',
            sessionId: 'session-stream',
          }).pipe(Stream.runDrain, Effect.fork);

          yield* Deferred.await(modelStarted);
          expect(yield* status.snapshot).toMatchObject([{
            agentId: 'factory-stream-status-agent',
            workflowId: 'workflow-stream',
            sessionId: 'session-stream',
            state: 'calling_model',
          }]);

          yield* Deferred.succeed(releaseModel, undefined);
          yield* Fiber.join(invocation);
          expect(transitions).toEqual(['streaming']);
          expect(yield* status.snapshot).toEqual([]);
        }).pipe(Effect.provide(AgentStatusServiceLive)),
      );
    } finally {
      streamSpy.mockRestore();
    }
  });

  test('is supervised by the core runtime layer and exported publicly', async () => {
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

  test('Effect-native subscription stays live and disposes idempotently', async () => {
    const fred = await createFred();
    const snapshots: Array<ReadonlyArray<{ agentId: string; state: string }>> = [];
    let throwOnInitialSnapshot = true;
    let resolveActive: (() => void) | undefined;
    const activeObserved = new Promise<void>((resolve) => {
      resolveActive = resolve;
    });
    let unsubscribe: (() => Promise<void>) | undefined;

    try {
      unsubscribe = await subscribeAgentStatus(fred, (snapshot) => {
        if (throwOnInitialSnapshot) {
          throwOnInitialSnapshot = false;
          throw new Error('listener failure must stay isolated');
        }
        snapshots.push(snapshot);
        if (snapshot.length === 1) resolveActive?.();
      });

      const started = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      const run = await fred.effects.run(Effect.forkDaemon(
        trackAgentRun(annotation)(
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Deferred.await(release)),
          ),
        ),
      ));

      await Effect.runPromise(Deferred.await(started));
      await activeObserved;
      expect(snapshots.at(-1)).toMatchObject([
        { agentId: 'agent-1', state: 'starting' },
      ]);

      await unsubscribe();
      await unsubscribe();
      const callsAfterDispose = snapshots.length;

      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(run));
      expect(snapshots).toHaveLength(callsAfterDispose);
    } finally {
      await unsubscribe?.();
      await fred.shutdown();
    }
  });

  test('Effect-native subscription starts with an active run and observes cleanup', async () => {
    const fred = await createFred();
    const started = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const run = await fred.effects.run(Effect.forkDaemon(
      trackAgentRun(annotation)(
        Deferred.succeed(started, undefined).pipe(
          Effect.zipRight(Deferred.await(release)),
        ),
      ),
    ));
    const snapshots: AgentStatusSnapshot[] = [];
    let resolveActive: (() => void) | undefined;
    const activeObserved = new Promise<void>((resolve) => {
      resolveActive = resolve;
    });
    let resolveCleanup: (() => void) | undefined;
    const cleanupObserved = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    let unsubscribe: AgentStatusUnsubscribe | undefined;

    try {
      await Effect.runPromise(Deferred.await(started));
      unsubscribe = await subscribeAgentStatus(fred, (snapshot) => {
        snapshots.push(snapshot);
        if (snapshot.length === 1) resolveActive?.();
        if (snapshot.length === 0) resolveCleanup?.();
      });

      await activeObserved;
      expect(snapshots[0]).toMatchObject([
        { agentId: 'agent-1', state: 'starting' },
      ]);

      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(run));
      await cleanupObserved;
      expect(snapshots.at(-1)).toEqual([]);
    } finally {
      await unsubscribe?.();
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.interrupt(run));
      await fred.shutdown();
    }
  });
});
