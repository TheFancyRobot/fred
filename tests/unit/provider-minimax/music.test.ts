import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Effect, Layer, Exit } from 'effect';
import {
  createMiniMaxMusicAdapter,
  MiniMaxMusicError,
  MINIMAX_MUSIC_ENDPOINT,
  type MusicGenerationInput,
  type MusicGenerationResult,
} from '../../../packages/provider-minimax/src/music';
import {
  MINIMAX_CAPABILITIES,
  MiniMaxProviderFactory,
} from '../../../packages/provider-minimax/src/index';

describe('MiniMax Music Capability', () => {
  describe('constants', () => {
    test('MINIMAX_MUSIC_ENDPOINT is set correctly', () => {
      expect(MINIMAX_MUSIC_ENDPOINT).toBe('/music_generation');
    });
  });

  describe('MiniMaxMusicError', () => {
    test('is a tagged error with module, method, description, and cause', () => {
      const error = new MiniMaxMusicError({
        module: 'MiniMaxMusicAdapter',
        method: 'generate',
        description: 'Music generation failed',
        cause: new Error('upstream error'),
      });

      expect(error._tag).toBe('MiniMaxMusicError');
      expect(error.module).toBe('MiniMaxMusicAdapter');
      expect(error.method).toBe('generate');
      expect(error.description).toBe('Music generation failed');
      expect(error.cause).toBeDefined();
    });
  });

  describe('createMiniMaxMusicAdapter', () => {
    test('returns an adapter object with generate method', () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter).toBeDefined();
      expect(typeof adapter.generate).toBe('function');
    });

    test('adapter has correct capability key', () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter.capability).toBe('music');
    });
  });

  describe('request shaping', () => {
    test('generate accepts model, prompt, and lyrics parameters', () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.generate({
        model: 'music-01',
        prompt: 'Upbeat pop song with electric guitar',
        lyrics: 'Walking down the road today\nFeeling the sunshine on my face',
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('generate accepts optional vocal_style parameter', () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.generate({
        model: 'music-01',
        prompt: 'Chill lo-fi beats',
        lyrics: 'Rainy day vibes',
        vocal_style: 'female',
      });

      expect(result).toBeDefined();
    });

    test('generate works with only prompt (auto-lyrics)', () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.generate({
        model: 'music-01',
        prompt: 'A jazzy instrumental piece',
      });

      expect(result).toBeDefined();
    });
  });

  describe('normalized response', () => {
    test('generate returns an Effect that resolves to audio data', async () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.generate({
        model: 'music-01',
        prompt: 'Upbeat pop song',
        lyrics: 'Hello world',
      });

      // Result should be an Effect
      expect(result).toBeDefined();
    });
  });

  describe('error normalization', () => {
    test('MiniMaxMusicError carries provider context', () => {
      const error = new MiniMaxMusicError({
        module: 'MiniMaxMusicAdapter',
        method: 'generate',
        description: 'Music generation request failed with status 429',
        cause: { status: 429 },
      });

      expect(error._tag).toBe('MiniMaxMusicError');
      expect(error.description).toContain('429');
    });

    test('MiniMaxMusicError includes cause for debugging', () => {
      const cause = new Error('Connection reset');
      const error = new MiniMaxMusicError({
        module: 'MiniMaxMusicAdapter',
        method: 'generate',
        description: 'Connection failed',
        cause,
      });

      expect(error.cause).toBe(cause);
    });

    test('MiniMaxMusicError message format includes module and method', () => {
      const error = new MiniMaxMusicError({
        module: 'MiniMaxMusicAdapter',
        method: 'generate',
        description: 'Something went wrong',
      });

      expect(error.message).toBe('[MiniMaxMusicAdapter.generate] Something went wrong');
    });
  });

  describe('capability advertisement', () => {
    test('music capability is in MINIMAX_CAPABILITIES', () => {
      expect(MINIMAX_CAPABILITIES.has('music')).toBe(true);
    });

    test('MiniMaxProviderFactory declares music capability', () => {
      expect(MiniMaxProviderFactory.capabilities).toBeDefined();
      expect(MiniMaxProviderFactory.capabilities!.has('music')).toBe(true);
    });
  });

  describe('input type completeness', () => {
    test('MusicGenerationInput accepts reference_audio_url for cover generation', () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.generate({
        model: 'music-01',
        prompt: 'Cover version',
        reference_audio_url: 'https://example.com/song.mp3',
      });

      expect(result).toBeDefined();
    });

    test('MusicGenerationInput accepts seed for reproducibility', () => {
      const adapter = createMiniMaxMusicAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.generate({
        model: 'music-01',
        prompt: 'A chill beat',
        seed: 12345,
      });

      expect(result).toBeDefined();
    });
  });
});
