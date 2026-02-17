import { describe, test, expect } from 'bun:test';
import { GroqProviderFactory, classifyHttpError, GROQ_RETRY_CONFIG, NON_RETRYABLE_STATUS_CODES } from '../../../../../packages/provider-groq/src/index';
import type { GroqRetryDiagnostics } from '../../../../../packages/provider-groq/src/index';

describe('GroqProviderFactory', () => {
  describe('static properties', () => {
    test('has correct id', () => {
      expect(GroqProviderFactory.id).toBe('groq');
    });

    test('has correct aliases', () => {
      expect(GroqProviderFactory.aliases).toEqual(['groq']);
    });
  });

  describe('configuration', () => {
    test('factory has load method', () => {
      expect(typeof GroqProviderFactory.load).toBe('function');
    });

    test('load is async', () => {
      const result = GroqProviderFactory.load({});
      expect(result).toBeInstanceOf(Promise);
      // Clean up the promise to avoid unhandled rejection
      result.catch(() => {});
    });
  });

  describe('integration with @effect/ai-openai', () => {
    // Integration tests require actual @effect/ai-openai module
    // These tests verify the factory can successfully load when the dependency is available

    test('loads successfully with default configuration', async () => {
      // Set up test environment variable
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({});

        // Verify the result has the expected structure
        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
        expect(typeof result.getModel).toBe('function');
      } finally {
        // Restore original environment
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom apiKeyEnvVar', async () => {
      const originalEnv = process.env.CUSTOM_GROQ_KEY;
      process.env.CUSTOM_GROQ_KEY = 'custom-groq-key';

      try {
        const result = await GroqProviderFactory.load({
          apiKeyEnvVar: 'CUSTOM_GROQ_KEY',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.CUSTOM_GROQ_KEY;
        } else {
          process.env.CUSTOM_GROQ_KEY = originalEnv;
        }
      }
    });

    test('respects custom baseUrl', async () => {
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({
          baseUrl: 'https://custom.groq.endpoint',
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });

    test('respects custom headers', async () => {
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({
          headers: { 'X-Custom': 'value' },
        });

        expect(result).toBeDefined();
        expect(result.layer).toBeDefined();
      } finally {
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });

    test('getModel returns Effect', async () => {
      const originalEnv = process.env.GROQ_API_KEY;
      process.env.GROQ_API_KEY = 'test-groq-key';

      try {
        const result = await GroqProviderFactory.load({});
        const model = result.getModel('llama-3.3-70b-versatile');

        // Effect has a _tag property
        expect(model).toBeDefined();
        expect(typeof model).toBe('object');
      } finally {
        if (originalEnv === undefined) {
          delete process.env.GROQ_API_KEY;
        } else {
          process.env.GROQ_API_KEY = originalEnv;
        }
      }
    });
  });

  describe('retry configuration', () => {
    test('GROQ_RETRY_CONFIG has sensible defaults', () => {
      expect(GROQ_RETRY_CONFIG.maxRetries).toBe(3);
      expect(GROQ_RETRY_CONFIG.baseDelayMs).toBe(500);
    });

    test('NON_RETRYABLE_STATUS_CODES includes 400, 401, 403, 404, 422', () => {
      expect(NON_RETRYABLE_STATUS_CODES.has(400)).toBe(true);
      expect(NON_RETRYABLE_STATUS_CODES.has(401)).toBe(true);
      expect(NON_RETRYABLE_STATUS_CODES.has(403)).toBe(true);
      expect(NON_RETRYABLE_STATUS_CODES.has(404)).toBe(true);
      expect(NON_RETRYABLE_STATUS_CODES.has(422)).toBe(true);
    });

    test('NON_RETRYABLE_STATUS_CODES does not include retryable codes', () => {
      expect(NON_RETRYABLE_STATUS_CODES.has(429)).toBe(false);
      expect(NON_RETRYABLE_STATUS_CODES.has(500)).toBe(false);
      expect(NON_RETRYABLE_STATUS_CODES.has(502)).toBe(false);
      expect(NON_RETRYABLE_STATUS_CODES.has(503)).toBe(false);
    });
  });

  describe('classifyHttpError', () => {
    function makeResponseError(status: number) {
      return {
        _tag: 'ResponseError',
        reason: 'StatusCode',
        response: { status },
        request: { method: 'POST', url: '/chat/completions' },
      };
    }

    test('classifies 429 as retryable rate-limit', () => {
      const result = classifyHttpError(makeResponseError(429));
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(429);
      expect(result.category).toBe('rate-limit');
    });

    test('classifies 500 as retryable transient', () => {
      const result = classifyHttpError(makeResponseError(500));
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(500);
      expect(result.category).toBe('transient');
    });

    test('classifies 502 as retryable transient', () => {
      const result = classifyHttpError(makeResponseError(502));
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(502);
      expect(result.category).toBe('transient');
    });

    test('classifies 503 as retryable transient', () => {
      const result = classifyHttpError(makeResponseError(503));
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBe(503);
      expect(result.category).toBe('transient');
    });

    test('classifies 400 as non-retryable', () => {
      const result = classifyHttpError(makeResponseError(400));
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(400);
      expect(result.category).toBe('non-retryable');
    });

    test('classifies 401 as non-retryable', () => {
      const result = classifyHttpError(makeResponseError(401));
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(401);
      expect(result.category).toBe('non-retryable');
    });

    test('classifies 403 as non-retryable', () => {
      const result = classifyHttpError(makeResponseError(403));
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.category).toBe('non-retryable');
    });

    test('classifies 404 as non-retryable', () => {
      const result = classifyHttpError(makeResponseError(404));
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.category).toBe('non-retryable');
    });

    test('classifies 422 as non-retryable', () => {
      const result = classifyHttpError(makeResponseError(422));
      expect(result.retryable).toBe(false);
      expect(result.statusCode).toBe(422);
      expect(result.category).toBe('non-retryable');
    });

    test('classifies network errors (no response) as retryable transient', () => {
      const result = classifyHttpError(new Error('ECONNREFUSED'));
      expect(result.retryable).toBe(true);
      expect(result.statusCode).toBeUndefined();
      expect(result.category).toBe('transient');
    });

    test('classifies null/undefined errors as retryable transient', () => {
      expect(classifyHttpError(null).retryable).toBe(true);
      expect(classifyHttpError(undefined).retryable).toBe(true);
    });
  });

  describe('GroqRetryDiagnostics type', () => {
    test('diagnostics structure matches expected shape', () => {
      const diagnostics: GroqRetryDiagnostics = {
        provider: 'groq',
        retryable: true,
        attempts: 3,
        maxRetries: 3,
        lastStatusCode: 503,
        failureCategory: 'transient',
      };
      expect(diagnostics.provider).toBe('groq');
      expect(diagnostics.retryable).toBe(true);
      expect(diagnostics.attempts).toBe(3);
      expect(diagnostics.maxRetries).toBe(3);
      expect(diagnostics.lastStatusCode).toBe(503);
      expect(diagnostics.failureCategory).toBe('transient');
    });

    test('diagnostics works without lastStatusCode', () => {
      const diagnostics: GroqRetryDiagnostics = {
        provider: 'groq',
        retryable: false,
        attempts: 1,
        maxRetries: 3,
        failureCategory: 'non-retryable',
      };
      expect(diagnostics.lastStatusCode).toBeUndefined();
    });
  });
});
