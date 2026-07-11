import { describe, expect, it } from 'bun:test';
import { parseArgs } from '../../../packages/fred-http/src/server';

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
});
