import { describe, expect, test } from 'bun:test';
import { Cause, Effect, Exit, Layer, Option, Redacted, Schema } from 'effect';
import {
  BUILTIN_PROVIDER_CONNECTION_CAPABILITIES,
  LOCAL_PROVIDER_CONNECTION_CAPABILITIES,
  LegacyProviderConnectionResolver,
  InvalidProviderConnectionEndpointError,
  ProviderConnectionCredentialsSchema,
  ProviderConnectionSchema,
  ProviderConnectionId,
  ProviderConnectionIdentityChangeError,
  ProviderConnectionNotFoundError,
  ProviderConnectionPreparationRequiredError,
  ProviderConnectionNamespace,
  ProviderConnectionStore,
  ProviderConnectionStoreError,
  ProviderConnectionService,
  ProviderConnectionServiceLive,
  ProviderConnectionStatusSchema,
  makeInMemoryProviderConnectionLayer,
  makeLegacyProviderConnectionResolver,
  validateProviderConnectionCapability,
} from '../../../../packages/core/src/platform/connections';
import { providerConnectionProbeUrl } from '../../../../packages/core/src/platform/connection-test';
import { AgentConfigSchema } from '../../../../packages/core/src/config/schema';
import { toAgentConfig, validateAgentFrontmatter } from '../../../../packages/core/src/agent/file-loader';
import { createFred } from '../../../../packages/core/src';

const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
const namespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-a');
const otherNamespace = Schema.decodeUnknownSync(ProviderConnectionNamespace)('workspace-b');
const connection = {
  id: connectionId,
  label: 'Primary',
  providerId: 'openai',
  auth: { kind: 'api-key' as const },
  status: 'active' as const,
};
const credentials = { kind: 'api-key' as const, apiKey: Redacted.make('saved-secret') };

describe('provider connection contracts', () => {
  test('uses UUID ids and redacts runtime credentials in JSON', () => {
    expect(() => Schema.decodeUnknownSync(ProviderConnectionId)('not-a-uuid')).toThrow();
    const decoded = Schema.decodeUnknownSync(ProviderConnectionCredentialsSchema)({
      kind: 'api-key',
      apiKey: 'saved-secret',
    });
    expect(JSON.stringify(decoded)).not.toContain('saved-secret');
  });

  test('decodes connection IDs in config and agent frontmatter', () => {
    const decoded = Schema.decodeUnknownSync(AgentConfigSchema)({
      id: 'connected-agent',
      platform: 'openai',
      model: 'gpt-4.1-mini',
      connectionId,
      connectionNamespace: namespace,
    });
    expect(decoded.connectionId).toBe(connectionId);
    expect(decoded.connectionNamespace).toBe(namespace);

    validateAgentFrontmatter({
      id: 'connected-agent',
      platform: 'openai',
      model: 'gpt-4.1-mini',
      connectionId,
      connectionNamespace: namespace,
    }, '/tmp/connected-agent.md');
    expect(toAgentConfig({
      frontmatter: { id: 'connected-agent', platform: 'openai', model: 'gpt-4.1-mini', connectionId, connectionNamespace: namespace },
      body: 'Prompt',
      filePath: '/tmp/connected-agent.md',
    }).connectionId).toBe(connectionId);
  });

  test('rejects unpaired connection identity in config', () => {
    expect(() => Schema.decodeUnknownSync(AgentConfigSchema)({ connectionId })).toThrow(
      'connectionId and connectionNamespace must be configured together',
    );
    expect(() => Schema.decodeUnknownSync(AgentConfigSchema)({ connectionNamespace: namespace })).toThrow(
      'connectionId and connectionNamespace must be configured together',
    );
  });

  test('rejects unsafe provider endpoints before persistence, update, and probe', async () => {
    const unsafe = { ...connection, endpoint: 'https://user:password@example.com/v1' };
    expect(() => Schema.decodeUnknownSync(ProviderConnectionSchema)(unsafe)).toThrow(
      'Provider connection endpoint must use http or https and cannot include userinfo.',
    );
    expect(() => providerConnectionProbeUrl(
      { label: 'local', providerId: 'local-compatible', endpoint: 'file:///tmp/models', protocol: 'openai-compatible', auth: { kind: 'none' } },
      'https://api.openai.com/v1',
      '/models',
    )).toThrow('Provider connection endpoint must use http or https and cannot include userinfo.');
    expect(providerConnectionProbeUrl(
      { label: 'local', providerId: 'local-compatible', endpoint: 'http://127.0.0.1:11434/v1', protocol: 'openai-compatible', auth: { kind: 'none' } },
      'https://api.openai.com/v1',
      '/models',
    ).toString()).toBe('http://127.0.0.1:11434/v1/models');

    const result = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      const put = yield* Effect.exit(service.put(namespace, unsafe, credentials));
      const update = yield* Effect.exit(service.updateMetadata(namespace, unsafe));
      return { put, update, stored: yield* service.get(namespace, connectionId) };
    }).pipe(Effect.provide(makeInMemoryProviderConnectionLayer([{ namespace, connection, credentials }]))));

    for (const exit of [result.put, result.update]) {
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.failureOption(exit.cause);
        expect(error._tag).toBe('Some');
        if (error._tag === 'Some') expect(error.value).toBeInstanceOf(InvalidProviderConnectionEndpointError);
      }
    }
    expect(result.stored._tag).toBe('Some');
    if (result.stored._tag === 'Some') expect(result.stored.value.endpoint).toBeUndefined();
  });

  test('covers hosted and local authentication capabilities', async () => {
    const openai = BUILTIN_PROVIDER_CONNECTION_CAPABILITIES.find(({ providerId }) => providerId === 'openai');
    expect(openai).toBeDefined();
    if (!openai) return;

    const unsupported = await Effect.runPromiseExit(validateProviderConnectionCapability(
      { label: 'OAuth', providerId: 'openai', auth: { kind: 'oauth2-bearer' } },
      openai,
    ));
    expect(unsupported._tag).toBe('Failure');

    await Effect.runPromise(validateProviderConnectionCapability(
      {
        label: 'Local',
        providerId: 'local-compatible',
        endpoint: 'http://127.0.0.1:11434/v1',
        protocol: 'anthropic-compatible',
        auth: { kind: 'basic' },
      },
      LOCAL_PROVIDER_CONNECTION_CAPABILITIES,
    ));

    const missingEndpoint = await Effect.runPromiseExit(validateProviderConnectionCapability(
      {
        label: 'Local',
        providerId: 'local-compatible',
        protocol: 'openai-compatible',
        auth: { kind: 'none' },
      },
      LOCAL_PROVIDER_CONNECTION_CAPABILITIES,
    ));
    expect(Exit.isFailure(missingEndpoint)).toBe(true);
  });

  test('uses exactly the requested saved connection and observes credential rotation', async () => {
    const layer = makeInMemoryProviderConnectionLayer([{ namespace, connection, credentials }]);
    const result = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      const initial = yield* service.resolve({ providerId: 'openai', namespace, connectionId });
      yield* service.put(namespace, connection, { kind: 'api-key', apiKey: Redacted.make('rotated-secret') });
      const rotated = yield* service.resolve({ providerId: 'openai', namespace, connectionId });
      return { initial, rotated };
    }).pipe(Effect.provide(layer)));

    expect(Redacted.value(result.initial.credentials.apiKey)).toBe('saved-secret');
    expect(Redacted.value(result.rotated.credentials.apiKey)).toBe('rotated-secret');
  });

  test('updates metadata without replacing credentials or crossing namespaces', async () => {
    const localConnection = {
      ...connection,
      providerId: 'local-compatible',
      endpoint: 'http://127.0.0.1:11434/v1',
      protocol: 'openai-compatible' as const,
    };
    const layer = makeInMemoryProviderConnectionLayer([{ namespace, connection: localConnection, credentials }]);
    const result = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      const updated = {
        ...localConnection,
        label: 'Renamed',
        endpoint: 'http://127.0.0.1:11435',
        protocol: 'anthropic-compatible' as const,
        status: 'disabled' as const,
      };
      const saved = yield* service.updateMetadata(namespace, updated);
      const crossNamespace = yield* service.updateMetadata(otherNamespace, { ...updated, label: 'Wrong workspace' });
      const stored = yield* service.get(namespace, connectionId);
      yield* service.updateMetadata(namespace, { ...updated, status: 'active' });
      const record = yield* service.resolve({ providerId: 'anthropic', namespace, connectionId });
      return { saved, crossNamespace, stored, record };
    }).pipe(Effect.provide(layer)));

    expect(result.saved).toBe(true);
    expect(result.crossNamespace).toBe(false);
    expect(Option.getOrThrow(result.stored).label).toBe('Renamed');
    expect(Option.getOrThrow(result.stored).protocol).toBe('anthropic-compatible');
    expect(Option.getOrThrow(result.stored).status).toBe('disabled');
    expect(result.record.credentials.kind).toBe('api-key');
    if (result.record.credentials.kind === 'api-key') {
      expect(Redacted.value(result.record.credentials.apiKey)).toBe('saved-secret');
    }

    for (const changed of [
      { ...localConnection, providerId: 'openai' },
      { ...localConnection, auth: { kind: 'none' as const } },
    ]) {
      const exit = await Effect.runPromiseExit(Effect.gen(function* () {
        const service = yield* ProviderConnectionService;
        return yield* service.updateMetadata(namespace, changed);
      }).pipe(Effect.provide(layer)));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const failure = Cause.failureOption(exit.cause);
        expect(Option.isSome(failure)).toBe(true);
        if (Option.isSome(failure)) expect(failure.value).toBeInstanceOf(ProviderConnectionIdentityChangeError);
      }
    }
  });

  test('maps local-compatible protocols to the existing provider runtimes', async () => {
    const openAiId = Schema.decodeUnknownSync(ProviderConnectionId)('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    const anthropicId = Schema.decodeUnknownSync(ProviderConnectionId)('c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    const layer = makeInMemoryProviderConnectionLayer([
      {
        namespace,
        connection: {
          id: openAiId,
          label: 'Local OpenAI',
          providerId: 'local-compatible',
          endpoint: 'http://127.0.0.1:11434/v1',
          protocol: 'openai-compatible',
          auth: { kind: 'none' },
          status: 'active',
        },
        credentials: { kind: 'none' },
      },
      {
        namespace,
        connection: {
          id: anthropicId,
          label: 'Local Anthropic',
          providerId: 'local-compatible',
          endpoint: 'http://127.0.0.1:11435',
          protocol: 'anthropic-compatible',
          auth: { kind: 'basic' },
          status: 'active',
        },
        credentials: {
          kind: 'basic',
          username: Redacted.make('local-user'),
          password: Redacted.make('local-password'),
        },
      },
    ]);

    const resolved = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      return yield* Effect.all([
        service.resolve({ providerId: 'openai', namespace, connectionId: openAiId }),
        service.resolve({ providerId: 'anthropic', namespace, connectionId: anthropicId }),
      ]);
    }).pipe(Effect.provide(layer)));

    expect(resolved.map(({ connection }) => connection.protocol)).toEqual([
      'openai-compatible',
      'anthropic-compatible',
    ]);
  });

  test('injects a persisted connection layer into the Promise client', async () => {
    const client = await createFred({
      providerConnectionLayer: makeInMemoryProviderConnectionLayer([{ namespace, connection, credentials }]),
    });

    try {
      expect(await client.connections.updateMetadata(namespace, { ...connection, label: 'Renamed' })).toBe(true);
      const resolved = await client.connections.resolve({ providerId: 'openai', namespace, connectionId });
      expect(resolved.source).toBe('saved');
      expect(resolved.connection.id).toBe(connectionId);
      expect(resolved.connection.label).toBe('Renamed');
    } finally {
      await client.shutdown();
    }
  });

  test('tests drafts and saved connections through the Promise client without returning credentials', async () => {
    await import('../../../../packages/provider-openai/src/index');
    const originalFetch = globalThis.fetch;
    const authorization: string[] = [];
    globalThis.fetch = async (_input, init) => {
      authorization.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response('{}', { status: 200 });
    };
    const client = await createFred({
      providerConnectionLayer: makeInMemoryProviderConnectionLayer([{ namespace, connection, credentials }]),
    });

    try {
      await expect(client.connections.testDraft(
        { label: 'Draft', providerId: 'openai', auth: { kind: 'api-key' } },
        { kind: 'api-key', apiKey: Redacted.make('draft-secret') },
      )).resolves.toBeUndefined();
      await expect(client.connections.test(namespace, connectionId)).resolves.toBeUndefined();
      expect(authorization).toEqual(['Bearer draft-secret', 'Bearer saved-secret']);
    } finally {
      globalThis.fetch = originalFetch;
      await client.shutdown();
    }
  });

  test('refreshes Google OAuth through the public resolve and saved-test paths', async () => {
    await import('../../../../packages/provider-google/src/index');
    const googleId = Schema.decodeUnknownSync(ProviderConnectionId)('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    const originalFetch = globalThis.fetch;
    let refreshes = 0;
    const probeAuthorization: string[] = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        refreshes += 1;
        return new Response(JSON.stringify({ access_token: 'rotated-google-access', expires_in: 3_600 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      probeAuthorization.push(new Headers(init?.headers).get('authorization') ?? '');
      return new Response('{}', { status: 200 });
    };
    const client = await createFred({
      providerConnectionLayer: makeInMemoryProviderConnectionLayer([{
        namespace,
        connection: {
          id: googleId,
          label: 'Google OAuth',
          providerId: 'google',
          auth: { kind: 'oauth2-bearer' },
          status: 'active',
        },
        credentials: {
          kind: 'oauth2-bearer',
          accessToken: Redacted.make('expired-google-access'),
          refreshToken: Redacted.make('google-refresh-token'),
        },
        credentialVersion: 1,
        expiresAt: new Date(0),
      }]),
    });

    try {
      await expect(client.connections.resolve({ providerId: 'google', namespace, connectionId: googleId }))
        .rejects.toBeInstanceOf(ProviderConnectionPreparationRequiredError);
      await expect(client.connections.test(namespace, googleId))
        .rejects.toBeInstanceOf(ProviderConnectionPreparationRequiredError);
      await client.providers.use('google', { googleOAuth: { clientId: 'google-client-id' } });
      const resolved = await client.connections.resolve({ providerId: 'google', namespace, connectionId: googleId });
      await client.connections.test(namespace, googleId);
      expect(refreshes).toBe(1);
      expect(resolved.source).toBe('saved');
      if (resolved.source === 'saved' && resolved.credentials.kind === 'oauth2-bearer') {
        expect(Redacted.value(resolved.credentials.accessToken)).toBe('rotated-google-access');
        expect(resolved.credentialVersion).toBe(2);
      }
      expect(probeAuthorization).toEqual(['Bearer rotated-google-access']);
    } finally {
      globalThis.fetch = originalFetch;
      await client.shutdown();
    }
  });

  test('does not fall back to a saved connection when selection is omitted', async () => {
    const legacy = makeLegacyProviderConnectionResolver({ OPENAI_API_KEY: 'legacy-secret' });
    const layer = makeInMemoryProviderConnectionLayer([{ namespace, connection, credentials }], legacy);
    const result = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      return yield* service.resolve({ providerId: 'openai' });
    }).pipe(Effect.provide(layer)));

    expect(result.source).toBe('legacy-environment');
    expect(JSON.stringify(result)).not.toContain('legacy-secret');
  });

  test('uses a configured legacy variable only through the core resolver', async () => {
    const result = await Effect.runPromise(makeLegacyProviderConnectionResolver({
      CUSTOM_OPENAI_KEY: 'legacy-secret',
    }).resolve('openai', 'CUSTOM_OPENAI_KEY'));

    expect(result._tag).toBe('Some');
    if (result._tag === 'Some' && result.value.credentials.kind === 'api-key') {
      expect(Redacted.value(result.value.credentials.apiKey)).toBe('legacy-secret');
    }
  });

  test('fails an explicit missing selection instead of falling back to legacy credentials', async () => {
    const missing = Schema.decodeUnknownSync(ProviderConnectionId)('b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
    const layer = makeInMemoryProviderConnectionLayer([], makeLegacyProviderConnectionResolver({
      OPENAI_API_KEY: 'legacy-secret',
    }));
    const exit = await Effect.runPromiseExit(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      return yield* service.resolve({ providerId: 'openai', namespace, connectionId: missing });
    }).pipe(Effect.provide(layer)));

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure' && exit.cause._tag === 'Fail') {
      expect(exit.cause.error).toBeInstanceOf(ProviderConnectionNotFoundError);
    }
  });

  test('keeps disabled and deleted records distinct', () => {
    expect(Schema.decodeUnknownSync(ProviderConnectionStatusSchema)('disabled')).toBe('disabled');
    expect(Schema.decodeUnknownSync(ProviderConnectionStatusSchema)('deleted')).toBe('deleted');
  });

  test('propagates a typed persistence failure instead of treating storage as infallible', async () => {
    const persistenceError = new ProviderConnectionStoreError({ operation: 'list', message: 'Provider connection storage operation failed.' });
    const store = Layer.succeed(ProviderConnectionStore, {
      list: () => Effect.fail(persistenceError),
      get: () => Effect.fail(persistenceError),
      put: () => Effect.fail(persistenceError),
      updateMetadata: () => Effect.fail(persistenceError),
      remove: () => Effect.fail(persistenceError),
    });
    const layer = ProviderConnectionServiceLive.pipe(
      Layer.provide(store),
      Layer.provide(Layer.succeed(LegacyProviderConnectionResolver, makeLegacyProviderConnectionResolver({}))),
    );
    const exit = await Effect.runPromiseExit(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      return yield* service.list(namespace);
    }).pipe(Effect.provide(layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe('Some');
      if (error._tag === 'Some') expect(error.value).toBe(persistenceError);
    }
  });

  test('isolates reads, labels, and deletes by consumer namespace', async () => {
    const layer = makeInMemoryProviderConnectionLayer([{ namespace, connection, credentials }]);
    await Effect.runPromise(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      expect(yield* service.list(otherNamespace)).toEqual([]);
      expect(Option.isNone(yield* service.get(otherNamespace, connectionId))).toBe(true);
      expect(yield* service.remove(otherNamespace, connectionId)).toBe(false);
      expect(Option.isSome(yield* service.get(namespace, connectionId))).toBe(true);
    }).pipe(Effect.provide(layer)));
  });
});
