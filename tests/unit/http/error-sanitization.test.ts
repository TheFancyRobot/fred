import { afterEach, describe, expect, it } from 'bun:test';
import { createFred } from '@fancyrobot/fred';
import { withHttp, type FredWithHttp } from '../../../packages/fred-http/src';

describe('fred-http error sanitization', () => {
  const clients: FredWithHttp[] = [];

  afterEach(async () => {
    await Promise.all(clients.splice(0).map((client) => client.shutdown()));
  });

  it('sanitizes thrown errors from custom handlers', async () => {
    const fred = withHttp(await createFred(), {
      security: { requireAuth: false },
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
    clients.push(fred);
    const handle = await fred.server.listen();
    const response = await fetch(`${handle.url}/boom`);
    expect(response.status).toBe(500);

    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('Request failed');
    expect(JSON.stringify(body)).not.toContain('sensitive failure details');
  });
});
