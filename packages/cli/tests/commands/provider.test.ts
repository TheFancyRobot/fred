import { describe, expect, test } from 'bun:test';
import { Effect, Redacted } from 'effect';
import { decodeProviderConnectionId, type ProviderConnection } from '@fancyrobot/fred';
import {
  handleProviderCommand,
  type ProviderCommandDependencies,
  type ProviderConnectionCommandStore,
  type ProviderConnectionRecord,
} from '../../src/commands/provider';

const connectionId = async () => Effect.runPromise(
  decodeProviderConnectionId('70f56a1a-2280-4dd5-9330-879b3932064a'),
);

const capture = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: { stdout: (message: string) => stdout.push(message), stderr: (message: string) => stderr.push(message) },
  };
};

const createStore = (records: ProviderConnectionRecord[] = []) => {
  const saved = [...records];
  const store: ProviderConnectionCommandStore = {
    list: async () => saved.map((record) => record.connection),
    get: async (id) => saved.find((record) => record.connection.id === id) ?? null,
    save: async (connection, credentials, expiresAt) => {
      saved.push({ connection, credentials, ...(expiresAt === undefined ? {} : { expiresAt }) });
    },
    remove: async (id) => {
      const index = saved.findIndex((record) => record.connection.id === id);
      if (index < 0) return false;
      saved.splice(index, 1);
      return true;
    },
    metadata: async (id) => {
      const record = saved.find((candidate) => candidate.connection.id === id);
      return record ? { ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }) } : null;
    },
  };
  return {
    saved,
    deps: (io: ReturnType<typeof capture>['io']): ProviderCommandDependencies => ({
      io,
      openStore: async () => ({ store, close: async () => undefined }),
    }),
  };
};

describe('provider command', () => {
  test('tests an API-key draft before saving without serializing its secret', async () => {
    const output = capture();
    const fixture = createStore();
    let testedSecret = '';
    const deps: ProviderCommandDependencies = {
      ...fixture.deps(output.io),
      readSecret: async () => 'provider-secret-canary',
      testConnection: async (_draft, credentials) => {
        if (credentials.kind === 'api-key') testedSecret = Redacted.value(credentials.apiKey);
      },
    };

    const exitCode = await handleProviderCommand(
      ['add', 'openai', 'work'],
      { json: true, test: true },
      deps,
    );

    expect(exitCode).toBe(0);
    expect(testedSecret).toBe('provider-secret-canary');
    expect(fixture.saved).toHaveLength(1);
    expect(JSON.stringify({ stdout: output.stdout, stderr: output.stderr })).not.toContain('provider-secret-canary');
    expect(JSON.parse(output.stdout[0] ?? '{}').data).toMatchObject({
      label: 'work', provider: 'openai', auth: 'api-key',
    });
  });

  test('does not persist a draft when its pre-save test fails', async () => {
    const output = capture();
    const fixture = createStore();
    const exitCode = await handleProviderCommand(
      ['add', 'openai', 'work'],
      { test: true },
      {
        ...fixture.deps(output.io),
        readSecret: async () => 'provider-secret-canary',
        testConnection: async () => { throw new Error('network unavailable'); },
      },
    );

    expect(exitCode).toBe(4);
    expect(fixture.saved).toHaveLength(0);
    expect(output.stderr).toEqual(['Provider connection test failed.']);
    expect(JSON.stringify(output)).not.toContain('provider-secret-canary');
  });

  test('uses the hosted provider probe and rejects unsuccessful HTTP status', async () => {
    const output = capture();
    const fixture = createStore();
    const originalFetch = globalThis.fetch;
    let requestUrl = '';
    globalThis.fetch = async (input) => {
      requestUrl = String(input);
      return new Response(null, { status: 401 });
    };
    try {
      const exitCode = await handleProviderCommand(
        ['add', 'openai', 'work'],
        { test: true },
        {
          ...fixture.deps(output.io),
          readSecret: async () => 'provider-secret-canary',
        },
      );

      expect(exitCode).toBe(4);
      expect(requestUrl).toBe('https://api.openai.com/v1/models');
      expect(fixture.saved).toHaveLength(0);
      expect(output.stderr).toEqual(['Provider "openai" rejected the connection test (HTTP 401).']);
      expect(JSON.stringify(output)).not.toContain('provider-secret-canary');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('removes local OAuth credentials even when remote revoke fails', async () => {
    const output = capture();
    const id = await connectionId();
    const connection: ProviderConnection = {
      id,
      label: 'google-work',
      providerId: 'google',
      auth: { kind: 'oauth2-bearer' },
      status: 'active',
    };
    const fixture = createStore([{
      connection,
      credentials: {
        kind: 'oauth2-bearer',
        accessToken: Redacted.make('access-token-canary'),
        refreshToken: Redacted.make('refresh-token-canary'),
      },
    }]);

    const exitCode = await handleProviderCommand(['logout', id], {}, {
      ...fixture.deps(output.io),
      revoke: async () => { throw new Error('remote unavailable'); },
    });

    expect(exitCode).toBe(4);
    expect(fixture.saved).toHaveLength(0);
    expect(output.stderr).toEqual(['Remote credential revocation failed.']);
    expect(JSON.stringify(output)).not.toContain('access-token-canary');
    expect(JSON.stringify(output)).not.toContain('refresh-token-canary');
  });

  test('saves OAuth login results as their declared runtime authentication kind', async () => {
    const output = capture();
    const fixture = createStore();
    const exitCode = await handleProviderCommand(['login', 'openrouter', 'team'], { json: true }, {
      ...fixture.deps(output.io),
      login: async () => ({ credentials: { kind: 'api-key', apiKey: Redacted.make('openrouter-key-canary') } }),
    });

    expect(exitCode).toBe(0);
    expect(fixture.saved[0]?.connection.auth).toEqual({ kind: 'api-key' });
    expect(JSON.stringify(output)).not.toContain('openrouter-key-canary');
  });
});
