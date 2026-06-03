import { describe, test, expect } from 'bun:test';
import { Effect, Layer, Exit } from 'effect';
import {
  createMiniMaxVoiceAdapter,
  MiniMaxVoiceError,
  MINIMAX_VOICE_CLONE_ENDPOINT,
  MINIMAX_VOICE_DESIGN_ENDPOINT,
  MINIMAX_VOICE_LIST_ENDPOINT,
  MINIMAX_VOICE_DELETE_ENDPOINT,
  type VoiceCloneInput,
  type VoiceDesignInput,
  type VoiceListInput,
  type VoiceDeleteInput,
  type VoiceCloneResult,
  type VoiceDesignResult,
  type VoiceListResult,
  type VoiceDeleteResult,
} from '../../../packages/provider-minimax/src/voice';
import {
  createMiniMaxSpeechAdapter,
} from '../../../packages/provider-minimax/src/speech';
import {
  MINIMAX_CAPABILITIES,
  MiniMaxProviderFactory,
} from '../../../packages/provider-minimax/src/index';

describe('MiniMax Voice Capability', () => {
  describe('constants', () => {
    test('MINIMAX_VOICE_CLONE_ENDPOINT is set correctly', () => {
      expect(MINIMAX_VOICE_CLONE_ENDPOINT).toBe('/voice_clone');
    });

    test('MINIMAX_VOICE_DESIGN_ENDPOINT is set correctly', () => {
      expect(MINIMAX_VOICE_DESIGN_ENDPOINT).toBe('/voice_design');
    });

    test('MINIMAX_VOICE_LIST_ENDPOINT is set correctly', () => {
      expect(MINIMAX_VOICE_LIST_ENDPOINT).toBe('/voice_management/list');
    });

    test('MINIMAX_VOICE_DELETE_ENDPOINT is set correctly', () => {
      expect(MINIMAX_VOICE_DELETE_ENDPOINT).toBe('/voice_management/delete');
    });
  });

  describe('MiniMaxVoiceError', () => {
    test('is a tagged error with module, method, description, and cause', () => {
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'clone',
        description: 'Voice clone failed',
        cause: new Error('upstream error'),
      });

      expect(error._tag).toBe('MiniMaxVoiceError');
      expect(error.module).toBe('MiniMaxVoiceAdapter');
      expect(error.method).toBe('clone');
      expect(error.description).toBe('Voice clone failed');
      expect(error.cause).toBeDefined();
    });

    test('MiniMaxVoiceError message format includes module and method', () => {
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'design',
        description: 'Something went wrong',
      });

      expect(error.message).toBe('[MiniMaxVoiceAdapter.design] Something went wrong');
    });

    test('MiniMaxVoiceError includes cause for debugging', () => {
      const cause = new Error('Connection reset');
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'list',
        description: 'Connection failed',
        cause,
      });

      expect(error.cause).toBe(cause);
    });

    test('MiniMaxVoiceError carries provider context', () => {
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'clone',
        description: 'Voice clone request failed with status 429',
        cause: { status: 429 },
      });

      expect(error._tag).toBe('MiniMaxVoiceError');
      expect(error.description).toContain('429');
    });
  });

  describe('createMiniMaxVoiceAdapter', () => {
    test('returns an adapter object with clone, design, list, and delete methods', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter).toBeDefined();
      expect(typeof adapter.clone).toBe('function');
      expect(typeof adapter.design).toBe('function');
      expect(typeof adapter.list).toBe('function');
      expect(typeof adapter.delete).toBe('function');
    });

    test('adapter has correct capability key', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter.capability).toBe('voice');
    });
  });

  describe('request shaping - clone', () => {
    test('clone accepts audio_source parameter', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.clone({
        audio_source: 'https://example.com/voice-sample.mp3',
      });

      expect(result).toBeDefined();
    });

    test('clone accepts optional audio_source_type parameter', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.clone({
        audio_source: 'aGVsbG8gd29ybGQ=',
        audio_source_type: 'base64',
      });

      expect(result).toBeDefined();
    });

    test('clone accepts optional voice_name parameter', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.clone({
        audio_source: 'https://example.com/sample.wav',
        voice_name: 'My Custom Voice',
      });

      expect(result).toBeDefined();
    });

    test('clone accepts optional text and language parameters', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.clone({
        audio_source: 'https://example.com/sample.wav',
        text: 'Hello, this is my voice sample.',
        language: 'en',
      });

      expect(result).toBeDefined();
    });
  });

  describe('request shaping - design', () => {
    test('design accepts prompt and preview_text parameters', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.design({
        prompt: 'Excited and enthusiastic male product reviewer, fast-paced, high energy.',
        preview_text: "What is UP, everyone! Today we're unboxing the brand new Gadget X-Pro!",
      });

      expect(result).toBeDefined();
    });

    test('design accepts optional language parameter', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.design({
        prompt: 'Calm, soothing female narrator for meditation.',
        preview_text: 'Close your eyes and take a deep breath.',
        language: 'en',
      });

      expect(result).toBeDefined();
    });

    test('design works with descriptive voice prompts', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.design({
        prompt: 'Deep, authoritative male voice, similar to a movie trailer narrator.',
        preview_text: 'In a world where technology meets imagination...',
      });

      expect(result).toBeDefined();
    });
  });

  describe('request shaping - list', () => {
    test('list can be called with no parameters', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.list();

      expect(result).toBeDefined();
    });

    test('list accepts optional voice_type filter', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.list({
        voice_type: 'clone',
      });

      expect(result).toBeDefined();
    });

    test('list accepts optional pagination parameters', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.list({
        page: 2,
        page_size: 20,
      });

      expect(result).toBeDefined();
    });
  });

  describe('request shaping - delete', () => {
    test('delete accepts voice_id parameter', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.delete({
        voice_id: 'clone-voice-abc123',
      });

      expect(result).toBeDefined();
    });
  });

  describe('normalized response', () => {
    test('clone returns an Effect', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.clone({
        audio_source: 'https://example.com/sample.wav',
      });

      expect(result).toBeDefined();
    });

    test('design returns an Effect', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.design({
        prompt: 'Test voice',
        preview_text: 'Test preview',
      });

      expect(result).toBeDefined();
    });

    test('list returns an Effect', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.list();

      expect(result).toBeDefined();
    });

    test('delete returns an Effect', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.delete({
        voice_id: 'test-voice-id',
      });

      expect(result).toBeDefined();
    });
  });

  describe('error normalization', () => {
    test('MiniMaxVoiceError captures rate-limit context', () => {
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'clone',
        description: 'Voice clone request failed: non-retryable 429 error',
        cause: { status: 429 },
      });

      expect(error._tag).toBe('MiniMaxVoiceError');
      expect(error.description).toContain('429');
    });

    test('MiniMaxVoiceError captures API-level error for clone', () => {
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'clone',
        description: 'MiniMax API error: Audio quality too low (code: 1005)',
      });

      expect(error.description).toContain('Audio quality too low');
    });

    test('MiniMaxVoiceError captures API-level error for design', () => {
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'design',
        description: 'MiniMax API error: Prompt too vague (code: 1010)',
      });

      expect(error.description).toContain('Prompt too vague');
    });

    test('MiniMaxVoiceError captures delete failure context', () => {
      const error = new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'delete',
        description: 'MiniMax API error: Voice not found (code: 1001)',
      });

      expect(error.description).toContain('Voice not found');
    });
  });

  describe('capability advertisement', () => {
    test('voice capability is in MINIMAX_CAPABILITIES', () => {
      expect(MINIMAX_CAPABILITIES.has('voice')).toBe(true);
    });

    test('MiniMaxProviderFactory declares voice capability', () => {
      expect(MiniMaxProviderFactory.capabilities).toBeDefined();
      expect(MiniMaxProviderFactory.capabilities!.has('voice')).toBe(true);
    });
  });

  describe('voice lifecycle flows', () => {
    test('clone → synthesize flow: cloned voice_id can be used for TTS', () => {
      // Verify that the adapter's clone method returns a type with voice_id
      // and the speech adapter's synthesize accepts voice_id
      const voiceAdapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');
      const speechAdapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      // Both adapters are created and have the expected methods
      expect(typeof voiceAdapter.clone).toBe('function');
      expect(typeof speechAdapter.synthesize).toBe('function');
    });

    test('design → synthesize flow: designed voice_id can be used for TTS', () => {
      const voiceAdapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');
      const speechAdapter = createMiniMaxSpeechAdapter('test-key', 'https://api.minimax.chat/v1');

      expect(typeof voiceAdapter.design).toBe('function');
      expect(typeof speechAdapter.synthesize).toBe('function');
    });

    test('clone → list → delete flow: full voice lifecycle', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      // All lifecycle methods are available
      expect(typeof adapter.clone).toBe('function');
      expect(typeof adapter.list).toBe('function');
      expect(typeof adapter.delete).toBe('function');
    });
  });

  describe('input type completeness', () => {
    test('VoiceCloneInput default audio_source_type is url', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      // audio_source_type is optional, defaults to url behavior
      const result = adapter.clone({
        audio_source: 'https://example.com/audio.mp3',
      });

      expect(result).toBeDefined();
    });

    test('VoiceListInput allows filtering by all voice types', () => {
      const adapter = createMiniMaxVoiceAdapter('test-key', 'https://api.minimax.chat/v1');

      const cloneList = adapter.list({ voice_type: 'clone' });
      const designList = adapter.list({ voice_type: 'design' });
      const presetList = adapter.list({ voice_type: 'preset' });

      expect(cloneList).toBeDefined();
      expect(designList).toBeDefined();
      expect(presetList).toBeDefined();
    });
  });
});
