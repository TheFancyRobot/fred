import { afterEach, describe, expect, mock, test } from 'bun:test';
import { Effect } from 'effect';
import { OpenRouterProviderFactory } from '../../../../../packages/provider-openrouter/src/index';

afterEach(() => {
  mock.restore();
});

describe('OpenRouterProviderFactory', () => {
  describe('static properties', () => {
    test('has correct id', () => {
      expect(OpenRouterProviderFactory.id).toBe('openrouter');
    });

    test('has correct aliases', () => {
      expect(OpenRouterProviderFactory.aliases).toEqual(['openrouter']);
    });
  });

  describe('configuration', () => {
    test('factory has load method', () => {
      expect(typeof OpenRouterProviderFactory.load).toBe('function');
    });

    test('load is async', () => {
      const result = OpenRouterProviderFactory.load({});
      expect(result).toBeInstanceOf(Promise);
      // Clean up the promise to avoid unhandled rejection
      result.catch(() => {});
    });
  });

  describe('integration with @effect/ai-openrouter', () => {
    // Integration tests require actual @effect/ai-openrouter module
    // These tests verify the factory can successfully load when the dependency is available

    test('loads successfully with default configuration', async () => {
      // Set up test environment variable
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({});

        // Verify the result has the expected structure
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
        expect(typeof result.getModel).toBe('function');
      } finally {
        // Restore original environment
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom apiKeyEnvVar', async () => {
      const originalEnv = process.env.CUSTOM_OPENROUTER_KEY;
      process.env.CUSTOM_OPENROUTER_KEY = 'custom-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({
          apiKeyEnvVar: 'CUSTOM_OPENROUTER_KEY',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CUSTOM_OPENROUTER_KEY;
        } else {
          process.env.CUSTOM_OPENROUTER_KEY = originalEnv;
        }
      }
    });

    test('respects custom baseUrl', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({
          baseUrl: 'https://custom.openrouter.endpoint',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom headers for attribution', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({
          headers: { 'HTTP-Referer': 'https://myapp.com' },
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });

    test('maps Fred config to native OpenRouter client and model options', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      const layerToken = Symbol('openrouter-layer');
      const layerSpy = mock(() => layerToken as any);
      const modelSpy = mock((modelId: string, config?: Record<string, unknown>) => ({ modelId, config }));

      mock.module('@effect/ai-openrouter', () => ({
        OpenRouterClient: { layer: layerSpy },
        OpenRouterLanguageModel: { model: modelSpy },
      }));

      try {
        const result = await OpenRouterProviderFactory.load({
          baseUrl: 'https://custom.openrouter.endpoint',
          headers: {
            'HTTP-Referer': 'https://myapp.com',
            'X-Title': 'My App',
          },
        });

        expect(result.layer as any).toBe(layerToken);

        const clientOptions = ((layerSpy.mock.calls as unknown as Array<[Record<string, unknown>]>) [0]?.[0]) as Record<string, unknown>;
        expect(clientOptions.apiUrl).toBe('https://custom.openrouter.endpoint');
        expect(clientOptions.referrer).toBe('https://myapp.com');
        expect(clientOptions.title).toBe('My App');

        const model = await Effect.runPromise(
          result.getModel('anthropic/claude-3.5-sonnet', {
            temperature: 0.2,
            maxTokens: 512,
          })
        );

        expect(model as any).toEqual({
          modelId: 'anthropic/claude-3.5-sonnet',
          config: {
            temperature: 0.2,
            max_tokens: 512,
          },
        });
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });

    test('getModel returns Effect', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY;
      process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

      try {
        const result = await OpenRouterProviderFactory.load({});
        const model = result.getModel('anthropic/claude-3.5-sonnet');

        // Effect has a _tag property
        expect(model).toBeDefined();
        expect(typeof model).toBe('object');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY;
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv;
        }
      }
    });
  });
});
