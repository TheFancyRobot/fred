import { describe, expect, it } from 'bun:test';
import { Fred } from '@fancyrobot/fred';
import { createFredHttpApp } from '../../../packages/fred-http/src';

describe('fred-http error sanitization', () => {
  it('sanitizes thrown errors from custom handlers', async () => {
    const fred = new Fred();
    const app = createFredHttpApp({
      fred,
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
