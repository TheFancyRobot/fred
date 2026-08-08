import { describe, expect, test } from 'bun:test';
import { Cause, Effect, Exit, Layer, Redacted, Schema } from 'effect';
import {
  BUILTIN_PROVIDER_CONNECTION_CAPABILITIES,
  LOCAL_PROVIDER_CONNECTION_CAPABILITIES,
  LegacyProviderConnectionResolver,
  ProviderConnectionCredentialsSchema,
  ProviderConnectionId,
  ProviderConnectionNotFoundError,
  ProviderConnectionStore,
  ProviderConnectionStoreError,
  ProviderConnectionService,
  ProviderConnectionServiceLive,
  ProviderConnectionStatusSchema,
  makeInMemoryProviderConnectionLayer,
  makeLegacyProviderConnectionResolver,
  validateProviderConnectionCapability,
} from '../../../../packages/core/src/platform/connections';
import { AgentConfigSchema } from '../../../../packages/core/src/config/schema';
import { toAgentConfig, validateAgentFrontmatter } from '../../../../packages/core/src/agent/file-loader';

const connectionId = Schema.decodeUnknownSync(ProviderConnectionId)('a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
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
    });
    expect(decoded.connectionId).toBe(connectionId);

    validateAgentFrontmatter({
      id: 'connected-agent',
      platform: 'openai',
      model: 'gpt-4.1-mini',
      connectionId,
    }, '/tmp/connected-agent.md');
    expect(toAgentConfig({
      frontmatter: { id: 'connected-agent', platform: 'openai', model: 'gpt-4.1-mini', connectionId },
      body: 'Prompt',
      filePath: '/tmp/connected-agent.md',
    }).connectionId).toBe(connectionId);
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
        protocol: 'anthropic-compatible',
        auth: { kind: 'basic' },
      },
      LOCAL_PROVIDER_CONNECTION_CAPABILITIES,
    ));
  });

  test('uses exactly the requested saved connection and observes credential rotation', async () => {
    const layer = makeInMemoryProviderConnectionLayer([{ connection, credentials }]);
    const result = await Effect.runPromise(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      const initial = yield* service.resolve({ providerId: 'openai', connectionId });
      yield* service.put(connection, { kind: 'api-key', apiKey: Redacted.make('rotated-secret') });
      const rotated = yield* service.resolve({ providerId: 'openai', connectionId });
      return { initial, rotated };
    }).pipe(Effect.provide(layer)));

    expect(Redacted.value(result.initial.credentials.apiKey)).toBe('saved-secret');
    expect(Redacted.value(result.rotated.credentials.apiKey)).toBe('rotated-secret');
  });

  test('does not fall back to a saved connection when selection is omitted', async () => {
    const legacy = makeLegacyProviderConnectionResolver({ OPENAI_API_KEY: 'legacy-secret' });
    const layer = makeInMemoryProviderConnectionLayer([{ connection, credentials }], legacy);
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
      return yield* service.resolve({ providerId: 'openai', connectionId: missing });
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
      remove: () => Effect.fail(persistenceError),
    });
    const layer = ProviderConnectionServiceLive.pipe(
      Layer.provide(store),
      Layer.provide(Layer.succeed(LegacyProviderConnectionResolver, makeLegacyProviderConnectionResolver({}))),
    );
    const exit = await Effect.runPromiseExit(Effect.gen(function* () {
      const service = yield* ProviderConnectionService;
      return yield* service.list();
    }).pipe(Effect.provide(layer)));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.failureOption(exit.cause);
      expect(error._tag).toBe('Some');
      if (error._tag === 'Some') expect(error.value).toBe(persistenceError);
    }
  });
});
