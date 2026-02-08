import { Fred } from '@fancyrobot/fred';

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
  'You have access to a calculator tool for arithmetic. When you need to calculate a mathematical expression, use the calculator tool. ' +
  'Do not generate text that looks like XML tags or function calls - use the actual tool calling feature.\n\n' +
  'This is a temporary agent for dev-chat. Users can create custom agents in their config files.';

export async function ensureDefaultChatAgent(
  fred: Fred,
  options: EnsureDefaultChatAgentOptions = {}
): Promise<EnsureDefaultChatAgentResult> {
  const agentId = options.agentId ?? DEFAULT_AGENT_ID;
  const systemMessage = options.systemMessage ?? DEFAULT_SYSTEM_MESSAGE;

  const agents = fred.getAgents();
  if (agents.length > 0) {
    const defaultAgentId = fred.getDefaultAgentId();
    const selectedAgentId = defaultAgentId ?? agents[0].id;

    if (!defaultAgentId) {
      fred.setDefaultAgent(selectedAgentId);
    }

    const selectedAgent = fred.getAgent(selectedAgentId);
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
  await fred.registerDefaultProviders();
  await fred.useProvider(providerInfo.platform);
  await fred.createAgent({
    id: agentId,
    systemMessage,
    platform: providerInfo.platform,
    model: providerInfo.model,
    tools: ['calculator'],
  });
  fred.setDefaultAgent(agentId);

  return {
    provider: providerInfo.platform,
    model: providerInfo.model,
    agentId,
    created: true,
  };
}
