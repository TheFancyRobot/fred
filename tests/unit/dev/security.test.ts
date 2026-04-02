import { describe, expect, it } from 'bun:test';
import { checkAuth, matchOrigin, type ServerSecurityConfig } from '../../../packages/dev/src/server/security';

const baseConfig = (overrides: Partial<ServerSecurityConfig> = {}): ServerSecurityConfig => ({
  requireAuth: true,
  authToken: 'test-token',
  allowLocalRequestsWithoutAuth: false,
  corsAllowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*', 'http://example.com'],
  maxRequestBodySize: 1_048_576,
  requestTimeoutSeconds: 30,
  rateLimitMaxRequests: 60,
  rateLimitWindowMs: 60_000,
  ...overrides,
});

describe('checkAuth', () => {
  it('rejects local requests without auth header by default', () => {
    const result = checkAuth('127.0.0.1', null, baseConfig());
    expect(result).toEqual({ allowed: false, status: 401 });
  });

  it('rejects non-local requests without auth header', () => {
    const result = checkAuth('10.0.0.1', null, baseConfig());
    expect(result).toEqual({ allowed: false, status: 401 });
  });

  it('rejects non-local requests with wrong bearer token', () => {
    const result = checkAuth('10.0.0.1', 'Bearer wrong-token', baseConfig());
    expect(result).toEqual({ allowed: false, status: 401 });
  });

  it('allows non-local requests with matching bearer token', () => {
    const result = checkAuth('10.0.0.1', 'Bearer test-token', baseConfig());
    expect(result).toEqual({ allowed: true });
  });

  it('allows local requests without auth when explicitly enabled', () => {
    const result = checkAuth(
      '127.0.0.1',
      null,
      baseConfig({ allowLocalRequestsWithoutAuth: true })
    );
    expect(result).toEqual({ allowed: true });
  });

  it('allows all requests when auth is disabled', () => {
    const config = baseConfig({ requireAuth: false });
    expect(checkAuth('10.0.0.1', null, config)).toEqual({ allowed: true });
    expect(checkAuth('10.0.0.1', 'Bearer wrong-token', config)).toEqual({ allowed: true });
  });
});

describe('matchOrigin', () => {
  it('matches wildcard port patterns for localhost', () => {
    const result = matchOrigin('http://localhost:3000', ['http://localhost:*']);
    expect(result).toBe(true);
  });

  it('rejects origins not in allowlist', () => {
    const result = matchOrigin('http://malicious.example.com', ['http://localhost:*']);
    expect(result).toBe(false);
  });

  it('matches exact origins', () => {
    const result = matchOrigin('http://example.com', ['http://example.com']);
    expect(result).toBe(true);
  });
});
