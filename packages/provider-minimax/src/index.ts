import { Effect, Layer, Redacted } from 'effect';
import { registerBuiltinPack } from '@fancyrobot/fred';
import type { EffectProviderFactory, ProviderConfig, ProviderModelDefaults, ProviderCapabilityKey } from '@fancyrobot/fred';
import {
  MiniMaxProviderFactory as LanguageFactory,
  MINIMAX_CAPABILITIES as LANGUAGE_CAPABILITIES,
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
import {
  createMiniMaxSpeechAdapter,
  MiniMaxSpeechError,
  MINIMAX_TTS_ENDPOINT,
  MINIMAX_TTS_ASYNC_ENDPOINT,
} from './speech';
import {
  createMiniMaxVoiceAdapter,
  MiniMaxVoiceError,
  MINIMAX_VOICE_CLONE_ENDPOINT,
  MINIMAX_VOICE_DESIGN_ENDPOINT,
  MINIMAX_VOICE_LIST_ENDPOINT,
  MINIMAX_VOICE_DELETE_ENDPOINT,
} from './voice';
import {
  createMiniMaxLyricsAdapter,
  MiniMaxLyricsError,
  MINIMAX_LYRICS_ENDPOINT,
} from './lyrics';

// Re-export language capability public API
export {
  createMiniMaxLanguageModel,
  MiniMaxMissingApiKeyError,
  MiniMaxLanguageModelError,
} from './language';
export {
  MINIMAX_DEFAULT_BASE_URL,
  MINIMAX_NATIVE_BASE_URL,
} from './config';

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

// Re-export speech capability public API
export {
  createMiniMaxSpeechAdapter,
  MiniMaxSpeechError,
  MINIMAX_TTS_ENDPOINT,
  MINIMAX_TTS_ASYNC_ENDPOINT,
} from './speech';

// Re-export voice capability public API
export {
  createMiniMaxVoiceAdapter,
  MiniMaxVoiceError,
  MINIMAX_VOICE_CLONE_ENDPOINT,
  MINIMAX_VOICE_DESIGN_ENDPOINT,
  MINIMAX_VOICE_LIST_ENDPOINT,
  MINIMAX_VOICE_DELETE_ENDPOINT,
} from './voice';

// Re-export lyrics capability public API
export {
  createMiniMaxLyricsAdapter,
  MiniMaxLyricsError,
  MINIMAX_LYRICS_ENDPOINT,
} from './lyrics';

/**
 * Combined capability set for the MiniMax provider.
 * Includes language, image, video, music, speech, voice, and lyrics.
 */
export const MINIMAX_CAPABILITIES = new Set<ProviderCapabilityKey>([
  ...LANGUAGE_CAPABILITIES,
  'image',
  'video',
  'music',
  'speech',
  'voice',
  'lyrics',
]);

/**
 * MiniMax provider pack factory.
 *
 * Implements EffectProviderFactory interface for use as both built-in
 * and external pack pattern. MiniMax supports language, image, video,
 * speech, voice, music, and lyrics capabilities.
 *
 * Language capability is implemented via MiniMax's OpenAI-compatible
 * Chat Completions API (see `./language.ts`).
 *
 * Multi-modality capabilities (image, video, speech, voice, music, lyrics)
 * are implemented in dedicated adapter modules.
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
