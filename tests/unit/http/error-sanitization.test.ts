import { afterEach, describe, expect, it } from 'bun:test';
import { createFred, type FredClient } from '@fancyrobot/fred';
import { createFredHttpApp } from '../../../packages/fred-http/src';

describe('fred-http error sanitization', () => {
  const clients: FredClient[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  });

  it('sanitizes thrown errors from custom handlers', async () => {
    const fred = await createFred();
    clients.push(fred);
    const app = createFredHttpApp({
      fred,
      getClientIp: () => '203.0.113.10',
      routes: [
        {
          method: 'GET',
          path: '/boom',
          visibility: 'public',
          handler: () => {
            throw new Error('sensitive failure details');
          },
        },
      ],
    });

    const response = await app.fetch(new Request('http://localhost/boom'));
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Request failed');
    expect(JSON.stringify(body)).not.toContain('sensitive failure details');
  });
});
