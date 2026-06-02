import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Fred } from '@fancyrobot/fred';
import { createFredHttpApp } from '../../../packages/fred-http/src/index';

describe('createFredHttpApp', () => {
  const originalNow = Date.now;
  let now = 0;

  beforeEach(() => {
    now = 0;
    Date.now = () => now;
  });

  afterEach(() => {
    Date.now = originalNow;
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
    } as never);

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

    const unauthenticated = await app.fetch(new Request('http://localhost/private/ping'));
    expect(unauthenticated.status).toBe(401);
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

    const first = await app.fetch(new Request('http://localhost/limited'));
    expect(first.status).toBe(200);

    now = 100;
    const second = await app.fetch(new Request('http://localhost/limited'));
    expect(second.status).toBe(429);
    expect(second.headers.get('Retry-After')).toBe('1');
  });
});
