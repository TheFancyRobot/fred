import { describe, it, expect } from 'bun:test';
import {
  DEFAULT_ENV_ALLOWLIST,
  MCPSecurityError,
  filterEnv,
  validateCommand,
  validateUrl,
} from '../../../packages/core/src/mcp/security';

const expectSecurityError = (
  fn: () => void,
  expectedCode: 'COMMAND_DENIED' | 'URL_DENIED' | 'SCHEME_DENIED'
): void => {
  try {
    fn();
    throw new Error('Expected MCPSecurityError');
  } catch (error) {
    expect(error).toBeInstanceOf(MCPSecurityError);
    expect((error as MCPSecurityError).code).toBe(expectedCode);
  }
};

describe('MCP security', () => {
  describe('validateCommand', () => {
    it('allows command when it is in allowlist', () => {
      expect(() => validateCommand('node', ['node', 'bun'])).not.toThrow();
    });

    it('rejects command when it is not in allowlist', () => {
      expectSecurityError(() => validateCommand('python', ['node', 'bun']), 'COMMAND_DENIED');
    });

    it('passes through when allowlist is undefined', () => {
      expect(() => validateCommand('python', undefined)).not.toThrow();
    });

    it('rejects all commands when allowlist is empty', () => {
      expectSecurityError(() => validateCommand('node', []), 'COMMAND_DENIED');
    });
  });

  describe('validateUrl', () => {
    it('allows URL when host is in allowlist', () => {
      expect(() => validateUrl('https://example.com/mcp', ['example.com'], undefined)).not.toThrow();
    });

    it('rejects URL when host is not in allowlist', () => {
      expectSecurityError(() => validateUrl('https://evil.com/mcp', ['example.com'], undefined), 'URL_DENIED');
    });

    it('allows URL when scheme is in allowlist', () => {
      expect(() => validateUrl('https://example.com/mcp', undefined, ['https'])).not.toThrow();
    });

    it('rejects URL when scheme is not in allowlist', () => {
      expectSecurityError(() => validateUrl('http://example.com/mcp', undefined, ['https']), 'SCHEME_DENIED');
    });

    it('passes through when host and scheme allowlists are undefined', () => {
      expect(() => validateUrl('http://any-host.local/test', undefined, undefined)).not.toThrow();
    });

    it('rejects invalid URL strings', () => {
      expectSecurityError(() => validateUrl('not-a-url', undefined, undefined), 'URL_DENIED');
    });
  });

  describe('filterEnv', () => {
    it('keeps only allowlisted env keys plus explicit env overrides', () => {
      const filtered = filterEnv(['PATH', 'HOME'], {
        MCP_API_KEY: 'secret',
      });

      expect(Object.keys(filtered)).toContain('PATH');
      expect(Object.keys(filtered)).toContain('HOME');
      expect(filtered.MCP_API_KEY).toBe('secret');
    });

    it('uses default allowlist when allowlist is undefined', () => {
      const filtered = filterEnv(undefined, undefined);

      for (const key of DEFAULT_ENV_ALLOWLIST) {
        if (process.env[key] !== undefined) {
          expect(filtered[key]).toBe(process.env[key]);
        }
      }
    });

    it('applies explicit env values on top of filtered base env', () => {
      const pathOverride = '/custom/bin';
      const filtered = filterEnv(['PATH'], {
        PATH: pathOverride,
        APP_MODE: 'test',
      });

      expect(filtered.PATH).toBe(pathOverride);
      expect(filtered.APP_MODE).toBe('test');
    });
  });
});
