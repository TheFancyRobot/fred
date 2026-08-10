import { describe, expect, test } from 'bun:test';
import { Effect, Redacted } from 'effect';
import { decodeProviderConnectionId, type ProviderConnection } from '@fancyrobot/fred';
import {
  createLoopbackCallback,
  handleProviderCommand,
  openBrowser,
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
    store,
    saved,
    deps: (io: ReturnType<typeof capture>['io']): ProviderCommandDependencies => ({
      io,
      openStore: async () => ({ store, close: async () => undefined }),
    }),
  };
};

describe('provider command', () => {
  test('continues OAuth login when the OS browser opener is unavailable or exits unsuccessfully', async () => {
    const originalSpawn = Bun.spawn;
    try {
      Reflect.set(Bun, 'spawn', () => { throw new Error('missing opener'); });
      await expect(openBrowser('https://example.com/authorize')).resolves.toBeUndefined();

      Reflect.set(Bun, 'spawn', () => ({ exited: Promise.resolve(1) }));
      await expect(openBrowser('https://example.com/authorize')).resolves.toBeUndefined();
    } finally {
      Reflect.set(Bun, 'spawn', originalSpawn);
    }
  });

  test('accepts loopback OAuth callbacks only on the advertised path', async () => {
    const loopback = await createLoopbackCallback();
    try {
      const callback = loopback.wait(500);
      const unexpected = await fetch(new URL('/unexpected?code=wrong', loopback.callbackUrl));
      expect(unexpected.status).toBe(404);

      const expectedUrl = `${loopback.callbackUrl}?code=right`;
      const expected = await fetch(expectedUrl);
      expect(expected.status).toBe(200);
      expect(await callback).toBe(expectedUrl);
    } finally {
      loopback.close();
    }
  });

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

  test('keeps local OAuth credentials when remote revoke fails so logout can be retried', async () => {
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
    expect(fixture.saved).toHaveLength(1);
    expect(output.stderr).toEqual(['Remote credential revocation failed.']);
    expect(JSON.stringify(output)).not.toContain('access-token-canary');
    expect(JSON.stringify(output)).not.toContain('refresh-token-canary');
  });

  test('removes local OAuth credentials only after remote revoke succeeds', async () => {
    const output = capture();
    const id = await connectionId();
    const events: string[] = [];
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
      openStore: async () => {
        return {
          store: {
            ...fixture.store,
            remove: async (connectionId) => {
              events.push('remove');
              return fixture.store.remove(connectionId);
            },
          },
          close: async () => undefined,
        };
      },
      revoke: async () => { events.push('revoke'); },
    });

    expect(exitCode).toBe(0);
    expect(events).toEqual(['revoke', 'remove']);
    expect(fixture.saved).toHaveLength(0);
    expect(JSON.stringify(output)).not.toContain('access-token-canary');
    expect(JSON.stringify(output)).not.toContain('refresh-token-canary');
  });

  test('remove deletes only the local provider connection without remote revocation', async () => {
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
      },
    }]);
    let revoked = false;

    const exitCode = await handleProviderCommand(['remove', id], {}, {
      ...fixture.deps(output.io),
      revoke: async () => { revoked = true; },
    });

    expect(exitCode).toBe(0);
    expect(revoked).toBe(false);
    expect(fixture.saved).toHaveLength(0);
    expect(JSON.stringify(output)).not.toContain('access-token-canary');
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
    expect(fixture.saved[0]?.credentials.kind).toBe('api-key');
    expect(JSON.stringify(output)).not.toContain('openrouter-key-canary');
  });

  test('rejects OAuth login results that do not match the declared authentication kind', async () => {
    const output = capture();
    const fixture = createStore();
    const exitCode = await handleProviderCommand(['login', 'openrouter', 'team'], { json: true }, {
      ...fixture.deps(output.io),
      login: async () => ({
        credentials: {
          kind: 'oauth2-bearer',
          accessToken: Redacted.make('mismatched-access-token-canary'),
        },
      }),
    });

    expect(exitCode).toBe(1);
    expect(fixture.saved).toHaveLength(0);
    expect(JSON.parse(output.stdout[0] ?? '{}').error).toEqual({
      code: 'internal',
      message: 'Provider "openrouter" login returned oauth2-bearer credentials but the connection requires api-key.',
    });
    expect(JSON.stringify(output)).not.toContain('mismatched-access-token-canary');
  });
});
