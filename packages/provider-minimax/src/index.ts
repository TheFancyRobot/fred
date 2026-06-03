import { Effect, Layer, Redacted } from 'effect';
import { registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';

/**
 * MiniMax provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. MiniMax supports language, image, video,
 * speech, voice, and music capabilities.
 *
 * Multi-modality capabilities (image, video, speech, voice, music) are
 * implemented in dedicated adapter modules loaded by subsequent steps.
 */
export const MiniMaxProviderFactory: EffectProviderFactory = {
  id: 'minimax',
  aliases: ['minimax'],
  load: async (config: ProviderConfig) => {
    const apiKeyEnvVar = config.apiKeyEnvVar ?? 'MINIMAX_API_KEY';
    const apiKeyString = process.env[apiKeyEnvVar];
    const apiKey = apiKeyString ? Redacted.make(apiKeyString) : undefined;
    const baseUrl = config.baseUrl ?? 'https://api.minimax.chat/v1';

    if (!apiKey) {
      throw new Error(
        `MiniMax API key not found. Set ${apiKeyEnvVar} environment variable.`
      );
    }

    // Placeholder layer — will be replaced by proper HttpClient layer
    // when modality adapters are implemented in subsequent steps.
    // Using Layer.empty as any to satisfy the EffectProviderFactory contract
    // which expects Layer<any, any, any>.
    const layer = Layer.empty as any;

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        // Language model support will be implemented in Step 05.
        // For now, return a clear failure so callers know the provider
        // is registered but language is not yet wired.
        return Effect.fail(
          new Error(
            `MiniMax language model "${modelId}" is not yet implemented. ` +
              `Language capability will be added in a subsequent step.`
          )
        );
      },
    };
  },
};

// Auto-register when imported
registerBuiltinPack(MiniMaxProviderFactory);

export { MiniMaxProviderFactory as minimaxPack };
export default MiniMaxProviderFactory;
