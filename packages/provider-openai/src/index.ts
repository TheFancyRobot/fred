import { Data, Effect } from 'effect';
import {
  makeProviderConnectionTestHook,
  providerApiKey,
  providerAuthTransform,
  providerConnectionProbeAuthHeaders,
  providerConnectionProbeUrl,
  registerBuiltinPack,
} from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';

/**
 * OpenAI provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export class OpenAiLanguageModelUnavailableError extends Data.TaggedError(
  'OpenAiLanguageModelUnavailableError'
)<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'OpenAI LanguageModel not available in provider pack' });
  }
}

export const OpenAiProviderFactory: EffectProviderFactory = {
  id: 'openai',
  aliases: ['openai'],
  connectionCapabilities: {
    providerId: 'openai',
    auth: ['api-key'],
    login: ['manual-secret'],
    protocols: ['openai-compatible'],
  },
  connectionTest: makeProviderConnectionTestHook({
    providerId: 'openai',
    request: (draft, credentials) => ({
      url: providerConnectionProbeUrl(draft, 'https://api.openai.com/v1', 'models').toString(),
      init: { headers: providerConnectionProbeAuthHeaders(credentials) },
    }),
  }),
  load: async (config: ProviderConfig) => {
    if (config.connectionProtocol === 'openai-compatible') {
      let module: typeof import('@effect/ai-openrouter');
      try {
        module = await import('@effect/ai-openrouter');
      } catch {
        throw new Error(
          'Failed to load @effect/ai-openrouter. Install it with: bun add @effect/ai-openrouter'
        );
      }

      const layer = module.OpenRouterClient?.layer?.({
        apiKey: providerApiKey(config.credentials),
        apiUrl: config.baseUrl,
        transformClient: providerAuthTransform(config.credentials),
      });

      if (!layer) {
        throw new Error('OpenAI-compatible provider runtime did not expose a client layer');
      }

      return {
        layer,
        getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
          if (!module.OpenRouterLanguageModel?.model) {
            return Effect.fail(new OpenAiLanguageModelUnavailableError());
          }
          return Effect.succeed(
            module.OpenRouterLanguageModel.model(modelId, {
              temperature: overrides?.temperature,
              max_tokens: overrides?.maxTokens,
            })
          );
        },
      };
    }

    // Dynamic import to avoid hard dependency
    let module: typeof import('@effect/ai-openai');
    try {
      module = await import('@effect/ai-openai');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-openai. Install it with: bun add @effect/ai-openai`
      );
    }

    const apiKey = providerApiKey(config.credentials);

    // Use OpenAiClient.layer for client initialization
    const layer = module.OpenAiClient?.layer?.({
      apiKey,
      apiUrl: config.baseUrl,
      transformClient: providerAuthTransform(config.credentials),
    });

    if (!layer) {
      throw new Error('OpenAI provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.OpenAiLanguageModel?.model) {
          return Effect.fail(new OpenAiLanguageModelUnavailableError());
        }
        return Effect.succeed(
          module.OpenAiLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            max_output_tokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

// Auto-register when imported
registerBuiltinPack(OpenAiProviderFactory);

export { OpenAiProviderFactory as openaiPack };
export default OpenAiProviderFactory;
