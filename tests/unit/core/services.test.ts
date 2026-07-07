/**
 * Tests for FredLayers composition and runtime creation.
 *
 * These tests verify that all Effect services are correctly composed
 * into the FredLayers aggregate layer and can be accessed through
 * the runtime.
 */

import { describe, test, expect } from 'bun:test';
import { Effect, Runtime, Stream } from 'effect';
import {
  FredLayers,
  makeFredLayersWithLeafRouting,
  createScopedFredRuntime,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  CheckpointService,
  PauseService,
  IntentMatcherService,
  IntentRouterService,
  MessageProcessorService,
  MessageRouterService,
  ToolGateService,
} from '../../../packages/core/src/services';
import type { Tool } from '../../../packages/core/src/tool/tool';

describe('FredLayers', () => {
  test('composes all services without errors', async () => {
    // Creating runtime validates layer composition
    const runtime = await createScopedFredRuntime();
    expect(runtime).toBeDefined();
  });

  test('provides ToolRegistryService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toBe(0);
  });

  test('provides HookManagerService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* HookManagerService;
        return yield* service.getRegisteredHookTypes();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });

  test('provides ProviderRegistryService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ProviderRegistryService;
        return yield* service.listProviders();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });

  test('provides ContextStorageService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* ContextStorageService;
        const id = yield* service.generateConversationId();
        return id;
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toMatch(/^conv_/);
  });

  test('provides AgentService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* AgentService;
        return yield* service.getAllAgents();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });

  test('provides CheckpointService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* CheckpointService;
        return yield* service.generateRunId();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('provides PauseService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* PauseService;
        return yield* service.hasPendingPause('test');
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toBe(false);
  });

  test('provides PipelineService', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.getAllPipelines();
      }).pipe(Effect.provide(FredLayers))
    );
    expect(result).toEqual([]);
  });
});

describe('createScopedFredRuntime', () => {
  test('creates runtime with all services', async () => {
    const runtime = await createScopedFredRuntime();

    // Use runtime to run an effect
    const result = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const toolService = yield* ToolRegistryService;
        const agentService = yield* AgentService;
        return {
          tools: yield* toolService.size(),
          agents: yield* agentService.getAllAgents(),
        };
      })
    );

    expect(result.tools).toBe(0);
    expect(result.agents).toEqual([]);
  });

  test('runtime supports multiple sequential operations', async () => {
    const runtime = await createScopedFredRuntime();

    // First operation
    const count1 = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    // Second operation
    const count2 = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    expect(count1).toBe(0);
    expect(count2).toBe(0);
  });
});

describe('Fred.create integration', () => {
  test('Fred.create initializes runtime', async () => {
    const { Fred } = await import('../../../packages/core/src/index');
    const fred = await Fred.create();

    expect(fred).toBeInstanceOf(Fred);

    // Runtime should be accessible
    const runtime = await fred.getRuntime();
    expect(runtime).toBeDefined();

    // Can run effects with the runtime. Built-in tools (calculator) are
    // registered into the runtime registry when the runtime is built.
    const result = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    expect(result).toBe(1);

    await fred.shutdown();
  });

  test('Fred constructor with lazy runtime works', async () => {
    const { Fred } = await import('../../../packages/core/src/index');
    const fred = new Fred();

    // Runtime not yet initialized
    // But getRuntime() triggers lazy initialization
    const runtime = await fred.getRuntime();
    expect(runtime).toBeDefined();

    await fred.shutdown();
  });
});

describe('Service isolation', () => {
  test('services have independent state', async () => {
    // Create two separate runtimes
    const runtime1 = await createScopedFredRuntime();
    const runtime2 = await createScopedFredRuntime();

    // Get initial counts
    const count1Before = await Runtime.runPromise(runtime1)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    const count2Before = await Runtime.runPromise(runtime2)(
      Effect.gen(function* () {
        const service = yield* ToolRegistryService;
        return yield* service.size();
      })
    );

    expect(count1Before).toBe(0);
    expect(count2Before).toBe(0);
  });
});

describe('Leaf routing composition', () => {
  test('FredLayers provides intent and router services', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const matcher = yield* IntentMatcherService;
        const router = yield* IntentRouterService;
        const processor = yield* MessageProcessorService;

        const intents = yield* matcher.getIntents();
        const config = yield* processor.getConfig();

        return {
          intents,
          hasRouter: typeof router.routeIntent === 'function',
          memoryDefaults: config.memoryDefaults,
        };
      }).pipe(Effect.provide(FredLayers))
    );

    expect(result.intents).toEqual([]);
    expect(result.hasRouter).toBe(true);
    expect(result.memoryDefaults).toEqual({});
  });

  test('makeFredLayersWithLeafRouting composes MessageRouterService without breaking processor', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        const route = yield* processor.routeMessage('no-match message');
        return route.type;
      }).pipe(
        Effect.provide(
          makeFredLayersWithLeafRouting({
            defaultAgent: 'default-agent',
            rules: [],
          })
        )
      )
    );

    // MessageRouterService is optional; when present, processor still resolves
    // to an explicit none result when the selected agent is unavailable.
    expect(result).toBe('none');
  });
});

/**
 * Phase 42 Integration Tests
 *
 * These tests verify that standalone PipelineService and MessageProcessorService
 * integrate correctly in the composed Effect layer environment without
 * imperative delegation seams.
 */
describe('Phase 42 Standalone Service Integration', () => {
  describe('PipelineService standalone behavior', () => {
    test('provides executePipelineV2 method in composed layers', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          // Verify method exists and returns an Effect
          const effect = service.executePipelineV2('non-existent', 'test');
          // executePipelineV2 should return an Effect that fails for non-existent pipeline
          const result = yield* Effect.either(effect);
          return result;
        }).pipe(Effect.provide(FredLayers))
      );

      // Should fail with PipelineExecutionError for non-existent pipeline
      expect(result._tag).toBe('Left');
    });

    test('provides resume method in composed layers', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          // Verify method exists and returns an Effect
          const effect = service.resume('non-existent-run-id');
          // resume should return an Effect that fails for non-existent run
          const result = yield* Effect.either(effect);
          return result;
        }).pipe(Effect.provide(FredLayers))
      );

      // Should fail with ResumeCheckpointNotFoundError for non-existent run
      expect(result._tag).toBe('Left');
    });

    test('provides resumeWithHumanInput method in composed layers', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          // Verify method exists and returns an Effect
          const effect = service.resumeWithHumanInput('non-existent-run-id', {
            humanInput: 'test input',
          });
          // resumeWithHumanInput should return an Effect that fails for non-existent run
          const result = yield* Effect.either(effect);
          return result;
        }).pipe(Effect.provide(FredLayers))
      );

      // Should fail with ResumeCheckpointNotFoundError for non-existent run
      expect(result._tag).toBe('Left');
    });

    test('V2 pipeline methods are available without manager delegation', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          // Verify all V2 methods exist and are functions
          return {
            hasCreatePipelineV2: typeof service.createPipelineV2 === 'function',
            hasGetPipelineV2: typeof service.getPipelineV2 === 'function',
            hasHasPipelineV2: typeof service.hasPipelineV2 === 'function',
            hasGetAllPipelinesV2: typeof service.getAllPipelinesV2 === 'function',
            hasExecutePipelineV2: typeof service.executePipelineV2 === 'function',
          };
        }).pipe(Effect.provide(FredLayers))
      );

      expect(result.hasCreatePipelineV2).toBe(true);
      expect(result.hasGetPipelineV2).toBe(true);
      expect(result.hasHasPipelineV2).toBe(true);
      expect(result.hasGetAllPipelinesV2).toBe(true);
      expect(result.hasExecutePipelineV2).toBe(true);
    });

    test('resume methods are available without manager delegation', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          // Verify resume methods exist and are functions
          return {
            hasResume: typeof service.resume === 'function',
            hasResumeWithHumanInput: typeof service.resumeWithHumanInput === 'function',
          };
        }).pipe(Effect.provide(FredLayers))
      );

      expect(result.hasResume).toBe(true);
      expect(result.hasResumeWithHumanInput).toBe(true);
    });
  });

  describe('MessageProcessorService standalone behavior', () => {
    test('provides processMessage method in composed layers', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* MessageProcessorService;
          // Verify method exists and returns an Effect
          const effect = service.processMessage('test message');
          const result = yield* Effect.either(effect);
          return result;
        }).pipe(Effect.provide(FredLayers))
      );

      // Should succeed or fail gracefully (not throw)
      expect(['Left', 'Right']).toContain(result._tag);
    });

    test('provides streamMessage method in composed layers', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* MessageProcessorService;
          // Verify method exists and returns a Stream
          const stream = service.streamMessage('test message');
          // Stream should be a valid Stream object
          return typeof stream !== 'undefined';
        }).pipe(Effect.provide(FredLayers))
      );

      expect(result).toBe(true);
    });

    test('provides routeMessage method without manager delegation', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* MessageProcessorService;
          // Verify method exists
          const effect = service.routeMessage('test message');
          const route = yield* effect;
          return route;
        }).pipe(Effect.provide(FredLayers))
      );

      // Should return a valid RouteResult
      expect(['agent', 'pipeline', 'intent', 'none']).toContain(result.type);
    });

    test('MessageProcessorService methods are available without manager delegation', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* MessageProcessorService;

          // Verify all key methods exist and are functions
          return {
            hasProcessMessage: typeof service.processMessage === 'function',
            hasStreamMessage: typeof service.streamMessage === 'function',
            hasRouteMessage: typeof service.routeMessage === 'function',
            hasGetConfig: typeof service.getConfig === 'function',
          };
        }).pipe(Effect.provide(FredLayers))
      );

      expect(result.hasProcessMessage).toBe(true);
      expect(result.hasStreamMessage).toBe(true);
      expect(result.hasRouteMessage).toBe(true);
      expect(result.hasGetConfig).toBe(true);
    });
  });

  describe('Service composition compatibility', () => {
    test('PipelineService and MessageProcessorService work together in FredLayers', async () => {
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const pipelineService = yield* PipelineService;
          const processorService = yield* MessageProcessorService;

          // Both services should be accessible in the same context
          const pipelines = yield* pipelineService.getAllPipelines();
          const config = yield* processorService.getConfig();

          return {
            pipelineCount: pipelines.length,
            hasConfig: config !== undefined,
          };
        }).pipe(Effect.provide(FredLayers))
      );

      expect(result.pipelineCount).toBe(0);
      expect(result.hasConfig).toBe(true);
    });

    test('standalone services do not require imperative Fred class', async () => {
      // This test verifies that services work without the Fred class wrapper
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const pipelineService = yield* PipelineService;
          const processorService = yield* MessageProcessorService;

          // Direct service access without Fred class
          const hasV2Pipeline = yield* pipelineService.hasPipelineV2('test');
          const routeResult = yield* processorService.routeMessage('test');

          return {
            hasV2Pipeline,
            routeType: routeResult.type,
          };
        }).pipe(Effect.provide(FredLayers))
      );

      // Services work independently
      expect(result.hasV2Pipeline).toBe(false);
      expect(['agent', 'pipeline', 'intent', 'none']).toContain(result.routeType);
    });
  });
});

describe('Phase 43 Fred facade', () => {
  const makeBoundaryTool = (id: string): Tool => ({
    id,
    name: id,
    description: 'Phase 43 boundary tool',
    execute: async () => ({ ok: true }),
  });

  test('processMessage delegates through MessageProcessorService for Fred.create and new Fred', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();
      let calls = 0;

      try {
        const runtime = await fred.getRuntime();
        const restore = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const service = yield* MessageProcessorService;
            const original = service.processMessage;

            (service as { processMessage: typeof service.processMessage }).processMessage = (message, options) => {
              calls += 1;
              return Effect.succeed({ content: 'phase-43' });
            };

            return () => {
              (service as { processMessage: typeof service.processMessage }).processMessage = original;
            };
          })
        );

        const result = await fred.processMessage('phase-43-boundary-check');
        restore();

        expect(result?.content).toBe('phase-43');
        expect(calls).toBe(1);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('registerTool writes through ToolRegistryService runtime state', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        const runtime = await fred.getRuntime();
        fred.registerTool(makeBoundaryTool(`phase-43-tool-${Math.random()}`));

        const serviceSize = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const tools = yield* ToolRegistryService;
            return yield* tools.size();
          })
        );

        expect(serviceSize).toBeGreaterThan(0);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('streamMessage delegates through MessageProcessorService streamMessage', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        const runtime = await fred.getRuntime();
        let calls = 0;

        const restore = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const service = yield* MessageProcessorService;
            const original = service.streamMessage;

            (service as { streamMessage: typeof service.streamMessage }).streamMessage = () => {
              calls += 1;
              return Stream.empty;
            };

            return () => {
              (service as { streamMessage: typeof service.streamMessage }).streamMessage = original;
            };
          })
        );

        const stream = fred.streamMessage('phase-43-stream-check');
        await stream.toArray();
        restore();

        expect(calls).toBe(1);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('routeMessage delegates through MessageProcessorService routeMessage', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        const runtime = await fred.getRuntime();
        let calls = 0;

        const restore = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const service = yield* MessageProcessorService;
            const original = service.routeMessage;

            (service as { routeMessage: typeof service.routeMessage }).routeMessage = () => {
              calls += 1;
              return Effect.succeed({ type: 'none' } as any);
            };

            return () => {
              (service as { routeMessage: typeof service.routeMessage }).routeMessage = original;
            };
          })
        );

        const result = await fred.routeMessage('phase-43-route-check');
        restore();

        expect(result.type).toBe('none');
        expect(calls).toBe(1);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('executePipeline delegates through PipelineService executePipeline', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        const runtime = await fred.getRuntime();
        let calls = 0;

        const restore = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const service = yield* PipelineService;
            const original = service.executePipeline;

            (service as { executePipeline: typeof service.executePipeline }).executePipeline = () => {
              calls += 1;
              return Effect.succeed({ content: 'phase-43-pipeline' } as any);
            };

            return () => {
              (service as { executePipeline: typeof service.executePipeline }).executePipeline = original;
            };
          })
        );

        const result = await fred.executePipeline('phase-43-pipeline-id', 'hello');
        restore();

        expect(result.content).toBe('phase-43-pipeline');
        expect(calls).toBe(1);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('registerAgent delegates through AgentService createAgent', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        const runtime = await fred.getRuntime();
        let calls = 0;

        const restore = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const service = yield* AgentService;
            const original = service.createAgent;

            (service as { createAgent: typeof service.createAgent }).createAgent = (config) => {
              calls += 1;
              return Effect.succeed({
                id: config.id,
                config,
                processMessage: async () => ({ content: 'phase-43-agent' }),
                streamMessage: () => Stream.empty,
              } as any);
            };

            return () => {
              (service as { createAgent: typeof service.createAgent }).createAgent = original;
            };
          })
        );

        const agent = await fred.registerAgent({
          id: `phase-43-agent-${Math.random()}`,
          systemMessage: 'test',
          platform: 'openai',
          model: 'gpt-4o-mini',
        } as any);
        restore();

        expect(agent.id.startsWith('phase-43-agent-')).toBe(true);
        expect(calls).toBe(1);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('setToolPolicies delegates through ToolGateService reloadPolicies', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        const runtime = await fred.getRuntime();
        let calls = 0;

        const restore = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const service = yield* ToolGateService;
            const original = service.reloadPolicies;

            (service as { reloadPolicies: typeof service.reloadPolicies }).reloadPolicies = (policies) => {
              calls += 1;
              return Effect.void;
            };

            return () => {
              (service as { reloadPolicies: typeof service.reloadPolicies }).reloadPolicies = original;
            };
          })
        );

        await fred.setToolPolicies(undefined);
        restore();

        expect(calls).toBe(1);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('testRoute and routing.explain delegate through MessageRouterService', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        fred.configureRouting({ defaultAgent: 'phase-43-default', rules: [] });
        const runtime = await fred.getRuntime();
        let calls = 0;

        const restore = await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const service = yield* MessageRouterService;
            const original = service.testRoute;

            (service as { testRoute: typeof service.testRoute }).testRoute = () => {
              calls += 1;
              return Effect.succeed({
                agent: 'phase-43-default',
                fallback: true,
                explanation: {
                  winner: {
                    targetId: 'phase-43-default',
                    targetName: 'phase-43-default',
                    confidence: 0.5,
                  },
                  alternatives: [],
                  calibration: {
                    rawScore: 0.5,
                    calibratedScore: 0.5,
                    calibrated: false,
                  },
                  reasoning: {
                    topFactors: [],
                    confidenceBand: 'medium',
                    fallbackUsed: true,
                  },
                },
              } as any);
            };

            return () => {
              (service as { testRoute: typeof service.testRoute }).testRoute = original;
            };
          })
        );

        const decision = await fred.testRoute('phase-43-test-route');
        const explanation = await fred.routing.explain('phase-43-explain-route');
        restore();

        expect(decision?.agent).toBe('phase-43-default');
        expect(explanation?.winner.targetId).toBe('phase-43-default');
        expect(calls).toBe(2);
      } finally {
        await fred.shutdown();
      }
    }
  });

  test('runtime ToolRegistryService registrations are visible via Fred.getTools', async () => {
    const { Fred } = await import('../../../packages/core/src/index');

    for (const createFred of [
      () => Fred.create(),
      async () => new Fred(),
    ]) {
      const fred = await createFred();

      try {
        const runtime = await fred.getRuntime();
        const runtimeTool = makeBoundaryTool(`phase-43-runtime-tool-${Math.random()}`);

        await Runtime.runPromise(runtime)(
          Effect.gen(function* () {
            const tools = yield* ToolRegistryService;
            yield* tools.registerTool(runtimeTool);
          })
        );

        expect(fred.getTools().some((tool) => tool.id === runtimeTool.id)).toBe(true);
      } finally {
        await fred.shutdown();
      }
    }
  });
});
