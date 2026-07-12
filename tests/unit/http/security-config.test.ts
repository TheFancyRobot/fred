import { describe, expect, test } from 'bun:test';
import { createFred } from '../../../packages/core/src/client';
import { withHttp } from '../../../packages/fred-http/src/client';
import {
  DEFAULT_SECURITY_CONFIG,
  resolveServerSecurityConfig,
  validateFredHttpRuntimeConfig,
} from '../../../packages/fred-http/src/security';

describe('fred-http configuration Schema', () => {
  test('decodes compatible defaults and immutable overrides', () => {
    const resolved = resolveServerSecurityConfig({
      requireAuth: false,
      corsAllowedOrigins: ['https://console.example'],
      maxRequestBodySize: 4_096,
      requestTimeoutSeconds: 12,
      redactPaths: ['request.credentials.*'],
    });

    expect(resolved.config).toMatchObject({
      requireAuth: false,
      corsAllowedOrigins: ['https://console.example'],
      maxRequestBodySize: 4_096,
      requestTimeoutSeconds: 12,
      redactPaths: ['request.credentials.*'],
    });
    expect(resolved.config.rateLimitMaxRequests).toBe(DEFAULT_SECURITY_CONFIG.rateLimitMaxRequests);
    expect(Object.isFrozen(resolved.config)).toBe(true);
    expect(Object.isFrozen(resolved.config.corsAllowedOrigins)).toBe(true);
  });

  test('rejects invalid limits, origins, storage unions, and redaction paths', () => {
    expect(() => resolveServerSecurityConfig({ maxRequestBodySize: 0 })).toThrow();
    expect(() => resolveServerSecurityConfig({ requestTimeoutSeconds: 3_601 })).toThrow();
    expect(() => resolveServerSecurityConfig({ rateLimitMaxRequests: -1 })).toThrow();
    expect(() => resolveServerSecurityConfig({ corsAllowedOrigins: ['https://example.com/path'] })).toThrow();
    expect(() => resolveServerSecurityConfig({ redactPaths: ['headers..authorization'] })).toThrow();
    expect(() => validateFredHttpRuntimeConfig({ apiKeyStorage: 'redis' })).toThrow();
    expect(() => validateFredHttpRuntimeConfig({ rateLimitStorage: { backend: 'memory' } })).toThrow();
    expect(validateFredHttpRuntimeConfig({ apiKeyVerifier: 'custom-kms-v1' }).apiKeyVerifier).toBe('custom-kms-v1');
    expect(() => validateFredHttpRuntimeConfig({ apiKeyVerifier: 'Unsafe Verifier' })).toThrow();
  });

  test('withHttp rejects invalid config before listener startup', async () => {
    const fred = await createFred();
    try {
      expect(() => withHttp(fred, { security: { maxRequestBodySize: 0 } })).toThrow();
    } finally {
      await fred.shutdown();
    }
  });
});
