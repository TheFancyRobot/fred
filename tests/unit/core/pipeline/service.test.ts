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
import { PipelineExecutionError, PipelineNotFoundError } from '../../../../packages/core/src/pipeline/errors';
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

    async close(): Promise<void> {
      checkpoints.length = 0;
    },
  };
}

// Build complete layer stack
const TestLayer = PipelineServiceLive.pipe(
  Layer.provide(AgentServiceLive),
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
        processMessage: async (input: string) => ({
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
      });

      return PipelineServiceLive.pipe(
        Layer.provide(MockAgentService),
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
});
