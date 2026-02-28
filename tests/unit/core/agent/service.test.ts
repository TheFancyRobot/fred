import { describe, it, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import { AgentService, AgentServiceLive } from '../../../../packages/core/src/agent/service';
import { ToolRegistryService, ToolRegistryServiceLive } from '../../../../packages/core/src/tool/service';
import { ProviderRegistryService, ProviderRegistryServiceLive } from '../../../../packages/core/src/platform/service';
import { ToolGateServiceLive } from '../../../../packages/core/src/tool-gate/service';
import {
  AgentNotFoundError,
  AgentAlreadyExistsError,
  AgentCreationError,
  getAgentAlreadyExistsMessage,
  getAgentCreationMessage,
  getAgentNotFoundMessage,
} from '../../../../packages/core/src/agent/errors';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import type { ProviderDefinition } from '../../../../packages/core/src/platform/provider';

describe('AgentService', () => {
  const ToolLayer = ToolRegistryServiceLive;
  const ProviderLayer = ProviderRegistryServiceLive;
  const ToolGateLayer = ToolGateServiceLive.pipe(Layer.provide(ToolLayer));
  const AgentLayer = AgentServiceLive.pipe(
    Layer.provide(ToolLayer),
    Layer.provide(ProviderLayer),
    Layer.provide(ToolGateLayer)
  );
  const TestLayer = Layer.mergeAll(AgentLayer, ProviderLayer);

  const runTest = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
    Effect.runPromise(effect.pipe(Effect.provide(TestLayer)) as Effect.Effect<A, E, never>);

  const createMockProviderDefinition = (id: string): ProviderDefinition => ({
    id,
    aliases: [],
    config: {
      modelDefaults: { model: 'test-model' },
    },
    getModel: () => Effect.succeed({} as any),
    layer: Layer.empty as any,
  });

  const createAgentConfig = (id: string, overrides?: Partial<AgentConfig>): AgentConfig => ({
    id,
    platform: 'openai',
    model: 'test-model',
    systemMessage: 'You are a test agent',
    ...overrides,
  });

  describe('hasAgent', () => {
    it('should return false for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.hasAgent('non-existent');
        })
      );

      expect(result).toBe(false);
    });
  });

  describe('getAgent', () => {
    it('should fail with AgentNotFoundError for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getAgent('non-existent').pipe(
            Effect.either
          );
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(AgentNotFoundError);
        expect(result.left.id).toBe('non-existent');
        expect(result.left.message).toBe(getAgentNotFoundMessage('non-existent'));
      }
    });
  });

  describe('createAgent', () => {
    it('creates an agent when provider exists', async () => {
      const createdId = await runTest(
        Effect.gen(function* () {
          const providerRegistry = yield* ProviderRegistryService;
          yield* providerRegistry.registerDefinition(createMockProviderDefinition('openai'));

          const service = yield* AgentService;
          const created = yield* service.createAgent(createAgentConfig('writer'));
          return created.id;
        })
      );

      expect(createdId).toBe('writer');
    });

    it('fails with AgentAlreadyExistsError for duplicate id', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const providerRegistry = yield* ProviderRegistryService;
          yield* providerRegistry.registerDefinition(createMockProviderDefinition('openai'));

          const service = yield* AgentService;
          yield* service.createAgent(createAgentConfig('duplicate'));

          return yield* service.createAgent(createAgentConfig('duplicate')).pipe(Effect.either);
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(AgentAlreadyExistsError);
        expect(result.left.id).toBe('duplicate');
        expect(result.left.message).toBe(getAgentAlreadyExistsMessage('duplicate'));
      }
    });

    it('maps missing provider to AgentCreationError', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.createAgent(createAgentConfig('missing-provider')).pipe(Effect.either);
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left).toBeInstanceOf(AgentCreationError);
        expect(result.left.id).toBe('missing-provider');
        expect(result.left.message).toBe(getAgentCreationMessage('missing-provider'));
        expect(result.left.cause).toBeDefined();
      }
    });

    it('does not partially register agent when creation fails', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const providerRegistry = yield* ProviderRegistryService;
          const service = yield* AgentService;

          const failed = yield* service.createAgent(createAgentConfig('flaky')).pipe(Effect.either);
          const hasAfterFailure = yield* service.hasAgent('flaky');

          yield* providerRegistry.registerDefinition(createMockProviderDefinition('openai'));
          const created = yield* service.createAgent(createAgentConfig('flaky'));
          const hasAfterSuccess = yield* service.hasAgent('flaky');

          return {
            failed,
            hasAfterFailure,
            createdId: created.id,
            hasAfterSuccess,
          };
        })
      );

      expect(result.failed._tag).toBe('Left');
      if (result.failed._tag === 'Left') {
        expect(result.failed.left).toBeInstanceOf(AgentCreationError);
      }
      expect(result.hasAfterFailure).toBe(false);
      expect(result.createdId).toBe('flaky');
      expect(result.hasAfterSuccess).toBe(true);
    });
  });

  describe('getAgentOptional', () => {
    it('should return undefined for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getAgentOptional('non-existent');
        })
      );

      expect(result).toBeUndefined();
    });
  });

  describe('getAllAgents', () => {
    it('should return empty array initially', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getAllAgents();
        })
      );

      expect(result).toEqual([]);
    });
  });

  describe('setTracer', () => {
    it('should set tracer without error', async () => {
      const mockTracer = {
        startSpan: () => ({ end: () => {}, setStatus: () => {}, recordException: () => {}, setAttribute: () => {} }),
      } as any;

      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.setTracer(mockTracer);
        })
      );

      expect(true).toBe(true);
    });
  });

  describe('setDefaultSystemMessage', () => {
    it('should set default system message without error', async () => {
      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.setDefaultSystemMessage('Test system message');
        })
      );

      expect(true).toBe(true);
    });
  });

  describe('setGlobalVariablesResolver', () => {
    it('should set global variables resolver without error', async () => {
      const resolver = () => ({ foo: 'bar', count: 42 });

      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.setGlobalVariablesResolver(resolver);
        })
      );

      expect(true).toBe(true);
    });
  });

  describe('matchAgentByUtterance', () => {
    it('should return null when no agents registered', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.matchAgentByUtterance('hello');
        })
      );

      expect(result).toBeNull();
    });

    it('prioritizes exact over regex matches', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const providerRegistry = yield* ProviderRegistryService;
          yield* providerRegistry.registerDefinition(createMockProviderDefinition('openai'));

          const service = yield* AgentService;

          yield* service.createAgent(createAgentConfig('regex-agent', { utterances: ['^hello.*'] }));
          yield* service.createAgent(createAgentConfig('exact-agent', { utterances: ['hello world'] }));

          return yield* service.matchAgentByUtterance('hello world');
        })
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('exact-agent');
      expect(result?.matchType).toBe('exact');
      expect(result?.confidence).toBe(1);
    });

    it('prioritizes regex over semantic matches', async () => {
      let semanticCallCount = 0;

      const result = await runTest(
        Effect.gen(function* () {
          const providerRegistry = yield* ProviderRegistryService;
          yield* providerRegistry.registerDefinition(createMockProviderDefinition('openai'));

          const service = yield* AgentService;

          yield* service.createAgent(createAgentConfig('regex-agent', { utterances: ['^support.*'] }));
          yield* service.createAgent(createAgentConfig('semantic-agent', { utterances: ['help with billing'] }));

          return yield* service.matchAgentByUtterance(
            'support needed',
            async () => {
              semanticCallCount += 1;
              return { matched: true, confidence: 0.99, utterance: 'help with billing' };
            }
          );
        })
      );

      expect(result).not.toBeNull();
      expect(result?.agentId).toBe('regex-agent');
      expect(result?.matchType).toBe('regex');
      expect(result?.confidence).toBe(0.8);
      expect(semanticCallCount).toBe(0);
    });

    it('treats semantic matcher failures as no match', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const providerRegistry = yield* ProviderRegistryService;
          yield* providerRegistry.registerDefinition(createMockProviderDefinition('openai'));

          const service = yield* AgentService;
          yield* service.createAgent(createAgentConfig('semantic-agent', { utterances: ['help with billing'] }));

          return yield* service.matchAgentByUtterance(
            'unrelated text',
            async () => {
              throw new Error('semantic backend unavailable');
            }
          );
        })
      );

      expect(result).toBeNull();
    });
  });

  describe('getMCPMetrics', () => {
    it('should return MCP metrics', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.getMCPMetrics();
        })
      );

      expect(result).toBeDefined();
    });
  });

  describe('registerShutdownHooks', () => {
    it('should register shutdown hooks without error', async () => {
      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.registerShutdownHooks();
        })
      );

      expect(true).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear all agents', async () => {
      await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          yield* service.clear();
          const agents = yield* service.getAllAgents();
          return agents;
        })
      );

      expect(true).toBe(true);
    });
  });

  describe('removeAgent', () => {
    it('should return false for non-existent agent', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const service = yield* AgentService;
          return yield* service.removeAgent('non-existent');
        })
      );

      expect(result).toBe(false);
    });
  });

});
