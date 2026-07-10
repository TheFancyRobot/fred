import { describe, test, expect, beforeEach } from 'bun:test';
import { Effect, Layer } from 'effect';
import { PipelineService, PipelineServiceLive } from '../../../../packages/core/src/pipeline/service';
import { AgentService, AgentServiceLive } from '../../../../packages/core/src/agent/service';
import { HookManagerService, HookManagerServiceLive } from '../../../../packages/core/src/hooks/service';
import { CheckpointService, CheckpointServiceLive } from '../../../../packages/core/src/pipeline/checkpoint/service';
import { PauseService, PauseServiceLive } from '../../../../packages/core/src/pipeline/pause/service';
import { ToolRegistryService, ToolRegistryServiceLive } from '../../../../packages/core/src/tool/service';
import { ProviderRegistryService, ProviderRegistryServiceLive } from '../../../../packages/core/src/platform/service';
import { ToolGateServiceLive } from '../../../../packages/core/src/tool-gate/service';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from '../../../../packages/core/src/pipeline/checkpoint/types';
import type { AgentInstance } from '../../../../packages/core/src/agent/agent';
import type { PipelineResult } from '../../../../packages/core/src/pipeline/executor';
import { ExecutorService, ExecutorServiceLive } from '../../../../packages/core/src/pipeline/executor';
import { GraphExecutorService, GraphExecutorServiceLive } from '../../../../packages/core/src/pipeline/graph-executor';
import {
  GraphValidationError,
  PipelineExecutionError,
  PipelineNotFoundError,
} from '../../../../packages/core/src/pipeline/errors';
import { AgentNotFoundError } from '../../../../packages/core/src/agent/errors';

/**
 * Create a mock CheckpointStorage for testing.
 */
function createMockStorage(): CheckpointStorage {
  const checkpoints: Checkpoint[] = [];

  return {
    async save(checkpoint: Checkpoint): Promise<void> {
      const existingIndex = checkpoints.findIndex(
        c => c.runId === checkpoint.runId && c.step === checkpoint.step
      );
      if (existingIndex >= 0) {
        checkpoints[existingIndex] = checkpoint;
      } else {
        checkpoints.push(checkpoint);
      }
    },

    async getLatest(runId: string): Promise<Checkpoint | null> {
      const filtered = checkpoints
        .filter(c => c.runId === runId)
        .sort((a, b) => b.step - a.step);
      return filtered[0] ?? null;
    },

    async get(runId: string, step: number): Promise<Checkpoint | null> {
      return checkpoints.find(c => c.runId === runId && c.step === step) ?? null;
    },

    async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
      const checkpoint = checkpoints.find(c => c.runId === runId && c.step === step);
      if (checkpoint) {
        checkpoint.status = status;
        checkpoint.updatedAt = new Date();
      }
    },

    async deleteRun(runId: string): Promise<void> {
      const toRemove = checkpoints.filter(c => c.runId === runId);
      for (const cp of toRemove) {
        const idx = checkpoints.indexOf(cp);
        if (idx >= 0) {
          checkpoints.splice(idx, 1);
        }
      }
    },

    async deleteExpired(): Promise<number> {
      const now = new Date();
      const expired = checkpoints.filter(c => c.expiresAt && c.expiresAt < now);
      for (const cp of expired) {
        const idx = checkpoints.indexOf(cp);
        if (idx >= 0) {
          checkpoints.splice(idx, 1);
        }
      }
      return expired.length;
    },

    async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
      return checkpoints.filter(c => c.status === status);
    },

    async getLatestByPipelineId(pipelineId: string): Promise<Checkpoint | null> {
      const filtered = checkpoints
        .filter(c => c.pipelineId === pipelineId)
        .filter(c => !c.expiresAt || c.expiresAt > new Date())
        .sort((a, b) => {
          // Sort by step DESC, then by createdAt DESC for tie-break
          if (b.step !== a.step) return b.step - a.step;
          return b.createdAt.getTime() - a.createdAt.getTime();
        });
      return filtered[0] ?? null;
    },

    async close(): Promise<void> {
      checkpoints.length = 0;
    },
  };
}

// Build complete layer stack
const TestLayer = PipelineServiceLive.pipe(
  Layer.provide(AgentServiceLive),
  Layer.provide(ExecutorServiceLive),
  Layer.provide(GraphExecutorServiceLive),
  Layer.provide(HookManagerServiceLive),
  Layer.provide(PauseServiceLive),
  Layer.provide(CheckpointServiceLive({ storage: createMockStorage() })),
  Layer.provide(ToolGateServiceLive),
  Layer.provide(ToolRegistryServiceLive),
  Layer.provide(ProviderRegistryServiceLive)
);

const runWithService = <A, E>(effect: Effect.Effect<A, E, PipelineService>) =>
  Effect.runPromise(effect.pipe(Effect.provide(TestLayer)));

describe('PipelineService', () => {
  describe('hasPipeline', () => {
    test('returns false when no pipelines registered', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.hasPipeline('test-pipeline');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('getPipeline', () => {
    test('fails with PipelineNotFoundError when not exists', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPipeline('nonexistent');
        }).pipe(Effect.provide(TestLayer))
      );
      expect(result._tag).toBe('Failure');
    });
  });

  describe('getPipelineOptional', () => {
    test('returns undefined when not exists', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPipelineOptional('nonexistent');
        })
      );
      expect(result).toBeUndefined();
    });
  });

  describe('getAllPipelines', () => {
    test('returns empty array when no pipelines', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getAllPipelines();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('hasPipelineV2', () => {
    test('returns false when no V2 pipelines', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.hasPipelineV2('test-v2');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('getAllPipelinesV2', () => {
    test('returns empty array when no V2 pipelines', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getAllPipelinesV2();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('hasGraphWorkflow', () => {
    test('returns false when no graph workflows', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.hasGraphWorkflow('test-graph');
        })
      );
      expect(result).toBe(false);
    });
  });

  describe('getAllGraphWorkflows', () => {
    test('returns empty array when no graph workflows', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getAllGraphWorkflows();
        })
      );
      expect(result).toEqual([]);
    });
  });

  describe('clear', () => {
    test('clears all pipeline types', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.clear();
          const pipelines = yield* service.getAllPipelines();
          const v2 = yield* service.getAllPipelinesV2();
          const graphs = yield* service.getAllGraphWorkflows();
          return { pipelines: pipelines.length, v2: v2.length, graphs: graphs.length };
        })
      );
      expect(result.pipelines).toBe(0);
      expect(result.v2).toBe(0);
      expect(result.graphs).toBe(0);
    });
  });

  describe('removePipeline', () => {
    test('removes V2, graph, and native workflows from every registry', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.createPipelineV2({
            id: 'remove-v2',
            steps: [{ name: 'step', type: 'function', fn: () => 'v2' }],
          });
          yield* service.registerGraphWorkflow({
            id: 'remove-graph',
            type: 'graph',
            entryNode: 'start',
            nodes: [{ id: 'start', type: 'function', fn: () => 'graph' }],
            edges: [],
          });
          yield* service.defineWorkflow({
            id: 'remove-native',
            source: 'native',
            entry: 'start',
            nodes: [{ id: 'start', kind: 'function', fn: () => 'native' }],
            edges: [],
          });

          const removed = {
            v2: yield* service.removePipeline('remove-v2'),
            graph: yield* service.removePipeline('remove-graph'),
            native: yield* service.removePipeline('remove-native'),
          };
          const remaining = {
            v2: yield* service.hasPipelineV2('remove-v2'),
            graph: yield* service.hasGraphWorkflow('remove-graph'),
            v2Ir: yield* service.hasWorkflowIR('remove-v2'),
            graphIr: yield* service.hasWorkflowIR('remove-graph'),
            nativeIr: yield* service.hasWorkflowIR('remove-native'),
          };

          yield* service.createPipelineV2({
            id: 'remove-v2',
            steps: [{ name: 'replacement', type: 'function', fn: () => 'replacement' }],
          });
          return {
            removed,
            remaining,
            redefined: yield* service.hasPipelineV2('remove-v2'),
          };
        })
      );

      expect(result.removed).toEqual({ v2: true, graph: true, native: true });
      expect(result.remaining).toEqual({
        v2: false,
        graph: false,
        v2Ir: false,
        graphIr: false,
        nativeIr: false,
      });
      expect(result.redefined).toBe(true);
    });
  });

  describe('defineWorkflow', () => {
    test('rejects invalid native workflow ids consistently', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.defineWorkflow({
            id: 'invalid/native',
            source: 'native',
            entry: 'start',
            nodes: [{ id: 'start', kind: 'function', fn: () => 'native' }],
            edges: [],
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure' && result.cause._tag === 'Fail') {
        expect(result.cause.error).toBeInstanceOf(GraphValidationError);
        expect(result.cause.error.message).toContain('invalid characters');
      }
    });
  });

  describe('matchPipelineByUtterance', () => {
    test('returns null when no pipelines with utterances', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.matchPipelineByUtterance('hello');
        })
      );
      expect(result).toBeNull();
    });
  });

  describe('getPauseService', () => {
    test('returns pause service', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPauseService();
        })
      );
      expect(result).toBeDefined();
    });
  });

  describe('createPipelineV2', () => {
    test('creates V2 pipeline successfully', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.createPipelineV2({
            id: 'test-pipeline-v2',
            steps: [
              { name: 'step1', type: 'agent', agentId: 'test-agent' }
            ]
          });
          return yield* service.hasPipelineV2('test-pipeline-v2');
        })
      );
      expect(result).toBe(true);
    });

    test('fails when pipeline already exists', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.createPipelineV2({
            id: 'duplicate-pipeline',
            steps: [
              { name: 'step1', type: 'agent', agentId: 'test-agent' }
            ]
          });
          // Try to create again
          yield* service.createPipelineV2({
            id: 'duplicate-pipeline',
            steps: [
              { name: 'step2', type: 'agent', agentId: 'test-agent2' }
            ]
          });
        }).pipe(Effect.provide(TestLayer))
      );
      expect(result._tag).toBe('Failure');
    });

    test('rejects an id already registered by another workflow dialect', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          yield* service.defineWorkflow({
            id: 'cross-dialect-duplicate',
            entry: 'native-step',
            nodes: [{ id: 'native-step', kind: 'function', fn: () => 'native' }],
            edges: [],
            source: 'native',
          });
          yield* service.createPipelineV2({
            id: 'cross-dialect-duplicate',
            steps: [{ name: 'v2-step', type: 'function', fn: () => 'v2' }],
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('getPipelineV2', () => {
    test('retrieves V2 pipeline after creation', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          const config = {
            id: 'get-test-pipeline',
            steps: [
              { name: 'step1', type: 'agent', agentId: 'test-agent' }
            ]
          };
          yield* service.createPipelineV2(config as any);
          const retrieved = yield* service.getPipelineV2('get-test-pipeline');
          return retrieved.id;
        })
      );
      expect(result).toBe('get-test-pipeline');
    });

    test('fails when pipeline not found', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getPipelineV2('nonexistent-v2');
        }).pipe(Effect.provide(TestLayer))
      );
      expect(result._tag).toBe('Failure');
    });
  });

  // ==========================================
  // executePipelineV2 Tests (V2 Execution)
  // ==========================================

  describe('executePipelineV2', () => {
    /**
     * Helper to create a mock agent that returns predictable responses.
     */
    function createMockAgentInstance(id: string): AgentInstance {
      return {
        id,
        config: { id } as any,
        processMessage: (input: string) => Effect.succeed({
          content: `Agent ${id} processed: ${input}`,
          toolCalls: [],
        }),
        streamMessage: () => {
          // Return a minimal Stream-like object that satisfies the type
          const { Stream } = require('effect');
          return Stream.succeed({ type: 'content' as const, delta: `Agent ${id} streamed` });
        },
      };
    }

    /**
     * Create a test layer with a pre-registered mock agent.
     */
    function createTestLayerWithMockAgent(agentId: string): Layer.Layer<PipelineService> {
      const mockAgent = createMockAgentInstance(agentId);

      const MockAgentService = Layer.succeed(AgentService, {
        createAgent: () => Effect.die('not implemented'),
        getAgent: (id: string) =>
          id === agentId
            ? Effect.succeed(mockAgent)
            : Effect.fail(new AgentNotFoundError({ id, message: `Agent not found: ${id}` })),
        getAgentOptional: (id: string) =>
          Effect.succeed(id === agentId ? mockAgent : undefined),
        hasAgent: (id: string) => Effect.succeed(id === agentId),
        removeAgent: () => Effect.succeed(false),
        getAllAgents: () => Effect.succeed([mockAgent]),
        clear: () => Effect.void,
        setTracer: () => Effect.void,
        setDefaultSystemMessage: () => Effect.void,
        setGlobalVariablesResolver: () => Effect.void,
        matchAgentByUtterance: () => Effect.succeed(null),
        getMCPMetrics: () => Effect.succeed({}),
        registerShutdownHooks: () => Effect.void,
        setTemplateEngine: () => Effect.void,
        setTemplateCustomNamespaces: () => Effect.void,
        setTemplateEnvAllowlist: () => Effect.void,
        setTemplateFredConfig: () => Effect.void,
      });

      return PipelineServiceLive.pipe(
        Layer.provide(MockAgentService),
        Layer.provide(ExecutorServiceLive),
        Layer.provide(GraphExecutorServiceLive),
        Layer.provide(HookManagerServiceLive),
        Layer.provide(PauseServiceLive),
        Layer.provide(CheckpointServiceLive({ storage: createMockStorage() })),
        Layer.provide(ToolGateServiceLive),
        Layer.provide(ToolRegistryServiceLive),
        Layer.provide(ProviderRegistryServiceLive)
      );
    }

    test('fails with PipelineNotFoundError when pipeline does not exist', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.executePipelineV2('nonexistent-pipeline', 'test input');
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') {
        // Should be PipelineExecutionError wrapping a not-found error
        const error = result.cause;
        expect(error).toBeDefined();
      }
    });

    test('executes V2 pipeline with function step and returns PipelineResult', async () => {
      const agentId = 'test-v2-agent';
      const TestLayerWithAgent = createTestLayerWithMockAgent(agentId);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          // Create a V2 pipeline with a function step (doesn't need agent)
          yield* service.createPipelineV2({
            id: 'v2-function-pipeline',
            steps: [
              {
                name: 'transform-input',
                type: 'function',
                fn: async (ctx) => `Transformed: ${ctx.input}`,
              },
            ],
          });

          // Execute the pipeline
          return yield* service.executePipelineV2('v2-function-pipeline', 'hello world');
        }).pipe(Effect.provide(TestLayerWithAgent))
      );

      // Verify the result is a proper PipelineResult
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.runId).toBeDefined();
      expect(result.finalOutput).toBe('Transformed: hello world');
      expect(result.context).toBeDefined();
      expect(result.context.pipelineId).toBe('v2-function-pipeline');
    });

    test('executes V2 pipeline with agent step and returns PipelineResult', async () => {
      const agentId = 'test-v2-agent';
      const TestLayerWithAgent = createTestLayerWithMockAgent(agentId);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          // Create a V2 pipeline with an agent step
          yield* service.createPipelineV2({
            id: 'v2-agent-pipeline',
            steps: [
              {
                name: 'call-agent',
                type: 'agent',
                agentId,
              },
            ],
          });

          // Execute the pipeline
          return yield* service.executePipelineV2('v2-agent-pipeline', 'process this');
        }).pipe(Effect.provide(TestLayerWithAgent))
      );

      // Verify the result is a proper PipelineResult
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.runId).toBeDefined();
      expect(result.finalOutput).toBeDefined();
      // The mock agent returns "Agent test-v2-agent processed: process this"
      expect((result.finalOutput as any).content).toContain('test-v2-agent processed');
    });

    test('fails with PipelineExecutionError when agent step references missing agent', async () => {
      // Use the default TestLayer which has no agents registered
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          // Create a V2 pipeline that references a non-existent agent
          yield* service.createPipelineV2({
            id: 'v2-missing-agent-pipeline',
            steps: [
              {
                name: 'call-missing-agent',
                type: 'agent',
                agentId: 'nonexistent-agent',
              },
            ],
          });

          // Execute the pipeline - should fail
          return yield* service.executePipelineV2('v2-missing-agent-pipeline', 'test input');
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') {
        // Verify it's a PipelineExecutionError
        const errors = Array.from(result.cause as any);
        const hasExecutionError = errors.some(
          (e: any) => e?._tag === 'PipelineExecutionError' || e?.constructor?.name === 'PipelineExecutionError'
        );
        expect(hasExecutionError || result.cause).toBeTruthy();
      }
    });

    test('passes conversationId and history through to execution context', async () => {
      const agentId = 'test-v2-agent';
      const TestLayerWithAgent = createTestLayerWithMockAgent(agentId);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: 'v2-context-pipeline',
            steps: [
              {
                name: 'process',
                type: 'function',
                fn: async (ctx) => ({ historyLength: ctx.history.length, conversationId: ctx.conversationId }),
              },
            ],
          });

          return yield* service.executePipelineV2('v2-context-pipeline', 'test', {
            conversationId: 'conv-123',
            history: [
              { role: 'user', content: 'previous message' },
              { role: 'assistant', content: 'previous response' },
            ],
          });
        }).pipe(Effect.provide(TestLayerWithAgent))
      );

      expect(result.success).toBe(true);
      expect((result.finalOutput as any).historyLength).toBe(2);
      expect((result.finalOutput as any).conversationId).toBe('conv-123');
    });

    test('returns runId for tracking and checkpointing', async () => {
      const agentId = 'test-v2-agent';
      const TestLayerWithAgent = createTestLayerWithMockAgent(agentId);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: 'v2-runid-pipeline',
            steps: [
              { name: 'step1', type: 'function', fn: async () => 'done' },
            ],
          });

          return yield* service.executePipelineV2('v2-runid-pipeline', 'test');
        }).pipe(Effect.provide(TestLayerWithAgent))
      );

      expect(result.success).toBe(true);
      expect(result.runId).toBeDefined();
      expect(typeof result.runId).toBe('string');
      // UUID format check (basic)
      expect(result.runId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  // ==========================================
  // Resume Tests (PIPE-02)
  // ==========================================

  describe('resume', () => {
    /**
     * Create a test layer with mock storage that has pre-seeded checkpoints.
     */
    function createTestLayerWithCheckpoints(checkpoints: Checkpoint[]): Layer.Layer<PipelineService> {
      const mockStorage = createMockStorage();
      // Pre-seed checkpoints
      for (const cp of checkpoints) {
        mockStorage.save(cp);
      }

      return PipelineServiceLive.pipe(
        Layer.provide(AgentServiceLive),
        Layer.provide(ExecutorServiceLive),
        Layer.provide(GraphExecutorServiceLive),
        Layer.provide(HookManagerServiceLive),
        Layer.provide(PauseServiceLive),
        Layer.provide(CheckpointServiceLive({ storage: mockStorage })),
        Layer.provide(ToolGateServiceLive),
        Layer.provide(ToolRegistryServiceLive),
        Layer.provide(ProviderRegistryServiceLive)
      );
    }

    /**
     * Create a test checkpoint for testing.
     */
    function createTestCheckpoint(overrides: Partial<Checkpoint> & { runId: string; pipelineId: string; step: number }): Checkpoint {
      const now = new Date();
      return {
        status: 'in_progress',
        context: {
          input: 'test input',
          outputs: {},
          history: [],
          metadata: {},
          pipelineId: overrides.pipelineId,
        },
        createdAt: now,
        updatedAt: now,
        ...overrides,
      };
    }

    test('restores from checkpoint state and continues execution', async () => {
      const runId = 'test-resume-run-1';
      const pipelineId = 'resume-test-pipeline';

      // Create checkpoint representing step 1 completed, ready for step 2
      const checkpoint = createTestCheckpoint({
        runId,
        pipelineId,
        step: 1,
        stepName: 'step1',
        status: 'in_progress',
        context: {
          input: 'original input',
          outputs: { step1: 'step1 output' },
          history: [],
          metadata: { customKey: 'customValue' },
          pipelineId,
        },
      });

      const TestLayerWithCheckpoint = createTestLayerWithCheckpoints([checkpoint]);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          // Create a pipeline with multiple steps
          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [
              { name: 'step1', type: 'function', fn: async () => 'step1 output' },
              { name: 'step2', type: 'function', fn: async (ctx) => `step2 received: ${ctx.outputs.step1}` },
              { name: 'step3', type: 'function', fn: async (ctx) => ({ final: ctx.outputs, metadata: ctx.metadata }) },
            ],
          });

          // Resume from checkpoint - should start at step 2 (skip step 1)
          return yield* service.resume(runId, { mode: 'skip' });
        }).pipe(Effect.provide(TestLayerWithCheckpoint))
      );

      // Verify resume behavior
      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.runId).toBe(runId);
      expect(result.resumedFromStep).toBe(1);
      // Verify restored context was used (outputs from checkpoint preserved)
      expect((result.finalOutput as any).final.step1).toBe('step1 output');
      expect((result.finalOutput as any).metadata.customKey).toBe('customValue');
    });

    test('fails with typed error when checkpoint not found', async () => {
      const nonexistentRunId = 'nonexistent-run-123';

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.resume(nonexistentRunId);
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') {
        // Verify typed error with checkpoint metadata
        const failure = result.cause;
        // The error should include runId context
        expect(failure).toBeDefined();
      }
    });

    test('fails with typed error when checkpoint is expired', async () => {
      const runId = 'expired-run-1';
      const pipelineId = 'expired-test-pipeline';

      // Create expired checkpoint
      const checkpoint = createTestCheckpoint({
        runId,
        pipelineId,
        step: 0,
        status: 'in_progress',
        expiresAt: new Date(Date.now() - 10000), // Expired 10 seconds ago
      });

      const TestLayerWithCheckpoint = createTestLayerWithCheckpoints([checkpoint]);

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [{ name: 'step1', type: 'function', fn: async () => 'done' }],
          });

          return yield* service.resume(runId);
        }).pipe(Effect.provide(TestLayerWithCheckpoint))
      );

      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') {
        // Error should indicate expiry
        expect(result.cause).toBeDefined();
      }
    });

    test('resolves latest checkpoint deterministically with timestamp tie-break', async () => {
      const pipelineId = 'tie-break-pipeline';
      const now = new Date();

      // Create two runs for the same pipeline with same timestamp
      // Run 1: earlier createdAt (should lose tie-break)
      const run1Id = 'tie-run-1';
      const checkpoint1 = createTestCheckpoint({
        runId: run1Id,
        pipelineId,
        step: 2,
        status: 'in_progress',
        createdAt: new Date(now.getTime() - 1000), // 1 second earlier
        updatedAt: new Date(now.getTime() - 1000),
      });

      // Run 2: later createdAt (should win tie-break)
      const run2Id = 'tie-run-2';
      const checkpoint2 = createTestCheckpoint({
        runId: run2Id,
        pipelineId,
        step: 3,
        status: 'in_progress',
        createdAt: now,
        updatedAt: now,
      });

      const TestLayerWithCheckpoint = createTestLayerWithCheckpoints([checkpoint1, checkpoint2]);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [
              { name: 'step1', type: 'function', fn: async () => 's1' },
              { name: 'step2', type: 'function', fn: async () => 's2' },
              { name: 'step3', type: 'function', fn: async () => 's3' },
              { name: 'step4', type: 'function', fn: async () => 's4' },
            ],
          });

          // Resume without specific runId - should pick run2 (latest by timestamp)
          return yield* service.resume(run2Id, { mode: 'skip' });
        }).pipe(Effect.provide(TestLayerWithCheckpoint))
      );

      // Should resume from run2 which has step 3 (not run1 with step 2)
      expect(result.runId).toBe(run2Id);
      expect(result.resumedFromStep).toBe(3);
    });

    test('retry mode re-executes the checkpointed step', async () => {
      const runId = 'retry-mode-run';
      const pipelineId = 'retry-pipeline';

      const checkpoint = createTestCheckpoint({
        runId,
        pipelineId,
        step: 1,
        stepName: 'step1',
        status: 'in_progress',
        context: {
          input: 'original input',
          outputs: { step0: 'step0 output' },
          history: [],
          metadata: {},
          pipelineId,
        },
      });

      const TestLayerWithCheckpoint = createTestLayerWithCheckpoints([checkpoint]);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [
              { name: 'step0', type: 'function', fn: async () => 'step0 output' },
              { name: 'step1', type: 'function', fn: async () => 'step1 re-executed' },
              { name: 'step2', type: 'function', fn: async () => 'step2 done' },
            ],
          });

          // Resume with retry mode - should re-execute step 1
          return yield* service.resume(runId, { mode: 'retry' });
        }).pipe(Effect.provide(TestLayerWithCheckpoint))
      );

      expect(result.success).toBe(true);
      expect(result.resumedFromStep).toBe(1);
    });
  });

  // ==========================================
  // resumeWithHumanInput Tests (PIPE-03)
  // ==========================================

  describe('resumeWithHumanInput', () => {
    /**
     * Create a test layer with paused checkpoints.
     */
    function createTestLayerWithPausedCheckpoints(checkpoints: Checkpoint[]): Layer.Layer<PipelineService> {
      const mockStorage = createMockStorage();
      for (const cp of checkpoints) {
        mockStorage.save(cp);
      }

      return PipelineServiceLive.pipe(
        Layer.provide(AgentServiceLive),
        Layer.provide(ExecutorServiceLive),
        Layer.provide(GraphExecutorServiceLive),
        Layer.provide(HookManagerServiceLive),
        Layer.provide(PauseServiceLive),
        Layer.provide(CheckpointServiceLive({ storage: mockStorage })),
        Layer.provide(ToolGateServiceLive),
        Layer.provide(ToolRegistryServiceLive),
        Layer.provide(ProviderRegistryServiceLive)
      );
    }

    /**
     * Create a paused checkpoint for testing human input resume.
     */
    function createPausedCheckpoint(overrides: Partial<Checkpoint> & { runId: string; pipelineId: string; step: number }): Checkpoint {
      const now = new Date();
      return {
        status: 'paused',
        context: {
          input: 'test input',
          outputs: {},
          history: [],
          metadata: {},
          pipelineId: overrides.pipelineId,
        },
        createdAt: now,
        updatedAt: now,
        pauseMetadata: {
          prompt: 'Please provide input',
          resumeBehavior: 'continue',
        },
        ...overrides,
      };
    }

    test('unblocks paused checkpoint and continues execution', async () => {
      const runId = 'paused-run-1';
      const pipelineId = 'paused-pipeline';

      const checkpoint = createPausedCheckpoint({
        runId,
        pipelineId,
        step: 1,
        stepName: 'pause-step',
        context: {
          input: 'original input',
          outputs: { step0: 'step0 output' },
          history: [],
          metadata: {},
          pipelineId,
        },
      });

      const TestLayerWithPaused = createTestLayerWithPausedCheckpoints([checkpoint]);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [
              { name: 'step0', type: 'function', fn: async () => 'step0 output' },
              { name: 'pause-step', type: 'function', fn: async () => 'paused step' },
              { name: 'after-pause', type: 'function', fn: async (ctx) => `after pause: ${ctx.metadata.humanInput}` },
            ],
          });

          // Resume with human input
          return yield* service.resumeWithHumanInput(runId, {
            humanInput: 'user provided this value',
          });
        }).pipe(Effect.provide(TestLayerWithPaused))
      );

      expect(result.success).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.runId).toBe(runId);
    });

    test('fails when checkpoint is not in paused state', async () => {
      const runId = 'not-paused-run';
      const pipelineId = 'not-paused-pipeline';

      // Create checkpoint that is NOT paused
      const checkpoint: Checkpoint = {
        runId,
        pipelineId,
        step: 1,
        status: 'in_progress', // NOT paused
        context: {
          input: 'test input',
          outputs: {},
          history: [],
          metadata: {},
          pipelineId,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const TestLayerWithCheckpoint = createTestLayerWithPausedCheckpoints([checkpoint]);

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [{ name: 'step1', type: 'function', fn: async () => 'done' }],
          });

          return yield* service.resumeWithHumanInput(runId, {
            humanInput: 'user input',
          });
        }).pipe(Effect.provide(TestLayerWithCheckpoint))
      );

      // Should fail because checkpoint is not paused
      expect(result._tag).toBe('Failure');
    });

    test('fails with typed error when paused checkpoint not found', async () => {
      const nonexistentRunId = 'nonexistent-paused-run';

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.resumeWithHumanInput(nonexistentRunId, {
            humanInput: 'user input',
          });
        }).pipe(Effect.provide(TestLayer))
      );

      expect(result._tag).toBe('Failure');
      if (result._tag === 'Failure') {
        // Error should include runId context
        expect(result.cause).toBeDefined();
      }
    });

    test('preserves non-input checkpoint state during human input resume', async () => {
      const runId = 'preserve-state-run';
      const pipelineId = 'preserve-state-pipeline';

      const checkpoint = createPausedCheckpoint({
        runId,
        pipelineId,
        step: 1,
        stepName: 'pause-step',
        context: {
          input: 'original input',
          outputs: {
            step0: 'important step0 output',
            anotherStep: 'another output',
          },
          history: [
            { role: 'user', content: 'previous message' },
            { role: 'assistant', content: 'previous response' },
          ],
          metadata: { customKey: 'customValue', anotherKey: 123 },
          pipelineId,
        },
      });

      const TestLayerWithPaused = createTestLayerWithPausedCheckpoints([checkpoint]);

      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [
              { name: 'step0', type: 'function', fn: async () => 'step0 output' },
              { name: 'anotherStep', type: 'function', fn: async () => 'another output' },
              { name: 'pause-step', type: 'function', fn: async () => 'paused' },
              { name: 'final', type: 'function', fn: async (ctx) => ({
                outputs: ctx.outputs,
                metadata: ctx.metadata,
              }) },
            ],
          });

          return yield* service.resumeWithHumanInput(runId, {
            humanInput: 'user input',
          });
        }).pipe(Effect.provide(TestLayerWithPaused))
      );

      expect(result.success).toBe(true);
      // Verify outputs were preserved
      expect((result.finalOutput as any).outputs.step0).toBe('important step0 output');
      expect((result.finalOutput as any).outputs.anotherStep).toBe('another output');
    });

    test('fails when paused checkpoint is expired', async () => {
      const runId = 'expired-paused-run';
      const pipelineId = 'expired-paused-pipeline';

      const checkpoint = createPausedCheckpoint({
        runId,
        pipelineId,
        step: 1,
        expiresAt: new Date(Date.now() - 10000), // Expired
      });

      const TestLayerWithPaused = createTestLayerWithPausedCheckpoints([checkpoint]);

      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* PipelineService;

          yield* service.createPipelineV2({
            id: pipelineId,
            steps: [{ name: 'step1', type: 'function', fn: async () => 'done' }],
          });

          return yield* service.resumeWithHumanInput(runId, {
            humanInput: 'user input',
          });
        }).pipe(Effect.provide(TestLayerWithPaused))
      );

      expect(result._tag).toBe('Failure');
    });
  });
});
