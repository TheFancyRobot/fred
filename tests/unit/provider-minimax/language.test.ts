import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Effect, Layer, Redacted, Exit } from 'effect';
import * as AiModel from '@effect/ai/Model';
import * as LanguageModel from '@effect/ai/LanguageModel';
import {
  MiniMaxProviderFactory,
  MiniMaxMissingApiKeyError,
  MiniMaxLanguageModelError,
  createMiniMaxLanguageModel,
  MINIMAX_DEFAULT_BASE_URL,
  MINIMAX_CAPABILITIES,
} from '../../../packages/provider-minimax/src/language';
import type { ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';

describe('MiniMax Language Capability', () => {
  describe('MiniMaxProviderFactory', () => {
    test('has correct id', () => {
      expect(MiniMaxProviderFactory.id).toBe('minimax');
    });

    test('has correct aliases', () => {
      expect(MiniMaxProviderFactory.aliases).toEqual(['minimax']);
    });

    test('has load method', () => {
      expect(typeof MiniMaxProviderFactory.load).toBe('function');
    });

    test('load is async', () => {
      const result = MiniMaxProviderFactory.load({});
      expect(result).toBeInstanceOf(Promise);
      result.catch(() => {});
    });
  });

  describe('configuration', () => {
    test('MINIMAX_DEFAULT_BASE_URL is set to MiniMax API v1 endpoint', () => {
      expect(MINIMAX_DEFAULT_BASE_URL).toBe('https://api.minimax.io/v1');
    });

    test('MINIMAX_CAPABILITIES includes language', () => {
      expect(MINIMAX_CAPABILITIES.has('language')).toBe(true);
    });

    test('loads successfully with MINIMAX_API_KEY env var', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const result = await MiniMaxProviderFactory.load({});
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
        expect(typeof result.getModel).toBe('function');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });

    test('throws MiniMaxMissingApiKeyError when API key is missing', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_API_KEY;

      try {
        await MiniMaxProviderFactory.load({});
        // Should not reach here
        expect(true).toBe(false);
      } catch (error) {
        expect(error).toBeInstanceOf(MiniMaxMissingApiKeyError);
        expect((error as MiniMaxMissingApiKeyError).message).toContain('MINIMAX_API_KEY');
      } finally {
        if (originalEnv !== undefined) {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });

    test('throws MiniMaxMissingApiKeyError when API key is blank', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = '   ';

      try {
        await expect(MiniMaxProviderFactory.load({})).rejects.toBeInstanceOf(
          MiniMaxMissingApiKeyError
        );
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom apiKeyEnvVar', async () => {
      const originalEnv = process.env.CUSTOM_MINIMAX_KEY;
      process.env.CUSTOM_MINIMAX_KEY = 'custom-minimax-key';

      try {
        const result = await MiniMaxProviderFactory.load({
          apiKeyEnvVar: 'CUSTOM_MINIMAX_KEY',
        });
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CUSTOM_MINIMAX_KEY;
        } else {
          process.env.CUSTOM_MINIMAX_KEY = originalEnv;
        }
      }
    });

    test('respects custom baseUrl', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const result = await MiniMaxProviderFactory.load({
          baseUrl: 'https://custom.minimax.endpoint/v1',
        });
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom headers', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const result = await MiniMaxProviderFactory.load({
          headers: { 'X-Custom': 'value' },
        });
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });
  });

  describe('getModel', () => {
    test('returns an Effect that succeeds with an AiModel', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const result = await MiniMaxProviderFactory.load({});
        const modelEffect = result.getModel('MiniMax-Text-01');

        // The effect should be a valid Effect object
        expect(modelEffect).toBeDefined();
        expect(typeof modelEffect).toBe('object');

        // Verify it's an Effect by checking _tag
        const exit = await Effect.runPromiseExit(modelEffect.pipe(
          Effect.provide(result.layer)
        ));
        expect(exit._tag).toBe('Success');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });

    test('getModel passes temperature override', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const result = await MiniMaxProviderFactory.load({});
        const modelEffect = result.getModel('MiniMax-Text-01', {
          temperature: 0.5,
        });
        expect(modelEffect).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });

    test('getModel passes maxTokens override', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const result = await MiniMaxProviderFactory.load({});
        const modelEffect = result.getModel('MiniMax-Text-01', {
          maxTokens: 2048,
        });
        expect(modelEffect).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });
  });

  describe('createMiniMaxLanguageModel', () => {
    test('creates a model with provider name "minimax"', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const model = createMiniMaxLanguageModel(
          'test-key',
          MINIMAX_DEFAULT_BASE_URL,
          'MiniMax-Text-01'
        );
        // AiModel.make returns a model with a provider name
        expect(model).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });

    test('created model is a valid AiModel with provider name', async () => {
      const originalEnv = process.env.MINIMAX_API_KEY;
      process.env.MINIMAX_API_KEY = 'test-minimax-key';

      try {
        const model = createMiniMaxLanguageModel(
          'test-key',
          MINIMAX_DEFAULT_BASE_URL,
          'MiniMax-Text-01'
        );

        // AiModel.make returns an object with a `provider` property
        expect(model).toBeDefined();
        expect((model as any).provider).toBe('minimax');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.MINIMAX_API_KEY;
        } else {
          process.env.MINIMAX_API_KEY = originalEnv;
        }
      }
    });
  });

  describe('MiniMaxMissingApiKeyError', () => {
    test('is a tagged error with provider and envVar', () => {
      const error = new MiniMaxMissingApiKeyError({
        provider: 'minimax',
        envVar: 'MINIMAX_API_KEY',
      });

      expect(error._tag).toBe('MiniMaxMissingApiKeyError');
      expect(error.provider).toBe('minimax');
      expect(error.envVar).toBe('MINIMAX_API_KEY');
      expect(error.message).toContain('MINIMAX_API_KEY');
    });
  });

  describe('MiniMaxLanguageModelError', () => {
    test('is a tagged error with module, method, description, and cause', () => {
      const error = new MiniMaxLanguageModelError({
        module: 'MiniMaxLanguageModel',
        method: 'generateText',
        description: 'Failed to generate text',
        cause: new Error('upstream error'),
      });

      expect(error._tag).toBe('MiniMaxLanguageModelError');
      expect(error.module).toBe('MiniMaxLanguageModel');
      expect(error.method).toBe('generateText');
      expect(error.description).toBe('Failed to generate text');
      expect(error.cause).toBeDefined();
    });
  });
});
