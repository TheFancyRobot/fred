import { describe, it, expect, spyOn } from 'bun:test';
import { Effect, Layer, Redacted, Schema, Stream } from 'effect';
import { LanguageModel } from '@effect/ai';
import { AgentService, AgentServiceLive } from '../../../../packages/core/src/agent/service';
import { ToolRegistryService, ToolRegistryServiceLive } from '../../../../packages/core/src/tool/service';
import { ProviderRegistryService, ProviderRegistryServiceLive } from '../../../../packages/core/src/platform/service';
import { ToolGateServiceLive } from '../../../../packages/core/src/tool-gate/service';
import { makeInMemoryProviderConnectionLayer } from '../../../../packages/core/src/platform/connections';
import {
  AgentNotFoundError,
  AgentAlreadyExistsError,
  AgentCreationError,
  getAgentAlreadyExistsMessage,
  getAgentCreationMessage,
  getAgentNotFoundMessage,
} from '../../../../packages/core/src/agent/errors';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import type { ProviderConfig, ProviderDefinition } from '../../../../packages/core/src/platform/provider';
import type { EffectProviderFactory } from '../../../../packages/core/src/platform/base';
import { OpenAiProviderFactory } from '../../../../packages/provider-openai/src/index';
import {
  ProviderConnectionId,
  ProviderConnectionNamespace,
  ProviderConnectionService,
  type ProviderConnectionAuth,
  type ProviderConnectionCredentials,
  type ProviderConnectionProtocol,
} from '../../../../packages/core/src/platform/connections';

describe('AgentService', () => {
  const ToolLayer = ToolRegistryServiceLive;
  const ProviderLayer = ProviderRegistryServiceLive;
  const ToolGateLayer = ToolGateServiceLive.pipe(Layer.provide(ToolLayer));
  const ProviderConnectionLayer = makeInMemoryProviderConnectionLayer();
  const AgentLayer = AgentServiceLive.pipe(
    Layer.provide(ToolLayer),
    Layer.provide(ProviderLayer),
    Layer.provide(ProviderConnectionLayer),
    Layer.provide(ToolGateLayer)
  );
  const TestLayer = Layer.mergeAll(AgentLayer, ProviderLayer, ProviderConnectionLayer, ToolLayer);

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
    it('resolves the selected connection again for each agent invocation', async () => {
      const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
      const connectionNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-a');
      const resolvedKeys: string[] = [];
      const providerFactory: EffectProviderFactory = {
        id: 'openai',
        load: async (config) => {
          if (config.credentials?.kind === 'api-key') {
            resolvedKeys.push(Redacted.value(config.credentials.apiKey));
          }
          return {
            layer: Layer.empty,
            getModel: () => Effect.succeed(Layer.empty as any),
          };
        },
      };
      const streamSpy = spyOn(LanguageModel, 'streamText').mockImplementation(() => Stream.fromIterable([
        { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ] as any) as any);

      try {
        await runTest(Effect.gen(function* () {
          const registry = yield* ProviderRegistryService;
          const connections = yield* ProviderConnectionService;
          yield* registry.registerFactory(providerFactory);
          yield* connections.put(connectionNamespace, {
            id: connectionId,
            label: 'Primary',
            providerId: 'openai',
            auth: { kind: 'api-key' },
            status: 'active',
          }, { kind: 'api-key', apiKey: Redacted.make('first-secret') });

          const service = yield* AgentService;
          const agent = yield* service.createAgent(createAgentConfig('rotating-agent', { connectionId, connectionNamespace }));
          if (agent.streamMessage === undefined) return yield* Effect.fail(new Error('Expected streaming agent.'));
          yield* Stream.runCollect(agent.streamMessage('First', []));
          yield* connections.put(connectionNamespace, {
            id: connectionId,
            label: 'Primary',
            providerId: 'openai',
            auth: { kind: 'api-key' },
            status: 'active',
          }, { kind: 'api-key', apiKey: Redacted.make('second-secret') });
          yield* Stream.runCollect(agent.streamMessage('Second', []));
        }));
      } finally {
        streamSpy.mockRestore();
      }

      expect(resolvedKeys).toEqual(['first-secret', 'second-secret']);
    });

    it('prepares saved credentials before every agent invocation', async () => {
      const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12');
      const connectionNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-oauth');
      const resolvedTokens: string[] = [];
      let preparations = 0;
      const providerFactory: EffectProviderFactory = {
        id: 'google',
        makeConnectionPrepare: () => (resolved, context) => Effect.gen(function* () {
          preparations += 1;
          if (
            resolved.source === 'saved'
            && resolved.credentials.kind === 'oauth2-bearer'
            && Redacted.value(resolved.credentials.accessToken) === 'expired-access'
          ) {
            yield* context.compareAndSetCredentials({
              ...resolved.credentials,
              accessToken: Redacted.make('rotated-access'),
            }, resolved.credentialVersion, new Date('2099-01-01T00:00:00.000Z'));
            return yield* context.reload();
          }
          return resolved;
        }),
        load: async (config) => {
          if (config.credentials?.kind === 'oauth2-bearer') {
            resolvedTokens.push(Redacted.value(config.credentials.accessToken));
          }
          return {
            layer: Layer.empty,
            getModel: () => Effect.succeed(Layer.empty as any),
          };
        },
      };
      const streamSpy = spyOn(LanguageModel, 'streamText').mockImplementation(() => Stream.fromIterable([
        { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ] as any) as any);

      try {
        await runTest(Effect.gen(function* () {
          const registry = yield* ProviderRegistryService;
          const connections = yield* ProviderConnectionService;
          yield* registry.registerFactory(providerFactory);
          yield* connections.put(connectionNamespace, {
            id: connectionId,
            label: 'Google OAuth',
            providerId: 'google',
            auth: { kind: 'oauth2-bearer' },
            status: 'active',
          }, {
            kind: 'oauth2-bearer',
            accessToken: Redacted.make('expired-access'),
            refreshToken: Redacted.make('refresh-token'),
          });
          const service = yield* AgentService;
          const agent = yield* service.createAgent(createAgentConfig('oauth-agent', {
            platform: 'google',
            connectionId,
            connectionNamespace,
          }));
          if (agent.streamMessage === undefined) return yield* Effect.fail(new Error('Expected streaming agent.'));
          yield* Stream.runCollect(agent.streamMessage('First', []));
          yield* Stream.runCollect(agent.streamMessage('Second', []));
        }));
      } finally {
        streamSpy.mockRestore();
      }

      expect(preparations).toBe(2);
      expect(resolvedTokens).toEqual(['rotated-access', 'rotated-access']);
    });

    it('invokes both local-compatible protocols with none, API-key, and Basic auth', async () => {
      const connectionNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-local');
      const runtimeConfigs: Array<{
        providerId: string;
        baseUrl: string | undefined;
        protocol: ProviderConnectionProtocol | undefined;
        auth: string | undefined;
      }> = [];
      const streamSpy = spyOn(LanguageModel, 'streamText').mockImplementation(() => Stream.fromIterable([
        { type: 'finish', reason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
      ] as any) as any);
      const cases: ReadonlyArray<{
        id: string;
        providerId: 'openai' | 'anthropic';
        protocol: ProviderConnectionProtocol;
        auth: ProviderConnectionAuth;
        credentials: ProviderConnectionCredentials;
      }> = [
        { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', providerId: 'openai', protocol: 'openai-compatible', auth: { kind: 'none' }, credentials: { kind: 'none' } },
        { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12', providerId: 'openai', protocol: 'openai-compatible', auth: { kind: 'api-key' }, credentials: { kind: 'api-key', apiKey: Redacted.make('local-openai-key') } },
        { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13', providerId: 'openai', protocol: 'openai-compatible', auth: { kind: 'basic' }, credentials: { kind: 'basic', username: Redacted.make('openai-user'), password: Redacted.make('openai-password') } },
        { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a14', providerId: 'anthropic', protocol: 'anthropic-compatible', auth: { kind: 'none' }, credentials: { kind: 'none' } },
        { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15', providerId: 'anthropic', protocol: 'anthropic-compatible', auth: { kind: 'api-key' }, credentials: { kind: 'api-key', apiKey: Redacted.make('local-anthropic-key') } },
        { id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16', providerId: 'anthropic', protocol: 'anthropic-compatible', auth: { kind: 'basic' }, credentials: { kind: 'basic', username: Redacted.make('anthropic-user'), password: Redacted.make('anthropic-password') } },
      ];

      try {
        await runTest(Effect.gen(function* () {
          const registry = yield* ProviderRegistryService;
          const connections = yield* ProviderConnectionService;
          const service = yield* AgentService;
          for (const providerId of ['openai', 'anthropic'] as const) {
            yield* registry.registerFactory({
              id: providerId,
              connectionCapabilities: { providerId, auth: ['api-key'], login: ['manual-secret'] },
              load: async (config) => {
                if (config.baseUrl !== undefined) {
                  runtimeConfigs.push({
                    providerId,
                    baseUrl: config.baseUrl,
                    protocol: config.connectionProtocol,
                    auth: config.credentials?.kind,
                  });
                }
                return {
                  layer: Layer.empty,
                  getModel: () => Effect.succeed(Layer.empty as any),
                };
              },
            });
          }

          for (const fixture of cases) {
            const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)(fixture.id);
            yield* connections.put(connectionNamespace, {
              id: connectionId,
              label: `Local ${fixture.providerId} ${fixture.auth.kind}`,
              providerId: 'local-compatible',
              endpoint: `http://127.0.0.1:${fixture.providerId === 'openai' ? '11434' : '11435'}/v1`,
              protocol: fixture.protocol,
              auth: fixture.auth,
              status: 'active',
            }, fixture.credentials);
            const agent = yield* service.createAgent(createAgentConfig(`local-${fixture.providerId}-${fixture.auth.kind}`, {
              platform: fixture.providerId,
              connectionId,
              connectionNamespace,
            }));
            if (agent.streamMessage === undefined) return yield* Effect.fail(new Error('Expected streaming agent.'));
            yield* Stream.runCollect(agent.streamMessage('Hello', []));
          }
        }));
      } finally {
        streamSpy.mockRestore();
      }

      expect(runtimeConfigs).toEqual(cases.map((fixture) => ({
        providerId: fixture.providerId,
        baseUrl: `http://127.0.0.1:${fixture.providerId === 'openai' ? '11434' : '11435'}/v1`,
        protocol: fixture.protocol,
        auth: fixture.auth.kind,
      })));
    });

    it('uses Chat Completions for saved local OpenAI-compatible connections and Responses for hosted OpenAI', async () => {
      const connectionNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-transport');
      const localConnectionId = Schema.decodeUnknownSync(ProviderConnectionId)('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
      const hostedConnectionId = Schema.decodeUnknownSync(ProviderConnectionId)('f0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12');
      const originalFetch = globalThis.fetch;
      const urls: string[] = [];
      const runtimeConfigs: ProviderConfig[] = [];
      const providerFactory: EffectProviderFactory = {
        ...OpenAiProviderFactory,
        load: async (config) => {
          runtimeConfigs.push(config);
          return OpenAiProviderFactory.load(config);
        },
      };
      globalThis.fetch = async (input, init) => {
        urls.push(new Request(input, init).url);
        return Response.json({ error: { message: 'test transport recorder' } }, { status: 400 });
      };

      try {
        await runTest(Effect.gen(function* () {
          const registry = yield* ProviderRegistryService;
          const connections = yield* ProviderConnectionService;
          const service = yield* AgentService;
          yield* registry.registerFactory(providerFactory);
          yield* connections.put(connectionNamespace, {
            id: localConnectionId,
            label: 'Local OpenAI-compatible',
            providerId: 'local-compatible',
            endpoint: 'http://127.0.0.1:11434/v1',
            protocol: 'openai-compatible',
            auth: { kind: 'none' },
            status: 'active',
          }, { kind: 'none' });
          yield* connections.put(connectionNamespace, {
            id: hostedConnectionId,
            label: 'Hosted OpenAI',
            providerId: 'openai',
            auth: { kind: 'api-key' },
            status: 'active',
          }, { kind: 'api-key', apiKey: Redacted.make('hosted-test-key') });

          const localAgent = yield* service.createAgent(createAgentConfig('local-transport', {
            connectionId: localConnectionId,
            connectionNamespace,
          }));
          const hostedAgent = yield* service.createAgent(createAgentConfig('hosted-transport', {
            connectionId: hostedConnectionId,
            connectionNamespace,
          }));
          yield* localAgent.processMessage('Hello').pipe(Effect.either);
          yield* hostedAgent.processMessage('Hello').pipe(Effect.either);
        }));
      } finally {
        globalThis.fetch = originalFetch;
      }

      expect(runtimeConfigs.slice(-2)).toMatchObject([
        { baseUrl: 'http://127.0.0.1:11434/v1', connectionProtocol: 'openai-compatible' },
        { credentials: { kind: 'api-key' } },
      ]);
      expect(urls).toEqual([
        'http://127.0.0.1:11434/v1/chat/completions',
        'https://api.openai.com/v1/responses',
      ]);
    });

    it('rejects local auth modes on hosted provider connections', async () => {
      const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)('e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
      const connectionNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-hosted');
      const streamSpy = spyOn(LanguageModel, 'streamText').mockImplementation(() => Stream.empty as any);

      try {
        const result = await runTest(Effect.gen(function* () {
          const registry = yield* ProviderRegistryService;
          const connections = yield* ProviderConnectionService;
          yield* registry.registerFactory({
            id: 'openai',
            connectionCapabilities: { providerId: 'openai', auth: ['api-key'], login: ['manual-secret'] },
            load: async () => ({ layer: Layer.empty, getModel: () => Effect.succeed(Layer.empty as any) }),
          });
          yield* connections.put(connectionNamespace, {
            id: connectionId,
            label: 'Invalid hosted no-auth',
            providerId: 'openai',
            auth: { kind: 'none' },
            status: 'active',
          }, { kind: 'none' });
          const service = yield* AgentService;
          const agent = yield* service.createAgent(createAgentConfig('hosted-no-auth', { connectionId, connectionNamespace }));
          if (agent.streamMessage === undefined) return yield* Effect.fail(new Error('Expected streaming agent.'));
          return yield* Stream.runCollect(agent.streamMessage('Hello', [])).pipe(Effect.either);
        }));
        expect(result._tag).toBe('Left');
      } finally {
        streamSpy.mockRestore();
      }
    });

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

    it('preserves configured tools when no tool policies are set', async () => {
      const result = await runTest(
        Effect.gen(function* () {
          const providerRegistry = yield* ProviderRegistryService;
          yield* providerRegistry.registerDefinition(createMockProviderDefinition('openai'));

          const tools = yield* ToolRegistryService;
          yield* tools.registerTool({
            id: 'save-note',
            name: 'save-note',
            description: 'Save a note',
            execute: () => 'saved',
          });

          const service = yield* AgentService;
          const created = yield* service.createAgent(createAgentConfig('tool-user', {
            tools: ['save-note'],
          }));

          return created.config.tools;
        })
      );

      expect(result).toEqual(['save-note']);
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
