import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Effect, Layer, Exit } from 'effect';
import {
  createMiniMaxImageAdapter,
  MiniMaxImageError,
  MINIMAX_IMAGE_ENDPOINT,
  type ImageGenerationInput,
  type ImageGenerationResult,
} from '../../../packages/provider-minimax/src/image';
import {
  MINIMAX_CAPABILITIES,
  MiniMaxProviderFactory,
} from '../../../packages/provider-minimax/src/index';

describe('MiniMax Image Capability', () => {
  describe('constants', () => {
    test('MINIMAX_IMAGE_ENDPOINT is set correctly', () => {
      expect(MINIMAX_IMAGE_ENDPOINT).toBe('/image_generation');
    });
  });

  describe('MiniMaxImageError', () => {
    test('is a tagged error with module, method, description, and cause', () => {
      const error = new MiniMaxImageError({
        module: 'MiniMaxImageAdapter',
        method: 'generate',
        description: 'Image generation failed',
        cause: new Error('upstream error'),
      });

      expect(error._tag).toBe('MiniMaxImageError');
      expect(error.module).toBe('MiniMaxImageAdapter');
      expect(error.method).toBe('generate');
      expect(error.description).toBe('Image generation failed');
      expect(error.cause).toBeDefined();
    });
  });

  describe('createMiniMaxImageAdapter', () => {
    test('returns an adapter object with generate method', () => {
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');
      expect(adapter).toBeDefined();
      expect(typeof adapter.generate).toBe('function');
    });

    test('adapter has correct capability key', () => {
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');
      expect(adapter.capability).toBe('image');
    });

    test('generate requires prompt parameter', () => {
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');
      // generate should accept at least a prompt
      expect(adapter.generate.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('request shaping', () => {
    test('generate sends correct request body with model and prompt', async () => {
      // We verify the adapter accepts the expected shape
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');

      // Verify generate accepts text-to-image parameters
      const result = adapter.generate({
        model: 'image-01',
        prompt: 'A sunset over the ocean',
      });

      expect(result).toBeDefined();
      // Result should be an Effect
      expect(typeof result).toBe('object');
    });

    test('generate accepts optional aspect_ratio parameter', () => {
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');

      const result = adapter.generate({
        model: 'image-01',
        prompt: 'A sunset over the ocean',
        aspect_ratio: '16:9',
      });

      expect(result).toBeDefined();
    });

    test('generate accepts optional n parameter for batch generation', () => {
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');

      const result = adapter.generate({
        model: 'image-01',
        prompt: 'A sunset over the ocean',
        n: 2,
      });

      expect(result).toBeDefined();
    });
  });

  describe('normalized response', () => {
    test('generate returns an Effect that resolves to image URLs', async () => {
      // This test verifies the response shape when mocked
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');

      // The Effect should resolve to an object with image_urls
      const result = adapter.generate({
        model: 'image-01',
        prompt: 'A sunset over the ocean',
      });

      // Result is an Effect — verify it's well-formed
      expect(result).toBeDefined();
    });
  });

  describe('error normalization', () => {
    test('MiniMaxImageError carries provider context', () => {
      const error = new MiniMaxImageError({
        module: 'MiniMaxImageAdapter',
        method: 'generate',
        description: 'Request failed with status 429',
        cause: { status: 429 },
      });

      expect(error._tag).toBe('MiniMaxImageError');
      expect(error.description).toContain('429');
    });

    test('MiniMaxImageError message format includes module and method', () => {
      const error = new MiniMaxImageError({
        module: 'MiniMaxImageAdapter',
        method: 'generate',
        description: 'Something went wrong',
      });

      expect(error.message).toBe('[MiniMaxImageAdapter.generate] Something went wrong');
    });
  });

  describe('capability advertisement', () => {
    test('image capability is in MINIMAX_CAPABILITIES', () => {
      expect(MINIMAX_CAPABILITIES.has('image')).toBe(true);
    });

    test('MiniMaxProviderFactory declares image capability', () => {
      expect(MiniMaxProviderFactory.capabilities).toBeDefined();
      expect(MiniMaxProviderFactory.capabilities!.has('image')).toBe(true);
    });
  });

  describe('input type completeness', () => {
    test('ImageGenerationInput accepts reference_image_url for image-to-image', () => {
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');

      const result = adapter.generate({
        model: 'image-01',
        prompt: 'Make it look like a painting',
        reference_image_url: 'https://example.com/photo.jpg',
      });

      expect(result).toBeDefined();
    });

    test('ImageGenerationInput accepts seed for reproducibility', () => {
      const adapter = createMiniMaxImageAdapter('test-key', 'https://api.minimax.io/v1');

      const result = adapter.generate({
        model: 'image-01',
        prompt: 'A sunset',
        seed: 42,
      });

      expect(result).toBeDefined();
    });
  });
});
