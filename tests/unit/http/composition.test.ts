import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Fred } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { createFredHttpApp as createFredHttpAppBase } from '../../../packages/fred-http/src/index';
import { generateApiKey, makeMemoryApiKeyStore } from '../../../packages/fred-http/src/api-keys';

type CreateFredHttpAppOptions = Parameters<typeof createFredHttpAppBase>[0];
const createFredHttpApp = (options: CreateFredHttpAppOptions) => createFredHttpAppBase({
  getClientIp: () => '203.0.113.10',
  ...options,
});

describe('createFredHttpApp', () => {
  const originalNow = Date.now;
  let now = 0;
  const createdApps: Array<{ dispose?: () => void }> = [];

  beforeEach(() => {
    now = 0;
    Date.now = () => now;
  });

  afterEach(() => {
    Date.now = originalNow;
    for (const app of createdApps.splice(0)) {
      app.dispose?.();
    }
  });

  it('exposes a dispose method for composable apps', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: { requireAuth: false },
    });
    createdApps.push(app);

    expect(typeof Reflect.get(app, 'dispose')).toBe('function');
  });

  it('delegates built-in routes to the Effect HttpApi implementation', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: { requireAuth: false },
    });
    createdApps.push(app);

    const response = await app.fetch(new Request('http://localhost/health'));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  it('adds CORS headers exactly once for built-in adapter routes', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: {
        requireAuth: false,
        corsAllowedOrigins: ['http://client.test:*'],
      },
    });
    createdApps.push(app);

    const response = await app.fetch(new Request('http://localhost/health', {
      headers: { Origin: 'http://client.test:3000' },
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://client.test:3000');
  });

  it('allows explicit public custom routes without auth', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      routes: [
        {
          method: 'GET',
          path: '/public/ping',
          visibility: 'public',
          handler: () => new Response('pong', { status: 200 }),
        },
      ],
    });
    createdApps.push(app);

    const response = await app.fetch(new Request('http://localhost/public/ping'));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('pong');
  });

  it('applies auth to private custom routes', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: { requireAuth: true, authToken: 'secret' },
      routes: [
        {
          method: 'GET',
          path: '/private/ping',
          visibility: 'authenticated',
          handler: () => new Response('pong', { status: 200 }),
        },
      ],
    });
    createdApps.push(app);

    const unauthenticated = await app.fetch(new Request('http://localhost/private/ping'));
    expect(unauthenticated.status).toBe(401);
  });

  it('does not allow spoofed forwarded headers to bypass local auth exemptions', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: {
        requireAuth: true,
        authToken: 'secret',
        allowLocalRequestsWithoutAuth: true,
      },
      routes: [
        {
          method: 'GET',
          path: '/private/ping',
          visibility: 'authenticated',
          handler: () => new Response('pong', { status: 200 }),
        },
      ],
    });
    createdApps.push(app);

    const spoofed = await app.fetch(new Request('http://example.test/private/ping', {
      headers: {
        'x-forwarded-for': '127.0.0.1',
      },
    }));

    expect(spoofed.status).toBe(401);
  });

  it('applies rate limiting to custom routes', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: {
        requireAuth: false,
        rateLimitMaxRequests: 1,
        rateLimitWindowMs: 1_000,
      },
      routes: [
        {
          method: 'GET',
          path: '/limited',
          visibility: 'public',
          handler: () => new Response('pong', { status: 200 }),
        },
      ],
    });
    createdApps.push(app);

    const first = await app.fetch(new Request('http://localhost/limited'));
    expect(first.status).toBe(200);

    now = 100;
    const second = await app.fetch(new Request('http://localhost/limited'));
    expect(second.status).toBe(429);
    expect(second.headers.get('Retry-After')).toBe('1');
  });

  it('fails closed instead of sharing one limiter bucket when client identity is unavailable', async () => {
    const fred = new Fred();
    const app = createFredHttpAppBase({
      fred,
      security: { requireAuth: false },
      routes: [{
        method: 'GET',
        path: '/anonymous',
        visibility: 'public',
        handler: () => new Response('pong', { status: 200 }),
      }],
    });
    createdApps.push(app);

    const response = await app.fetch(new Request('http://localhost/anonymous'));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('Service Unavailable');
  });

  it('keeps anonymous limiter buckets isolated by trusted client IP', async () => {
    const fred = new Fred();
    const app = createFredHttpAppBase({
      fred,
      getClientIp: (request) => request.headers.get('x-test-client-ip') ?? undefined,
      security: {
        requireAuth: false,
        rateLimitMaxRequests: 1,
        rateLimitWindowMs: 1_000,
      },
      routes: [{
        method: 'GET',
        path: '/isolated',
        visibility: 'public',
        handler: () => new Response('pong', { status: 200 }),
      }],
    });
    createdApps.push(app);
    const request = (ip: string) => app.fetch(new Request('http://localhost/isolated', {
      headers: { 'x-test-client-ip': ip },
    }));

    expect((await request('203.0.113.1')).status).toBe(200);
    expect((await request('203.0.113.2')).status).toBe(200);
    expect((await request('203.0.113.1')).status).toBe(429);
  });

  it('shares key-first rate-limit semantics with the compatibility adapter', async () => {
    const fred = new Fred();
    const apiKeyStore = makeMemoryApiKeyStore();
    const first = await Effect.runPromise(generateApiKey([], { rateLimit: { maxRequests: 1, windowMs: 1_000 } }));
    const second = await Effect.runPromise(generateApiKey([], { rateLimit: { maxRequests: 1, windowMs: 1_000 } }));
    await Effect.runPromise(Effect.all([
      apiKeyStore.insert(first.record),
      apiKeyStore.insert(second.record),
    ]));
    const app = createFredHttpApp({
      fred,
      apiKeyStore,
      getClientIp: () => '203.0.113.1',
    });
    createdApps.push(app);

    const request = (token: string) => app.fetch(new Request('http://localhost/health', {
      headers: { authorization: `Bearer ${token}` },
    }));
    expect((await request(first.token)).status).toBe(200);
    expect((await request(second.token)).status).toBe(200);
    const limited = await request(first.token);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('1');
  });

  it('reflects custom route methods in CORS preflight responses', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: {
        requireAuth: false,
        corsAllowedOrigins: ['http://client.test:*'],
      },
      routes: [
        {
          method: 'PUT',
          path: '/resource',
          visibility: 'public',
          handler: () => new Response('updated', { status: 200 }),
        },
      ],
    });
    createdApps.push(app);

    const response = await app.fetch(new Request('http://localhost/resource', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://client.test:3000',
        'Access-Control-Request-Method': 'PUT',
      },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('PUT');
    expect(response.headers.get('Access-Control-Allow-Methods')).toContain('OPTIONS');
  });

  it('enforces compatibility body limits at the boundary and sanitizes rejection', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
      security: { requireAuth: false, maxRequestBodySize: 4 },
      routes: [{
        method: 'POST',
        path: '/bounded',
        visibility: 'public',
        handler: (request) => request.text().then((body) => new Response(body)),
      }],
    });
    createdApps.push(app);

    const boundary = await app.fetch(new Request('http://localhost/bounded', {
      method: 'POST',
      body: '1234',
    }));
    expect(boundary.status).toBe(200);
    expect(await boundary.text()).toBe('1234');

    const oversized = await app.fetch(new Request('http://localhost/bounded', {
      method: 'POST',
      body: '12345',
    }));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ success: false, error: 'Request body too large' });
  });

  it('stops reading a chunked compatibility request once it exceeds the body limit', async () => {
    const fred = new Fred();
    let pulls = 0;
    let handled = false;
    const app = createFredHttpApp({
      fred,
      security: { requireAuth: false, maxRequestBodySize: 4 },
      routes: [{
        method: 'POST',
        path: '/chunked-bounded',
        visibility: 'public',
        handler: () => {
          handled = true;
          return new Response('unexpected');
        },
      }],
    });
    createdApps.push(app);

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode('1234'));
        else if (pulls === 2) controller.enqueue(new TextEncoder().encode('5'));
        else controller.close();
      },
    }, { highWaterMark: 0 });
    const response = await app.fetch(new Request('http://localhost/chunked-bounded', {
      method: 'POST',
      body,
    }));

    expect(response.status).toBe(413);
    expect(handled).toBe(false);
    expect(pulls).toBe(2);
  });

  it('times out compatibility handlers, aborts their signal, and returns a sanitized response', async () => {
    const fred = new Fred();
    let aborted = false;
    const app = createFredHttpApp({
      fred,
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
    createdApps.push(app);

    const response = await app.fetch(new Request('http://localhost/slow'));
    expect(response.status).toBe(504);
    expect(await response.json()).toEqual({ success: false, error: 'Request timed out' });
    expect(aborted).toBe(true);
  });
});
