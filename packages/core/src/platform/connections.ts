import { Context, Effect, Layer, Option, Redacted, Ref, Schema } from 'effect';

/** A persisted provider-connection identifier. */
export const ProviderConnectionId = Schema.UUID.pipe(Schema.brand('@fred/ProviderConnectionId'));
export type ProviderConnectionId = Schema.Schema.Type<typeof ProviderConnectionId>;

export const ProviderConnectionProtocolSchema = Schema.Literal(
  'openai-compatible',
  'anthropic-compatible',
);
export type ProviderConnectionProtocol = Schema.Schema.Type<typeof ProviderConnectionProtocolSchema>;

export const ProviderConnectionAuthSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('none') }),
  Schema.Struct({ kind: Schema.Literal('api-key') }),
  Schema.Struct({ kind: Schema.Literal('basic') }),
  Schema.Struct({ kind: Schema.Literal('oauth2-bearer') }),
);
export type ProviderConnectionAuth = Schema.Schema.Type<typeof ProviderConnectionAuthSchema>;
export type ProviderConnectionAuthKind = ProviderConnectionAuth['kind'];

export const ProviderLoginMethodSchema = Schema.Literal(
  'manual-secret',
  'google-installed-app',
  'openrouter-pkce-api-key',
);
export type ProviderLoginMethod = Schema.Schema.Type<typeof ProviderLoginMethodSchema>;

export const ProviderConnectionStatusSchema = Schema.Literal('active', 'disabled', 'deleted');
export type ProviderConnectionStatus = Schema.Schema.Type<typeof ProviderConnectionStatusSchema>;

/** Public, non-secret connection metadata. */
export const ProviderConnectionSchema = Schema.Struct({
  id: ProviderConnectionId,
  label: Schema.String,
  providerId: Schema.String,
  endpoint: Schema.optional(Schema.String),
  protocol: Schema.optional(ProviderConnectionProtocolSchema),
  auth: ProviderConnectionAuthSchema,
  status: ProviderConnectionStatusSchema,
});
export type ProviderConnection = Schema.Schema.Type<typeof ProviderConnectionSchema>;

/** An unsaved connection. It intentionally has no identifier or secret fields. */
export const ProviderConnectionDraftSchema = Schema.Struct({
  label: Schema.String,
  providerId: Schema.String,
  endpoint: Schema.optional(Schema.String),
  protocol: Schema.optional(ProviderConnectionProtocolSchema),
  auth: ProviderConnectionAuthSchema,
});
export type ProviderConnectionDraft = Schema.Schema.Type<typeof ProviderConnectionDraftSchema>;

/** Runtime-only credentials. `Redacted` keeps JSON/log output secret-safe. */
export const ProviderConnectionCredentialsSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal('none') }),
  Schema.Struct({ kind: Schema.Literal('api-key'), apiKey: Schema.Redacted(Schema.String) }),
  Schema.Struct({
    kind: Schema.Literal('basic'),
    username: Schema.Redacted(Schema.String),
    password: Schema.Redacted(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal('oauth2-bearer'),
    accessToken: Schema.Redacted(Schema.String),
    refreshToken: Schema.optional(Schema.Redacted(Schema.String)),
  }),
);
export type ProviderConnectionCredentials = Schema.Schema.Type<typeof ProviderConnectionCredentialsSchema>;

export interface ResolvedProviderConnection {
  readonly source: 'saved' | 'legacy-environment';
  readonly connection: ProviderConnection | ProviderConnectionDraft;
  readonly credentials: ProviderConnectionCredentials;
}

export interface ProviderConnectionCapabilities {
  readonly providerId: string;
  readonly auth: readonly ProviderConnectionAuthKind[];
  readonly login: readonly ProviderLoginMethod[];
  readonly protocols?: readonly ProviderConnectionProtocol[];
}

/** The documented baseline. Provider packages can declare a narrower override. */
export const BUILTIN_PROVIDER_CONNECTION_CAPABILITIES: readonly ProviderConnectionCapabilities[] = [
  { providerId: 'openai', auth: ['api-key'], login: ['manual-secret'] },
  { providerId: 'anthropic', auth: ['api-key'], login: ['manual-secret'] },
  { providerId: 'groq', auth: ['api-key'], login: ['manual-secret'] },
  { providerId: 'minimax', auth: ['api-key'], login: ['manual-secret'] },
  { providerId: 'google', auth: ['api-key', 'oauth2-bearer'], login: ['manual-secret', 'google-installed-app'] },
  { providerId: 'openrouter', auth: ['api-key'], login: ['manual-secret', 'openrouter-pkce-api-key'] },
];

export const LOCAL_PROVIDER_CONNECTION_CAPABILITIES: ProviderConnectionCapabilities = {
  providerId: 'local-compatible',
  auth: ['none', 'api-key', 'basic'],
  login: ['manual-secret'],
  protocols: ['openai-compatible', 'anthropic-compatible'],
};

export class InvalidProviderConnectionIdError extends Schema.TaggedError<InvalidProviderConnectionIdError>()(
  'InvalidProviderConnectionIdError',
  { value: Schema.String, message: Schema.String },
) {}

export class ProviderConnectionNotFoundError extends Schema.TaggedError<ProviderConnectionNotFoundError>()(
  'ProviderConnectionNotFoundError',
  { connectionId: ProviderConnectionId, message: Schema.String },
) {}

export class ProviderConnectionProviderMismatchError extends Schema.TaggedError<ProviderConnectionProviderMismatchError>()(
  'ProviderConnectionProviderMismatchError',
  { connectionId: ProviderConnectionId, expectedProviderId: Schema.String, actualProviderId: Schema.String, message: Schema.String },
) {}

export class ProviderConnectionDisabledError extends Schema.TaggedError<ProviderConnectionDisabledError>()(
  'ProviderConnectionDisabledError',
  { connectionId: ProviderConnectionId, message: Schema.String },
) {}

export class ProviderConnectionDeletedError extends Schema.TaggedError<ProviderConnectionDeletedError>()(
  'ProviderConnectionDeletedError',
  { connectionId: ProviderConnectionId, message: Schema.String },
) {}

export class UnsupportedProviderConnectionAuthError extends Schema.TaggedError<UnsupportedProviderConnectionAuthError>()(
  'UnsupportedProviderConnectionAuthError',
  { providerId: Schema.String, authKind: Schema.String, message: Schema.String },
) {}

export class UnsupportedProviderLoginMethodError extends Schema.TaggedError<UnsupportedProviderLoginMethodError>()(
  'UnsupportedProviderLoginMethodError',
  { providerId: Schema.String, loginMethod: Schema.String, message: Schema.String },
) {}

export class MalformedLegacyProviderEnvironmentError extends Schema.TaggedError<MalformedLegacyProviderEnvironmentError>()(
  'MalformedLegacyProviderEnvironmentError',
  { providerId: Schema.String, variable: Schema.String, message: Schema.String },
) {}

export class LegacyProviderConnectionNotConfiguredError extends Schema.TaggedError<LegacyProviderConnectionNotConfiguredError>()(
  'LegacyProviderConnectionNotConfiguredError',
  { providerId: Schema.String, message: Schema.String },
) {}

export class ProviderConnectionTestError extends Schema.TaggedError<ProviderConnectionTestError>()(
  'ProviderConnectionTestError',
  { providerId: Schema.String, message: Schema.String },
) {}

/** A persistence implementation failed without exposing provider credentials. */
export class ProviderConnectionStoreError extends Schema.TaggedError<ProviderConnectionStoreError>()(
  'ProviderConnectionStoreError',
  { operation: Schema.String, message: Schema.String },
) {}

export type ProviderConnectionError =
  | ProviderConnectionNotFoundError
  | ProviderConnectionProviderMismatchError
  | ProviderConnectionDisabledError
  | ProviderConnectionDeletedError
  | UnsupportedProviderConnectionAuthError
  | UnsupportedProviderLoginMethodError
  | MalformedLegacyProviderEnvironmentError
  | LegacyProviderConnectionNotConfiguredError
  | ProviderConnectionStoreError;

/** Decode a raw ID at a trust boundary without leaking Effect parse details. */
export const decodeProviderConnectionId = (
  value: unknown,
): Effect.Effect<ProviderConnectionId, InvalidProviderConnectionIdError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(ProviderConnectionId)(value),
    catch: () => new InvalidProviderConnectionIdError({
      value: typeof value === 'string' ? value : String(value),
      message: 'Provider connection id must be a UUID.',
    }),
  });

/** Check an auth/login declaration before persisting or testing a connection. */
export const validateProviderConnectionCapability = (
  draft: ProviderConnectionDraft,
  capabilities: ProviderConnectionCapabilities,
  loginMethod?: ProviderLoginMethod,
): Effect.Effect<void, UnsupportedProviderConnectionAuthError | UnsupportedProviderLoginMethodError> => {
  if (!capabilities.auth.includes(draft.auth.kind)) {
    return Effect.fail(new UnsupportedProviderConnectionAuthError({
      providerId: draft.providerId,
      authKind: draft.auth.kind,
      message: `Provider "${draft.providerId}" does not support ${draft.auth.kind} authentication.`,
    }));
  }
  if (loginMethod !== undefined && !capabilities.login.includes(loginMethod)) {
    return Effect.fail(new UnsupportedProviderLoginMethodError({
      providerId: draft.providerId,
      loginMethod,
      message: `Provider "${draft.providerId}" does not support ${loginMethod} login.`,
    }));
  }
  if (draft.protocol !== undefined && !capabilities.protocols?.includes(draft.protocol)) {
    return Effect.fail(new UnsupportedProviderConnectionAuthError({
      providerId: draft.providerId,
      authKind: draft.protocol,
      message: `Provider "${draft.providerId}" does not support ${draft.protocol}.`,
    }));
  }
  return Effect.void;
};

/** Provider-owned hook for testing an unsaved draft; persistence stays out of provider packages. */
export interface ProviderConnectionTestHook {
  readonly test: (
    draft: ProviderConnectionDraft,
    credentials: ProviderConnectionCredentials,
  ) => Effect.Effect<void, ProviderConnectionTestError>;
}

interface StoredProviderConnection {
  readonly connection: ProviderConnection;
  readonly credentials: ProviderConnectionCredentials;
}

/** Persistence boundary implemented by the Postgres package in Step 04. */
export interface ProviderConnectionStore {
  readonly list: () => Effect.Effect<readonly ProviderConnection[], ProviderConnectionStoreError>;
  readonly get: (id: ProviderConnectionId) => Effect.Effect<Option.Option<StoredProviderConnection>, ProviderConnectionStoreError>;
  readonly put: (record: StoredProviderConnection) => Effect.Effect<void, ProviderConnectionStoreError>;
  readonly remove: (id: ProviderConnectionId) => Effect.Effect<boolean, ProviderConnectionStoreError>;
}
export const ProviderConnectionStore = Context.GenericTag<ProviderConnectionStore>('@fred/ProviderConnectionStore');

/** Environment compatibility is injected; provider packages and this resolver never read it directly. */
export interface LegacyProviderConnectionResolver {
  readonly resolve: (
    providerId: string,
    apiKeyEnvVar?: string,
  ) => Effect.Effect<Option.Option<ResolvedProviderConnection>, MalformedLegacyProviderEnvironmentError>;
}
export const LegacyProviderConnectionResolver = Context.GenericTag<LegacyProviderConnectionResolver>(
  '@fred/LegacyProviderConnectionResolver',
);

export interface ProviderConnectionService {
  readonly list: () => Effect.Effect<readonly ProviderConnection[], ProviderConnectionStoreError>;
  readonly get: (id: ProviderConnectionId) => Effect.Effect<Option.Option<ProviderConnection>, ProviderConnectionStoreError>;
  readonly put: (connection: ProviderConnection, credentials: ProviderConnectionCredentials) => Effect.Effect<void, ProviderConnectionStoreError>;
  readonly remove: (id: ProviderConnectionId) => Effect.Effect<boolean, ProviderConnectionStoreError>;
  readonly resolve: (request: {
    readonly providerId: string;
    readonly connectionId?: ProviderConnectionId;
    readonly apiKeyEnvVar?: string;
  }) => Effect.Effect<ResolvedProviderConnection, ProviderConnectionError>;
}
export const ProviderConnectionService = Context.GenericTag<ProviderConnectionService>('@fred/ProviderConnectionService');

export const ProviderConnectionServiceLive = Layer.effect(
  ProviderConnectionService,
  Effect.gen(function* () {
    const store = yield* ProviderConnectionStore;
    const legacy = yield* LegacyProviderConnectionResolver;
    return {
      list: store.list,
      get: (id) => Effect.map(store.get(id), Option.map((record) => record.connection)),
      put: (connection, credentials) => store.put({ connection, credentials }),
      remove: store.remove,
      resolve: ({ providerId, connectionId, apiKeyEnvVar }) => {
        if (connectionId === undefined) {
          return legacy.resolve(providerId, apiKeyEnvVar).pipe(
            Effect.flatMap(Option.match({
              onNone: () => Effect.fail(new LegacyProviderConnectionNotConfiguredError({
                providerId,
                message: `No legacy environment credentials are configured for provider "${providerId}".`,
              })),
              onSome: Effect.succeed,
            })),
          );
        }
        return Effect.gen(function* () {
          const result = yield* store.get(connectionId);
          if (Option.isNone(result)) {
            return yield* new ProviderConnectionNotFoundError({
              connectionId,
              message: `Provider connection "${connectionId}" was not found.`,
            });
          }
          const record = result.value;
          if (record.connection.providerId !== providerId) {
            return yield* new ProviderConnectionProviderMismatchError({
              connectionId,
              expectedProviderId: providerId,
              actualProviderId: record.connection.providerId,
              message: `Provider connection "${connectionId}" belongs to "${record.connection.providerId}".`,
            });
          }
          if (record.connection.status === 'disabled') {
            return yield* new ProviderConnectionDisabledError({
              connectionId,
              message: `Provider connection "${connectionId}" is disabled.`,
            });
          }
          if (record.connection.status === 'deleted') {
            return yield* new ProviderConnectionDeletedError({
              connectionId,
              message: `Provider connection "${connectionId}" is deleted.`,
            });
          }
          return { source: 'saved' as const, connection: record.connection, credentials: record.credentials };
        });
      },
    } satisfies ProviderConnectionService;
  }),
);

const legacyEnvironmentVariableByProvider: Readonly<Record<string, string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_GENERATIVE_AI_API_KEY',
  groq: 'GROQ_API_KEY',
  minimax: 'MINIMAX_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
};

/** Build the compatibility adapter from a supplied environment snapshot. */
export const makeLegacyProviderConnectionResolver = (
  environment: Readonly<Record<string, string | undefined>>,
): LegacyProviderConnectionResolver => ({
  resolve: (providerId, apiKeyEnvVar) => {
    const variable = apiKeyEnvVar ?? legacyEnvironmentVariableByProvider[providerId.toLowerCase()];
    if (variable === undefined) return Effect.succeed(Option.none());
    const apiKey = environment[variable];
    if (apiKey === undefined || apiKey.trim().length === 0) return Effect.succeed(Option.none());
    if (apiKey !== apiKey.trim()) {
      return Effect.fail(new MalformedLegacyProviderEnvironmentError({
        providerId,
        variable,
        message: `${variable} must not have leading or trailing whitespace.`,
      }));
    }
    return Effect.succeed(Option.some({
      source: 'legacy-environment' as const,
      connection: { label: 'Legacy environment', providerId, auth: { kind: 'api-key' as const } },
      credentials: { kind: 'api-key' as const, apiKey: Redacted.make(apiKey) },
    }));
  },
});

/** A mutable, no-I/O layer for unit tests and local composition. */
export const makeInMemoryProviderConnectionLayer = (
  records: readonly StoredProviderConnection[] = [],
  legacy: LegacyProviderConnectionResolver = makeLegacyProviderConnectionResolver({}),
): Layer.Layer<ProviderConnectionService> => {
  const storeLayer = Layer.effect(
    ProviderConnectionStore,
    Effect.gen(function* () {
      const state = yield* Ref.make(new Map(records.map((record) => [record.connection.id, record])));
      return {
        list: () => Effect.map(Ref.get(state), (stored) => Array.from(stored.values(), (record) => record.connection)),
        get: (id) => Effect.map(Ref.get(state), (stored) => Option.fromNullable(stored.get(id))),
        put: (record) => Ref.update(state, (stored) => new Map(stored).set(record.connection.id, record)),
        remove: (id) => Ref.modify(state, (stored) => {
          const exists = stored.has(id);
          if (!exists) return [false, stored] as const;
          const next = new Map(stored);
          next.delete(id);
          return [true, next] as const;
        }),
      } satisfies ProviderConnectionStore;
    }),
  );
  return ProviderConnectionServiceLive.pipe(
    Layer.provide(storeLayer),
    Layer.provide(Layer.succeed(LegacyProviderConnectionResolver, legacy)),
  );
};
