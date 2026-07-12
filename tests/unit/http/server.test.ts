import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  parseArgs,
  registerDefaultProvidersBestEffort,
} from '../../../packages/fred-http/src/server';

describe('fred-http server arguments', () => {
  it('uses the default port for missing, non-numeric, and out-of-range values', () => {
    expect(parseArgs(['--port'])).toEqual({ port: 3000 });
    expect(parseArgs(['--port', 'nope'])).toEqual({ port: 3000 });
    expect(parseArgs(['--port', '0'])).toEqual({ port: 3000 });
    expect(parseArgs(['--port', '65536'])).toEqual({ port: 3000 });
  });

  it('accepts valid ports and preserves the config argument', () => {
    expect(parseArgs(['--config', 'fred.config.ts', '--port', '4312'])).toEqual({
      configPath: 'fred.config.ts',
      port: 4312,
    });
  });

  it('keeps default provider registration best-effort', async () => {
    const attempted: string[] = [];

    await Effect.runPromise(registerDefaultProvidersBestEffort(
      async (providerId) => {
        attempted.push(providerId);
        if (providerId === 'missing-key') {
          throw new Error('API key is not configured');
        }
      },
      ['available', 'missing-key', 'also-available'],
    ));

    expect(attempted).toEqual(['available', 'missing-key', 'also-available']);
  });
});
