import type { FredClient } from '@fancyrobot/fred';
import { MessageProcessorService } from '@fancyrobot/fred/effect';
import { Effect } from 'effect';

export const DEV_CHAT_PROVIDER_PACKAGES: Record<string, string> = {
  openai: '@fancyrobot/fred-openai',
  anthropic: '@fancyrobot/fred-anthropic',
  google: '@fancyrobot/fred-google',
  groq: '@fancyrobot/fred-groq',
  openrouter: '@fancyrobot/fred-openrouter',
};

export function detectAvailableProvider(): { platform: string; model: string } | { platform: null; model: null } {
  if (process.env.OPENAI_API_KEY) {
    return { platform: 'openai', model: 'gpt-4o-mini' };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { platform: 'anthropic', model: 'claude-3-5-haiku-latest' };
  }
  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    return { platform: 'google', model: 'gemini-2.0-flash-exp' };
  }
  if (process.env.GROQ_API_KEY) {
    return { platform: 'groq', model: 'llama-3.1-8b-instant' };
  }
  if (process.env.OPENROUTER_API_KEY) {
    return { platform: 'openrouter', model: 'openai/gpt-4o-mini' };
  }

  return { platform: null, model: null };
}

export async function loadProviderPackage(platform: string): Promise<void> {
  const packageName = DEV_CHAT_PROVIDER_PACKAGES[platform];
  if (!packageName) {
    throw new Error(
      `Unknown provider platform: ${platform}. Supported: ${Object.keys(DEV_CHAT_PROVIDER_PACKAGES).join(', ')}`
    );
  }

  await import(packageName);
}

export interface EnsureDefaultChatAgentOptions {
  agentId?: string;
  preferredAgentId?: string;
  systemMessage?: string;
}

export interface EnsureDefaultChatAgentResult {
  provider: string;
  model: string;
  agentId: string;
  created: boolean;
}

const DEFAULT_AGENT_ID = '__dev_agent__';
const DEFAULT_SYSTEM_MESSAGE =
  'You are a helpful assistant. Answer questions naturally and conversationally.\n\n' +
  'When you need to perform calculations or use other tools, use the tool calling feature provided by the API. ' +
  'Do not generate text that looks like XML tags or function calls - always use the native tool calling mechanism.\n\n' +
  'This is a temporary agent for dev-chat. Users can create custom agents in their config files.';

export async function ensureDefaultChatAgent(
  fred: FredClient,
  options: EnsureDefaultChatAgentOptions = {}
): Promise<EnsureDefaultChatAgentResult> {
  const agentId = options.agentId ?? DEFAULT_AGENT_ID;
  const systemMessage = options.systemMessage ?? DEFAULT_SYSTEM_MESSAGE;

  const agents = await fred.agents.list();
  if (agents.length > 0) {
    const processorConfig = await fred.effects.run(
      Effect.flatMap(MessageProcessorService, (service) => service.getConfig()),
    );
    const selectedAgentId = options.preferredAgentId
      ?? processorConfig.defaultAgentId
      ?? agents[0].id;

    if (processorConfig.defaultAgentId !== selectedAgentId) {
      await fred.effects.run(
        Effect.flatMap(MessageProcessorService, (service) =>
          service.updateConfig({ defaultAgentId: selectedAgentId })
        ),
      );
    }

    const selectedAgent = await fred.agents.get(selectedAgentId);
    if (!selectedAgent) {
      throw new Error(`Default agent could not be resolved: ${selectedAgentId}`);
    }

    return {
      provider: selectedAgent.config.platform ?? 'openai',
      model: selectedAgent.config.model ?? 'gpt-4o-mini',
      agentId: selectedAgentId,
      created: false,
    };
  }

  const providerInfo = detectAvailableProvider();
  if (!providerInfo.platform || !providerInfo.model) {
    throw new Error(
      'No AI provider configured. Please set one of:\n' +
      '  OPENAI_API_KEY\n' +
      '  ANTHROPIC_API_KEY\n' +
      '  GOOGLE_GENERATIVE_AI_API_KEY\n' +
      '  GROQ_API_KEY\n' +
      '  OPENROUTER_API_KEY'
    );
  }

  await loadProviderPackage(providerInfo.platform);
  await fred.providers.use(providerInfo.platform);
  await fred.agents.register({
    id: agentId,
    systemMessage,
    platform: providerInfo.platform,
    model: providerInfo.model,
    tools: ['calculator'],
  });
  await fred.effects.run(
    Effect.flatMap(MessageProcessorService, (service) =>
      service.updateConfig({ defaultAgentId: agentId })
    ),
  );
  return {
    provider: providerInfo.platform,
    model: providerInfo.model,
    agentId,
    created: true,
  };
}
