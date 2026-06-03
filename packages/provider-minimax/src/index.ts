import { Effect, Layer, Redacted } from 'effect';
import { registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';
import {
  MiniMaxProviderFactory as LanguageFactory,
  MINIMAX_CAPABILITIES,
  MINIMAX_DEFAULT_BASE_URL,
} from './language';

// Re-export language capability public API
export {
  createMiniMaxLanguageModel,
  MiniMaxMissingApiKeyError,
  MiniMaxLanguageModelError,
  MINIMAX_DEFAULT_BASE_URL,
  MINIMAX_CAPABILITIES,
} from './language';

/**
 * MiniMax provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. MiniMax supports language, image, video,
 * speech, voice, and music capabilities.
 *
 * Language capability is implemented via MiniMax's OpenAI-compatible
 * Chat Completions API (see `./language.ts`).
 *
 * Multi-modality capabilities (image, video, speech, voice, music) are
 * implemented in dedicated adapter modules loaded by subsequent steps.
 */
export const MiniMaxProviderFactory: EffectProviderFactory = {
  id: 'minimax',
  aliases: ['minimax'],
  load: async (config: ProviderConfig) => {
    // Delegate to the language adapter which handles config and errors
    return LanguageFactory.load(config);
  },
};

// Auto-register when imported
registerBuiltinPack(MiniMaxProviderFactory);

export { MiniMaxProviderFactory as minimaxPack };
export default MiniMaxProviderFactory;
