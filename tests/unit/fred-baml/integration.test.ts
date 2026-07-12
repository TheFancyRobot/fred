import { describe, expect, spyOn, test } from 'bun:test';
import { Effect, Layer, Schema } from 'effect';
import { LanguageModel } from '@effect/ai';
import {
  AgentService,
  createFred,
  PromptSourceService,
  ProviderRegistryService,
  makeFredRuntimeLayer,
  type PromptSourceContext,
} from '../../../packages/core/src/index';
import {
  BamlAgent,
  BamlPromptSourceLayer,
  createBamlTool,
  initFredBamlRuntime,
} from '../../../packages/fred-baml/src/index';
import { createMockProvider } from '../helpers/mock-provider';

interface StubBamlClient {
  readonly SummarizeSong: (input: { readonly title: string; readonly lyrics: string }) => Promise<string>;
}

function isStubBamlClient(client: unknown): client is StubBamlClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    'SummarizeSong' in client &&
    typeof client.SummarizeSong === 'function'
  );
}

interface StubBamlPromptClient {
  readonly BuildSupportPrompt: (input: {
    readonly agentId: string;
    readonly topic: string;
  }) => Promise<string>;
}

function isStubBamlPromptClient(
  client: unknown,
): client is StubBamlPromptClient {
  return (
    typeof client === 'object' &&
    client !== null &&
    'BuildSupportPrompt' in client &&
    typeof client.BuildSupportPrompt === 'function'
  );
}

describe('fred-baml integration', () => {
  test('registers and executes a BAML-backed tool through the scoped client', async () => {
    const runtime = initFredBamlRuntime({
      moduleId: 'tests/unit/fred-baml/fixtures/baml_client.stub',
      loadClient: () => import('./fixtures/baml_client.stub'),
    });

    const tool = createBamlTool({
      id: BamlAgent.toolId('summarizeSong'),
      description: 'Summarize a song using a generated BAML client',
      inputSchema: Schema.Struct({
        title: Schema.String,
        lyrics: Schema.String,
      }),
      successSchema: Schema.String,
      runtime,
      execute: async (input, activeRuntime) => {
        const client = await activeRuntime.loadClient();
        if (!isStubBamlClient(client)) {
          throw new Error('Stub BAML client did not expose SummarizeSong');
        }

        return client.SummarizeSong(input);
      },
    });

    const fred = await createFred();
    try {
      await fred.tools.register(tool);
      const registeredTool = (await fred.tools.list()).find(
        (candidate) => candidate.id === BamlAgent.toolId('summarizeSong'),
      );

      expect(registeredTool).toBeDefined();
      await expect(registeredTool?.execute({ title: 'Evergreen', lyrics: 'la la la' })).resolves.toBe(
        'summary:Evergreen:8',
      );
    } finally {
      await fred.shutdown();
    }
  });

  test('resolves an agent prompt through a consumer-owned generated client', async () => {
    const runtime = initFredBamlRuntime({
      moduleId: 'tests/unit/fred-baml/fixtures/baml_client.stub',
      loadClient: () => import('./fixtures/baml_client.stub'),
    });

    const layer = BamlPromptSourceLayer(
      async ({ functionName, agentId, input }) => {
        const client = await runtime.loadClient();
        if (
          !isStubBamlPromptClient(client) ||
          functionName !== 'BuildSupportPrompt'
        ) {
          throw new Error(`Stub BAML client did not expose ${functionName}`);
        }
        if (
          typeof input !== 'object' ||
          input === null ||
          !('topic' in input) ||
          typeof input.topic !== 'string'
        ) {
          throw new Error('Expected prompt input with a topic');
        }

        return client.BuildSupportPrompt({ agentId, topic: input.topic });
      },
    );
    const context: PromptSourceContext = {
      agentId: 'support-agent',
      input: { topic: 'billing' },
      renderTemplate: (template) => Effect.succeed(template),
    };

    const prompt = await Effect.runPromise(
      Effect.flatMap(PromptSourceService, (service) =>
        service.resolve({ baml: { function: 'BuildSupportPrompt' } }, context),
      ).pipe(Effect.provide(layer)),
    );

    expect(prompt).toBe(
      'You are support-agent. Help the customer with billing.',
    );
  });

  test('injects the BAML prompt layer into the runtime AgentService graph', async () => {
    const renderRequests: Array<{
      readonly functionName: string;
      readonly agentId: string;
      readonly input: unknown;
    }> = [];
    const promptSourceLayer = BamlPromptSourceLayer(async (request) => {
      renderRequests.push(request);
      return `Handle ${String((request.input as { topic: string }).topic)} requests.`;
    });
    const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation(() =>
      Effect.succeed({
        text: 'resolved through the runtime',
        toolCalls: [],
        toolResults: [],
        usage: {},
      } as never) as never
    );
    const provider = {
      ...createMockProvider(),
      getModel: () => Effect.succeed(Layer.empty as never),
    };

    try {
      const response = await Effect.runPromise(
        Effect.gen(function* () {
          const providers = yield* ProviderRegistryService;
          yield* providers.registerDefinition(provider);
          const agents = yield* AgentService;
          const agent = yield* agents.createAgent({
            id: 'runtime-baml-agent',
            platform: 'openai',
            model: 'test-model',
            systemMessage: { baml: { function: 'BuildSupportPrompt' } },
            input: Schema.Struct({ topic: Schema.String }),
          });
          return yield* agent.run({ topic: 'billing' });
        }).pipe(
          Effect.provide(makeFredRuntimeLayer({ promptSourceLayer })),
        ),
      );

      expect(response.content).toBe('resolved through the runtime');
      expect(renderRequests).toEqual([{
        functionName: 'BuildSupportPrompt',
        agentId: 'runtime-baml-agent',
        input: { topic: 'billing' },
      }]);
    } finally {
      generateSpy.mockRestore();
    }
  });
});
