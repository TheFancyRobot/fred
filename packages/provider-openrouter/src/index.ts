import { Data, Effect } from 'effect';
import { providerApiKey, registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';

export * from './oauth';

export class OpenRouterLanguageModelUnavailableError extends Data.TaggedError(
  'OpenRouterLanguageModelUnavailableError'
)<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'OpenRouter LanguageModel not available in provider pack' });
  }
}

function getOpenRouterAttribution(config: ProviderConfig): {
  referrer?: string;
  title?: string;
} {
  return {
    referrer:
      (typeof config.headers?.['HTTP-Referer'] === 'string' ? config.headers['HTTP-Referer'] : undefined)
      ?? (typeof config.headers?.['http-referer'] === 'string' ? config.headers['http-referer'] : undefined)
      ?? (typeof config.headers?.['HTTP-Referrer'] === 'string' ? config.headers['HTTP-Referrer'] : undefined)
      ?? (typeof config.headers?.['http-referrer'] === 'string' ? config.headers['http-referrer'] : undefined),
    title:
      (typeof config.headers?.['X-Title'] === 'string' ? config.headers['X-Title'] : undefined)
      ?? (typeof config.headers?.['x-title'] === 'string' ? config.headers['x-title'] : undefined),
  };
}

export const OpenRouterProviderFactory: EffectProviderFactory = {
  id: 'openrouter',
  aliases: ['openrouter'],
  connectionCapabilities: {
    providerId: 'openrouter',
    auth: ['api-key'],
    login: ['manual-secret', 'openrouter-pkce-api-key'],
  },
  load: async (config: ProviderConfig) => {
    let module: typeof import('@effect/ai-openrouter');
    try {
      module = await import('@effect/ai-openrouter');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-openrouter. Install it with: bun add @effect/ai-openrouter`
      );
    }

    const apiKey = providerApiKey(config.credentials);
    const apiUrl = config.baseUrl ?? 'https://openrouter.ai/api/v1';
    const { referrer, title } = getOpenRouterAttribution(config);

    const layer = module.OpenRouterClient?.layer?.({
      apiKey,
      apiUrl,
      referrer,
      title,
    });

    if (!layer) {
      throw new Error('OpenRouter provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.OpenRouterLanguageModel?.model) {
          return Effect.fail(new OpenRouterLanguageModelUnavailableError());
        }
        return Effect.succeed(
          module.OpenRouterLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            max_tokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

registerBuiltinPack(OpenRouterProviderFactory);

export { OpenRouterProviderFactory as openrouterPack };
export default OpenRouterProviderFactory;
