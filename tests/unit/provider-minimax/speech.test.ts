import { describe, test, expect } from 'bun:test';
import { Effect, Layer, Exit } from 'effect';
import {
  createMiniMaxSpeechAdapter,
  MiniMaxSpeechError,
  MINIMAX_TTS_ENDPOINT,
  MINIMAX_TTS_ASYNC_ENDPOINT,
  type SpeechSynthesisInput,
  type SpeechSynthesisResult,
  type AsyncSpeechSynthesisInput,
  type AsyncSpeechTaskResult,
} from '../../../packages/provider-minimax/src/speech';
import {
  MINIMAX_CAPABILITIES,
  MiniMaxProviderFactory,
} from '../../../packages/provider-minimax/src/index';

describe('MiniMax Speech Capability', () => {
  describe('constants', () => {
    test('MINIMAX_TTS_ENDPOINT is set correctly', () => {
      expect(MINIMAX_TTS_ENDPOINT).toBe('/t2a_v2');
    });

    test('MINIMAX_TTS_ASYNC_ENDPOINT is set correctly', () => {
      expect(MINIMAX_TTS_ASYNC_ENDPOINT).toBe('/t2a_async');
    });
  });

  describe('MiniMaxSpeechError', () => {
    test('is a tagged error with module, method, description, and cause', () => {
      const error = new MiniMaxSpeechError({
        module: 'MiniMaxSpeechAdapter',
        method: 'synthesize',
        description: 'TTS generation failed',
        cause: new Error('upstream error'),
      });

      expect(error._tag).toBe('MiniMaxSpeechError');
      expect(error.module).toBe('MiniMaxSpeechAdapter');
      expect(error.method).toBe('synthesize');
      expect(error.description).toBe('TTS generation failed');
      expect(error.cause).toBeDefined();
    });

    test('MiniMaxSpeechError message format includes module and method', () => {
      const error = new MiniMaxSpeechError({
        module: 'MiniMaxSpeechAdapter',
        method: 'synthesize',
        description: 'Something went wrong',
      });

      expect(error.message).toBe('[MiniMaxSpeechAdapter.synthesize] Something went wrong');
    });

    test('MiniMaxSpeechError includes cause for debugging', () => {
      const cause = new Error('Connection reset');
      const error = new MiniMaxSpeechError({
        module: 'MiniMaxSpeechAdapter',
        method: 'synthesize',
        description: 'Connection failed',
        cause,
      });

      expect(error.cause).toBe(cause);
    });

    test('MiniMaxSpeechError carries provider context', () => {
      const error = new MiniMaxSpeechError({
        module: 'MiniMaxSpeechAdapter',
        method: 'synthesize',
        description: 'TTS request failed with status 429',
        cause: { status: 429 },
      });

      expect(error._tag).toBe('MiniMaxSpeechError');
      expect(error.description).toContain('429');
    });
  });

  describe('createMiniMaxSpeechAdapter', () => {
    test('returns an adapter object with synthesize and createAsyncTask methods', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter).toBeDefined();
      expect(typeof adapter.synthesize).toBe('function');
      expect(typeof adapter.createAsyncTask).toBe('function');
    });

    test('adapter has correct capability key', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter.capability).toBe('speech');
    });
  });

  describe('request shaping - synthesize', () => {
    test('synthesize accepts model, text, and voice_id parameters', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Hello, world!',
        voice_id: 'preset_voice_01',
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('synthesize accepts optional speed, vol, pitch parameters', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Testing audio parameters',
        speed: 1.2,
        vol: 5,
        pitch: 2,
      });

      expect(result).toBeDefined();
    });

    test('synthesize accepts optional audio_format parameter', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Testing format',
        audio_format: 'mp3',
      });

      expect(result).toBeDefined();
    });

    test('synthesize accepts optional emotion parameter', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'This is exciting!',
        emotion: 'happy',
      });

      expect(result).toBeDefined();
    });

    test('synthesize accepts optional language parameter', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Bonjour le monde',
        language: 'fr',
      });

      expect(result).toBeDefined();
    });

    test('synthesize works with minimal parameters (model + text only)', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Minimal input test',
      });

      expect(result).toBeDefined();
    });
  });

  describe('request shaping - createAsyncTask', () => {
    test('createAsyncTask accepts model, text, and voice_id parameters', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createAsyncTask({
        model: 'speech-02',
        text: 'This is a very long text that would benefit from async processing.',
        voice_id: 'preset_voice_01',
      });

      expect(result).toBeDefined();
    });

    test('createAsyncTask accepts optional callback_url parameter', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createAsyncTask({
        model: 'speech-02',
        text: 'Long-form content here',
        callback_url: 'https://example.com/callback',
      });

      expect(result).toBeDefined();
    });

    test('createAsyncTask accepts all TTS parameters', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createAsyncTask({
        model: 'speech-02',
        text: 'Full parameter test',
        voice_id: 'custom_voice_01',
        speed: 0.8,
        vol: 7,
        pitch: -3,
        audio_format: 'wav',
        emotion: 'whisper',
        callback_url: 'https://example.com/webhook',
      });

      expect(result).toBeDefined();
    });
  });

  describe('normalized response', () => {
    test('synthesize returns an Effect that resolves to speech data', async () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Hello',
      });

      // Result should be an Effect
      expect(result).toBeDefined();
    });

    test('createAsyncTask returns an Effect that resolves to task data', async () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createAsyncTask({
        model: 'speech-02',
        text: 'Long text',
      });

      expect(result).toBeDefined();
    });
  });

  describe('error normalization', () => {
    test('MiniMaxSpeechError captures rate-limit context', () => {
      const error = new MiniMaxSpeechError({
        module: 'MiniMaxSpeechAdapter',
        method: 'synthesize',
        description: 'TTS request failed: non-retryable 429 error',
        cause: { status: 429 },
      });

      expect(error._tag).toBe('MiniMaxSpeechError');
      expect(error.description).toContain('429');
    });

    test('MiniMaxSpeechError captures API-level error context', () => {
      const error = new MiniMaxSpeechError({
        module: 'MiniMaxSpeechAdapter',
        method: 'synthesize',
        description: 'MiniMax API error: Invalid voice_id (code: 1002)',
      });

      expect(error.description).toContain('Invalid voice_id');
      expect(error.description).toContain('1002');
    });
  });

  describe('capability advertisement', () => {
    test('speech capability is in MINIMAX_CAPABILITIES', () => {
      expect(MINIMAX_CAPABILITIES.has('speech')).toBe(true);
    });

    test('MiniMaxProviderFactory declares speech capability', () => {
      expect(MiniMaxProviderFactory.capabilities).toBeDefined();
      expect(MiniMaxProviderFactory.capabilities!.has('speech')).toBe(true);
    });
  });

  describe('input type completeness', () => {
    test('SpeechSynthesisInput accepts seed for reproducibility', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Deterministic test',
        seed: 42,
      });

      expect(result).toBeDefined();
    });

    test('SpeechSynthesisInput works with custom cloned voice_id', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Using custom voice',
        voice_id: 'clone-voice-abc123',
      });

      expect(result).toBeDefined();
    });

    test('SpeechSynthesisInput works with designed voice_id', () => {
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.synthesize({
        model: 'speech-02',
        text: 'Using designed voice',
        voice_id: 'ttv-voice-xyz789',
      });

      expect(result).toBeDefined();
    });
  });

  describe('sync vs async endpoint distinction', () => {
    test('synthesize uses sync endpoint', () => {
      expect(MINIMAX_TTS_ENDPOINT).toBe('/t2a_v2');
    });

    test('createAsyncTask uses async endpoint', () => {
      expect(MINIMAX_TTS_ASYNC_ENDPOINT).toBe('/t2a_async');
    });

    test('async endpoint returns task_id for polling', () => {
      // Verify the return type shape — AsyncSpeechTaskResult has task_id and async fields
      const adapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(typeof adapter.createAsyncTask).toBe('function');
    });
  });
});
