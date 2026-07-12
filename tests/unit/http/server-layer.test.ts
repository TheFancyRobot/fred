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
  test('mounts public custom routes on the canonical Effect router', async () => {
    const handle = await start({
      routes: [{
        method: 'GET',
        path: '/public/ping',
        visibility: 'public',
        handler: () => new Response('pong'),
      }],
    });

    const response = await fetch(`${handle.url}/public/ping`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pong');
  });

  test('applies auth and CORS methods to custom routes', async () => {
    const handle = await start({
      security: {
        authToken: 'route-secret',
        corsAllowedOrigins: ['https://console.example'],
      },
      routes: [{
        method: 'PUT',
        path: '/private/resource',
        handler: () => new Response('updated'),
      }],
    });

    expect((await fetch(`${handle.url}/private/resource`, { method: 'PUT' })).status).toBe(401);
    const response = await fetch(`${handle.url}/private/resource`, {
      method: 'PUT',
      headers: { authorization: 'Bearer route-secret' },
    });
    expect(response.status).toBe(200);
    const preflight = await fetch(`${handle.url}/private/resource`, {
      method: 'OPTIONS',
      headers: { origin: 'https://console.example' },
    });
    expect(preflight.headers.get('access-control-allow-methods')).toContain('PUT');
  });

  test('sanitizes custom-route failures', async () => {
    const handle = await start({
      security: { requireAuth: false },
      routes: [{
        method: 'GET',
        path: '/boom',
        visibility: 'public',
        handler: () => {
          throw new Error('sensitive failure details');
        },
      }],
    });

    const response = await fetch(`${handle.url}/boom`);
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body).toEqual({ success: false, error: 'Request failed' });
    expect(JSON.stringify(body)).not.toContain('sensitive failure details');
  });

  test('times out custom routes and aborts their request signal', async () => {
    let aborted = false;
    const handle = await start({
      security: { requireAuth: false, requestTimeoutSeconds: 1 },
      routes: [{
        method: 'GET',
        path: '/slow',
        visibility: 'public',
        handler: (request) => new Promise<Response>(() => {
          request.signal.addEventListener('abort', () => { aborted = true; }, { once: true });
        }),
      }],
    });

    const response = await fetch(`${handle.url}/slow`);
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ success: false, error: 'Request timed out' });
    expect(aborted).toBe(true);
  });

  test('rejects custom routes that collide with built-in security paths', async () => {
    await expect(start({
      routes: [{
        method: 'PUT',
        path: '/health',
        visibility: 'public',
        handler: () => new Response('unsafe'),
      }],
    })).rejects.toThrow('Reserved custom route path: /health');
  });

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
    const first = await Effect.runPromise(generateApiKey([], { rateLimit: { maxRequests: 1, windowMs: 60_000 } }));
    const second = await Effect.runPromise(generateApiKey([], { rateLimit: { maxRequests: 1, windowMs: 60_000 } }));
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

  test('never uses a malformed forwarded address as a limiter identity', async () => {
    const keys: string[] = [];
    const store: RateLimitStoreService = {
      backend: 'memory',
      initialize: Effect.void,
      consume: (input) => {
        keys.push(input.key);
        return Effect.succeed({
          allowed: true,
          retryAfterMs: 0,
          remaining: 1,
          resetAt: Date.now() + 1_000,
        });
      },
      prune: () => Effect.succeed(0),
      close: Effect.void,
    };
    const handle = await start({
      trustProxy: true,
      rateLimitStore: store,
      security: { requireAuth: false },
    });

    expect((await fetch(`${handle.url}/health`, {
      headers: { 'x-forwarded-for': 'not-an-ip' },
    })).status).toBe(200);
    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toBe('ip:not-an-ip');
    expect(keys[0]).not.toBe('ip:unknown');
  });

  test('adds CORS only for allowed origins on 401, 429, and success responses', async () => {
    const handle = await start({
      security: {
        authToken: 'cors-secret',
        corsAllowedOrigins: ['https://allowed.example'],
        rateLimitMaxRequests: 1,
      },
    });
    const allowedHeaders = { origin: 'https://allowed.example' };
    const unauthorized = await fetch(`${handle.url}/health`, { headers: allowedHeaders });
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get('access-control-allow-origin')).toBe('https://allowed.example');

    const authenticatedHeaders = {
      ...allowedHeaders,
      authorization: 'Bearer cors-secret',
    };
    const success = await fetch(`${handle.url}/health`, { headers: authenticatedHeaders });
    expect(success.status).toBe(200);
    expect(success.headers.get('access-control-allow-origin')).toBe('https://allowed.example');
    const limited = await fetch(`${handle.url}/health`, { headers: authenticatedHeaders });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('access-control-allow-origin')).toBe('https://allowed.example');

    const disallowed = await fetch(`${handle.url}/health`, {
      headers: { origin: 'https://blocked.example' },
    });
    expect(disallowed.status).toBe(401);
    expect(disallowed.headers.get('access-control-allow-origin')).toBeNull();
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

  test('rejects oversized listener requests without echoing their body', async () => {
    const handle = await start({
      security: { requireAuth: false, maxRequestBodySize: 64 },
    });
    const secret = 'must-not-appear-'.repeat(20);
    const response = await fetch(`${handle.url}/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: secret }),
    });

    expect(response.status).toBe(413);
    expect(await response.text()).not.toContain(secret);
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
