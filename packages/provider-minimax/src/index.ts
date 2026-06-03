import { Effect, Layer, Redacted } from 'effect';
import { registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults, ProviderCapabilityKey } from '@fancyrobot/fred';
import {
  MiniMaxProviderFactory as LanguageFactory,
  MINIMAX_CAPABILITIES as LANGUAGE_CAPABILITIES,
  MINIMAX_DEFAULT_BASE_URL,
} from './language';
import {
  createMiniMaxImageAdapter,
  MiniMaxImageError,
  MINIMAX_IMAGE_ENDPOINT,
} from './image';
import {
  createMiniMaxVideoAdapter,
  MiniMaxVideoError,
  MINIMAX_VIDEO_GENERATION_ENDPOINT,
  MINIMAX_VIDEO_QUERY_ENDPOINT,
} from './video';
import {
  createMiniMaxMusicAdapter,
  MiniMaxMusicError,
  MINIMAX_MUSIC_ENDPOINT,
} from './music';

// Re-export language capability public API
export {
  createMiniMaxLanguageModel,
  MiniMaxMissingApiKeyError,
  MiniMaxLanguageModelError,
  MINIMAX_DEFAULT_BASE_URL,
} from './language';

// Re-export image capability public API
export {
  createMiniMaxImageAdapter,
  MiniMaxImageError,
  MINIMAX_IMAGE_ENDPOINT,
} from './image';

// Re-export video capability public API
export {
  createMiniMaxVideoAdapter,
  MiniMaxVideoError,
  MINIMAX_VIDEO_GENERATION_ENDPOINT,
  MINIMAX_VIDEO_QUERY_ENDPOINT,
} from './video';

// Re-export music capability public API
export {
  createMiniMaxMusicAdapter,
  MiniMaxMusicError,
  MINIMAX_MUSIC_ENDPOINT,
} from './music';

/**
 * Combined capability set for the MiniMax provider.
 * Includes language (from Step 05), image, video, and music.
 * Speech and voice will be added in Step 07.
 */
export const MINIMAX_CAPABILITIES = new Set<ProviderCapabilityKey>([
  ...LANGUAGE_CAPABILITIES,
  'image',
  'video',
  'music',
]);

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
  capabilities: MINIMAX_CAPABILITIES,
  load: async (config: ProviderConfig) => {
    // Delegate to the language adapter which handles config and errors
    return LanguageFactory.load(config);
  },
};

// Auto-register when imported
registerBuiltinPack(MiniMaxProviderFactory);

export { MiniMaxProviderFactory as minimaxPack };
export default MiniMaxProviderFactory;
