import { afterEach, describe, expect, it } from 'bun:test';
import { Fred } from '@fancyrobot/fred';
import { ServerApp } from '../../../packages/fred-http/src';

const startedApps: ServerApp[] = [];

afterEach(async () => {
  while (startedApps.length > 0) {
    const app = startedApps.pop();
    if (app) {
      await app.stop();
    }
  }
});

describe('ServerApp', () => {
  it('applies conditional CORS headers to sanitized 500 responses', async () => {
    const app = new ServerApp(new Fred(), {
      requireAuth: false,
      corsAllowedOrigins: ['http://client.test:*'],
    });

    const router = Reflect.get(app, 'router') as { handleRequest: (request: Request) => Promise<Response> };
    Reflect.set(app, 'router', {
      ...router,
      handleRequest: async () => {
        throw new Error('sensitive failure details');
      },
    });

    startedApps.push(app);
    await app.start(0, '127.0.0.1');

    const server = Reflect.get(app, 'server') as { port: number };
    const response = await fetch(`http://127.0.0.1:${server.port}/boom`, {
      headers: {
        Origin: 'http://client.test:3000',
      },
    });

    expect(response.status).toBe(500);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://client.test:3000');

    const body = await response.json();
    expect(body.error).toBe('Request failed');
    expect(JSON.stringify(body)).not.toContain('sensitive failure details');
  });
});
