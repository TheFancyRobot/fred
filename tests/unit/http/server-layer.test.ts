import { afterEach, describe, expect, test } from 'bun:test';
import { createFred } from '../../../packages/core/src/client';
import { withHttp, type FredWithHttp } from '../../../packages/fred-http/src/client';

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
});

