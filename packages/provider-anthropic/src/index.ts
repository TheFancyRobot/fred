import { Data, Effect } from 'effect';
import { providerApiKey, providerAuthTransform, registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';

/**
 * Anthropic provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. Uses dynamic import to avoid hard dependency.
 */
export class AnthropicLanguageModelUnavailableError extends Data.TaggedError(
  'AnthropicLanguageModelUnavailableError'
)<{
  readonly message: string;
}> {
  constructor() {
    super({ message: 'Anthropic LanguageModel not available in provider pack' });
  }
}

export const AnthropicProviderFactory: EffectProviderFactory = {
  id: 'anthropic',
  aliases: ['anthropic'],
  connectionCapabilities: {
    providerId: 'anthropic',
    auth: ['api-key'],
    login: ['manual-secret'],
    protocols: ['anthropic-compatible'],
  },
  load: async (config: ProviderConfig) => {
    // Dynamic import to avoid hard dependency
    let module: typeof import('@effect/ai-anthropic');
    try {
      module = await import('@effect/ai-anthropic');
    } catch (error) {
      throw new Error(
        `Failed to load @effect/ai-anthropic. Install it with: bun add @effect/ai-anthropic`
      );
    }

    const apiKey = providerApiKey(config.credentials);

    // Use AnthropicClient.layer for client initialization
    const layer = module.AnthropicClient?.layer?.({
      apiKey,
      apiUrl: config.baseUrl,
      transformClient: providerAuthTransform(config.credentials),
    });

    if (!layer) {
      throw new Error('Anthropic provider pack did not expose a client layer');
    }

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        if (!module.AnthropicLanguageModel?.model) {
          return Effect.fail(new AnthropicLanguageModelUnavailableError());
        }
        return Effect.succeed(
          module.AnthropicLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            max_tokens: overrides?.maxTokens,
          })
        );
      },
    };
  },
};

// Auto-register when imported
registerBuiltinPack(AnthropicProviderFactory);

export { AnthropicProviderFactory as anthropicPack };
export default AnthropicProviderFactory;
