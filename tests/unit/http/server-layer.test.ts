import { afterEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { createFred } from '../../../packages/core/src/client';
import { withHttp, type FredWithHttp } from '../../../packages/fred-http/src/client';
import { generateApiKey, makeMemoryApiKeyStore } from '../../../packages/fred-http/src/api-keys';
import { RateLimitStoreError, type RateLimitStoreService } from '../../../packages/fred-http/src/rate-limiter';

const clients: FredWithHttp[] = [];

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
});

const start = async (options: Parameters<typeof withHttp>[1]) => {
  const fred = withHttp(await createFred(), options);
  clients.push(fred);
  return fred.server.listen();
};

describe('FredHttpServerLive security middleware', () => {
  test('authenticates built-in routes and emits the session CORS contract', async () => {
    const handle = await start({
      security: {
        authToken: 'secret-token',
        corsAllowedOrigins: ['https://console.example'],
      },
    });

    expect((await fetch(`${handle.url}/health`)).status).toBe(401);
    expect((await fetch(`${handle.url}/health`, {
      headers: { authorization: 'Bearer secret-token' },
    })).status).toBe(200);

    const preflight = await fetch(`${handle.url}/health`, {
      method: 'OPTIONS',
      headers: { origin: 'https://console.example' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-headers')).toContain('X-Session-Id');
    expect(preflight.headers.get('access-control-expose-headers')).toContain('X-Session-Id');
  });

  test('rate limits before routing and returns retry metadata', async () => {
    const handle = await start({
      security: { requireAuth: false, rateLimitMaxRequests: 1, rateLimitWindowMs: 60_000 },
    });

    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
    const limited = await fetch(`${handle.url}/health`);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('uses API key identity before IP and honors per-key policy overrides', async () => {
    const apiKeyStore = makeMemoryApiKeyStore();
    const first = generateApiKey([], { rateLimit: { maxRequests: 1, windowMs: 60_000 } });
    const second = generateApiKey([], { rateLimit: { maxRequests: 1, windowMs: 60_000 } });
    await Effect.runPromise(Effect.all([
      apiKeyStore.insert(first.record),
      apiKeyStore.insert(second.record),
    ]));
    const handle = await start({
      apiKeyStore,
      trustProxy: true,
      security: { rateLimitMaxRequests: 100, rateLimitWindowMs: 60_000 },
    });

    const request = (token: string, ip: string) => fetch(`${handle.url}/health`, {
      headers: { authorization: `Bearer ${token}`, 'x-forwarded-for': ip },
    });
    expect((await request(first.token, '203.0.113.1')).status).toBe(200);
    expect((await request(second.token, '203.0.113.1')).status).toBe(200);
    const limited = await request(first.token, '203.0.113.2');
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  test('fails closed with a sanitized 503 while the rate-limit store is unavailable', async () => {
    let available = false;
    const store: RateLimitStoreService = {
      backend: 'memory',
      initialize: Effect.void,
      consume: () => available
        ? Effect.succeed({ allowed: true, retryAfterMs: 0, remaining: 1, resetAt: Date.now() + 1_000 })
        : Effect.fail(new RateLimitStoreError({ operation: 'consume', message: 'secret database detail' })),
      prune: () => Effect.succeed(0),
      close: Effect.void,
    };
    const handle = await start({
      rateLimitStore: store,
      security: { requireAuth: false },
    });

    const unavailable = await fetch(`${handle.url}/health`);
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toBe('Service Unavailable');
    available = true;
    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
  });

  test('ignores proxy headers unless trustProxy is enabled', async () => {
    const untrusted = await start({
      security: { allowLocalRequestsWithoutAuth: true },
    });
    expect((await fetch(`${untrusted.url}/health`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })).status).toBe(200);

    const trusted = await start({
      trustProxy: true,
      security: { allowLocalRequestsWithoutAuth: true },
    });
    expect((await fetch(`${trusted.url}/health`, {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    })).status).toBe(401);
  });

  test('releases the listener so its bound port can be reused', async () => {
    const fred = withHttp(await createFred(), { security: { requireAuth: false } });
    clients.push(fred);
    const first = await fred.server.listen();
    await fred.server.stop();
    const second = await fred.server.listen({ port: first.port });
    expect(second.port).toBe(first.port);
  });

  test('normalizes a wildcard bind address to a usable client hostname', async () => {
    const fred = withHttp(await createFred(), { security: { requireAuth: false } });
    clients.push(fred);
    const handle = await fred.server.listen({ hostname: '0.0.0.0' });

    expect(handle.hostname).toBe('127.0.0.1');
    expect(handle.url).toBe(`http://127.0.0.1:${handle.port}`);
    expect((await fetch(`${handle.url}/health`)).status).toBe(200);
  });

  test('returns an OpenAI-style 400 when no user message is present', async () => {
    const handle = await start({ security: { requireAuth: false } });
    const response = await fetch(`${handle.url}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-session-id': 'invalid-request-session',
      },
      body: JSON.stringify({
        model: 'fred-test',
        messages: [{ role: 'assistant', content: 'No user message here' }],
      }),
    });

    expect(response.status).toBe(400);
    expect(response.headers.get('x-session-id')).toBe('invalid-request-session');
    expect(await response.json()).toEqual({
      error: {
        message: 'At least one user message is required',
        type: 'invalid_request_error',
        code: 'missing_user_message',
      },
    });
  });

  test('rejects unsupported simple-chat streaming with the declared 501 response', async () => {
    const handle = await start({ security: { requireAuth: false } });
    const response = await fetch(`${handle.url}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'stream this', stream: true }),
    });

    expect(response.status).toBe(501);
    expect(response.headers.get('x-session-id')).toBeTruthy();
    expect(await response.json()).toEqual({
      success: false,
      error: 'Streaming is not implemented for /chat; use /v1/chat/completions instead',
    });
  });
});
