import { afterEach, describe, expect, test } from 'bun:test';
import {
  createFred,
  type AgentConfig,
  type AgentInstance,
  type FredClient,
} from '@fancyrobot/fred';
import { MessageProcessorService } from '@fancyrobot/fred/effect';
import { Effect } from 'effect';
import { ensureDefaultChatAgent } from '../src/chat-defaults';

const clients: FredClient[] = [];

const makeAgent = (id: string, platform: string, model: string): AgentInstance => {
  const config: AgentConfig = { id, platform, model };
  return {
    id,
    config,
    run: () => Effect.succeed({ content: '' }),
    processMessage: () => Effect.succeed({ content: '' }),
  };
};

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
});

describe('ensureDefaultChatAgent', () => {
  test('selects the preferred config default instead of the first agent', async () => {
    const base = await createFred();
    clients.push(base);
    const first = makeAgent('first', 'openai', 'first-model');
    const configured = makeAgent('configured', 'anthropic', 'configured-model');
    const client: FredClient = {
      ...base,
      agents: {
        ...base.agents,
        list: async () => [first, configured],
        get: async (id) => [first, configured].find((agent) => agent.id === id),
      },
    };

    const result = await ensureDefaultChatAgent(client, {
      preferredAgentId: configured.id,
    });

    expect(result).toEqual({
      provider: 'anthropic',
      model: 'configured-model',
      agentId: 'configured',
      created: false,
    });
    const processorConfig = await base.effects.run(
      Effect.flatMap(MessageProcessorService, (service) => service.getConfig()),
    );
    expect(processorConfig.defaultAgentId).toBe(configured.id);
  });

  test('sets a newly created fallback agent as the message-processor default', async () => {
    const previousApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'test-key';
    const base = await createFred();
    clients.push(base);
    let registeredAgentId: string | undefined;
    const client: FredClient = {
      ...base,
      agents: {
        ...base.agents,
        list: async () => [],
        register: async (config) => {
          registeredAgentId = config.id;
          return makeAgent(config.id, config.platform ?? 'openai', config.model ?? 'test-model');
        },
      },
      providers: {
        ...base.providers,
        use: async () => undefined,
      },
    };

    try {
      const result = await ensureDefaultChatAgent(client, { agentId: 'fallback' });
      const processorConfig = await base.effects.run(
        Effect.flatMap(MessageProcessorService, (service) => service.getConfig()),
      );

      expect(result.agentId).toBe('fallback');
      expect(result.created).toBe(true);
      expect(registeredAgentId).toBe('fallback');
      expect(processorConfig.defaultAgentId).toBe('fallback');
    } finally {
      if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousApiKey;
    }
  });
});
