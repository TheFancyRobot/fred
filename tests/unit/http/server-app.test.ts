import { afterEach, describe, expect, it } from 'bun:test';
import { createFred, type FredClient } from '@fancyrobot/fred';
import { ServerApp } from '../../../packages/fred-http/src';

const startedApps: ServerApp[] = [];
const clients: FredClient[] = [];

afterEach(async () => {
  while (startedApps.length > 0) {
    const app = startedApps.pop();
    if (app) {
      await app.stop();
    }
  }
  await Promise.all(clients.splice(0).map((client) => client.shutdown()));
});

describe('ServerApp', () => {
  it('delegates to the HttpApi listener while preserving lifecycle and CORS', async () => {
    const framework = await createFred();
    clients.push(framework);
    const app = new ServerApp(framework, {
      requireAuth: false,
      corsAllowedOrigins: ['http://client.test:*'],
    });

    startedApps.push(app);
    await app.start(0, '127.0.0.1');

    const server = Reflect.get(app, 'server') as { port: number };
    const response = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: {
        Origin: 'http://client.test:3000',
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://client.test:3000');
    expect(app.getFramework()).toBe(framework);
  });
});
