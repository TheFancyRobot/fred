import { Context, Effect, Layer, Option, Redacted, Ref, Schema } from 'effect';
import type { ProviderConfig, ProviderDefinition } from './provider';

/** A persisted provider-connection identifier. */
export const ProviderConnectionId = Schema.UUID.pipe(Schema.brand('@fred/ProviderConnectionId'));
export type ProviderConnectionId = Schema.Schema.Type<typeof ProviderConnectionId>;

/** Consumer-owned isolation boundary for persisted provider connections. */
export const ProviderConnectionNamespace = Schema.String.pipe(
  Schema.minLength(1),
  Schema.brand('@fred/ProviderConnectionNamespace'),
);
export type ProviderConnectionNamespace = Schema.Schema.Type<typeof ProviderConnectionNamespace>;

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

export type ResolvedProviderConnection = {
  readonly source: 'saved';
  readonly connection: ProviderConnection;
  readonly credentials: ProviderConnectionCredentials;
  readonly credentialVersion: number;
  readonly expiresAt: Date | undefined;
} | {
  readonly source: 'legacy-environment';
  readonly connection: ProviderConnectionDraft;
  readonly credentials: ProviderConnectionCredentials;
};

export interface ProviderConnectionPrepareContext {
  readonly reload: () => Effect.Effect<ResolvedProviderConnection, ProviderConnectionError>;
  readonly compareAndSetCredentials: (
    credentials: ProviderConnectionCredentials,
    expectedVersion: number,
    expiresAt?: Date,
  ) => Effect.Effect<boolean, ProviderConnectionStoreError>;
}

export type ProviderConnectionPrepare = (
  resolved: ResolvedProviderConnection,
  context: ProviderConnectionPrepareContext,
) => Effect.Effect<ResolvedProviderConnection, Error>;

export type ProviderConnectionPrepareFactory = (config: ProviderConfig) => ProviderConnectionPrepare;

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

/** Resolve the concrete provider pack used by a hosted or local-compatible connection. */
export const providerConnectionRuntimeProviderId = (
  connection: ProviderConnection | ProviderConnectionDraft,
): string | undefined => {
  if (connection.providerId !== LOCAL_PROVIDER_CONNECTION_CAPABILITIES.providerId) {
    return connection.providerId;
  }
  if (connection.protocol === 'openai-compatible') return 'openai';
  if (connection.protocol === 'anthropic-compatible') return 'anthropic';
  return undefined;
};

export class InvalidProviderConnectionIdError extends Schema.TaggedError<InvalidProviderConnectionIdError>()(
  'InvalidProviderConnectionIdError',
  { value: Schema.String, message: Schema.String },
) {}

export class InvalidProviderConnectionNamespaceError extends Schema.TaggedError<InvalidProviderConnectionNamespaceError>()(
  'InvalidProviderConnectionNamespaceError',
  { value: Schema.String, message: Schema.String },
) {}

export class ProviderConnectionNamespaceRequiredError extends Schema.TaggedError<ProviderConnectionNamespaceRequiredError>()(
  'ProviderConnectionNamespaceRequiredError',
  { connectionId: ProviderConnectionId, message: Schema.String },
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

export class InvalidLocalProviderConnectionError extends Schema.TaggedError<InvalidLocalProviderConnectionError>()(
  'InvalidLocalProviderConnectionError',
  { message: Schema.String },
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
  {
    providerId: Schema.String,
    reason: Schema.Literal('configuration', 'connectivity', 'authentication', 'timeout', 'upstream'),
    statusCode: Schema.optional(Schema.Number),
    message: Schema.String,
  },
) {}

export class ProviderConnectionPreparationRequiredError extends Schema.TaggedError<ProviderConnectionPreparationRequiredError>()(
  'ProviderConnectionPreparationRequiredError',
  {
    providerId: Schema.String,
    connectionId: ProviderConnectionId,
    message: Schema.String,
  },
) {}

/** A persistence implementation failed without exposing provider credentials. */
export class ProviderConnectionStoreError extends Schema.TaggedError<ProviderConnectionStoreError>()(
  'ProviderConnectionStoreError',
  { operation: Schema.String, message: Schema.String },
) {}

/** Metadata-only updates cannot change fields bound into the credential envelope. */
export class ProviderConnectionIdentityChangeError extends Schema.TaggedError<ProviderConnectionIdentityChangeError>()(
  'ProviderConnectionIdentityChangeError',
  { connectionId: ProviderConnectionId, message: Schema.String },
) {}

export type ProviderConnectionError =
  | ProviderConnectionNotFoundError
  | ProviderConnectionProviderMismatchError
  | ProviderConnectionDisabledError
  | ProviderConnectionDeletedError
  | ProviderConnectionNamespaceRequiredError
  | UnsupportedProviderConnectionAuthError
  | UnsupportedProviderLoginMethodError
  | MalformedLegacyProviderEnvironmentError
  | LegacyProviderConnectionNotConfiguredError
  | ProviderConnectionPreparationRequiredError
  | ProviderConnectionIdentityChangeError
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

/** Decode a consumer-owned namespace at a trust boundary. */
export const decodeProviderConnectionNamespace = (
  value: unknown,
): Effect.Effect<ProviderConnectionNamespace, InvalidProviderConnectionNamespaceError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(ProviderConnectionNamespace)(value),
    catch: () => new InvalidProviderConnectionNamespaceError({
      value: typeof value === 'string' ? value : String(value),
      message: 'Provider connection namespace must be a non-empty string.',
    }),
  });

/** Check an auth/login declaration before persisting or testing a connection. */
export const validateProviderConnectionCapability = (
  draft: ProviderConnectionDraft,
  capabilities: ProviderConnectionCapabilities,
  loginMethod?: ProviderLoginMethod,
): Effect.Effect<void, InvalidLocalProviderConnectionError | UnsupportedProviderConnectionAuthError | UnsupportedProviderLoginMethodError> => {
  if (
    capabilities.providerId === LOCAL_PROVIDER_CONNECTION_CAPABILITIES.providerId
    && (draft.endpoint === undefined || draft.protocol === undefined)
  ) {
    return Effect.fail(new InvalidLocalProviderConnectionError({
      message: 'Local-compatible provider connections require an explicit endpoint and protocol.',
    }));
  }
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
  readonly credentialVersion?: number;
  readonly expiresAt?: Date;
}

/** Persistence boundary implemented by the Postgres package in Step 04. */
export interface ProviderConnectionStore {
  readonly list: (namespace: ProviderConnectionNamespace) => Effect.Effect<readonly ProviderConnection[], ProviderConnectionStoreError>;
  readonly get: (namespace: ProviderConnectionNamespace, id: ProviderConnectionId) => Effect.Effect<Option.Option<StoredProviderConnection>, ProviderConnectionStoreError>;
  readonly put: (namespace: ProviderConnectionNamespace, record: StoredProviderConnection) => Effect.Effect<void, ProviderConnectionStoreError>;
  readonly updateMetadata: (namespace: ProviderConnectionNamespace, connection: ProviderConnection) => Effect.Effect<boolean, ProviderConnectionIdentityChangeError | ProviderConnectionStoreError>;
  readonly compareAndSetCredentials: (
    namespace: ProviderConnectionNamespace,
    id: ProviderConnectionId,
    credentials: ProviderConnectionCredentials,
    expectedVersion: number,
    expiresAt?: Date,
  ) => Effect.Effect<boolean, ProviderConnectionStoreError>;
  readonly remove: (namespace: ProviderConnectionNamespace, id: ProviderConnectionId) => Effect.Effect<boolean, ProviderConnectionStoreError>;
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
  readonly list: (namespace: ProviderConnectionNamespace) => Effect.Effect<readonly ProviderConnection[], ProviderConnectionStoreError>;
  readonly get: (namespace: ProviderConnectionNamespace, id: ProviderConnectionId) => Effect.Effect<Option.Option<ProviderConnection>, ProviderConnectionStoreError>;
  readonly put: (
    namespace: ProviderConnectionNamespace,
    connection: ProviderConnection,
    credentials: ProviderConnectionCredentials,
    expiresAt?: Date,
  ) => Effect.Effect<void, ProviderConnectionStoreError>;
  readonly updateMetadata: (namespace: ProviderConnectionNamespace, connection: ProviderConnection) => Effect.Effect<boolean, ProviderConnectionIdentityChangeError | ProviderConnectionStoreError>;
  readonly compareAndSetCredentials: ProviderConnectionStore['compareAndSetCredentials'];
  readonly remove: (namespace: ProviderConnectionNamespace, id: ProviderConnectionId) => Effect.Effect<boolean, ProviderConnectionStoreError>;
  readonly resolve: (request: {
    readonly providerId: string;
    readonly connectionId: ProviderConnectionId;
    readonly namespace: ProviderConnectionNamespace;
    readonly apiKeyEnvVar?: string;
  } | {
    readonly providerId: string;
    readonly connectionId?: undefined;
    readonly namespace?: undefined;
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
      get: (namespace, id) => Effect.map(store.get(namespace, id), Option.map((record) => record.connection)),
      put: (namespace, connection, credentials, expiresAt) => store.put(namespace, { connection, credentials, expiresAt }),
      updateMetadata: store.updateMetadata,
      compareAndSetCredentials: store.compareAndSetCredentials,
      remove: store.remove,
      resolve: ({ providerId, connectionId, namespace, apiKeyEnvVar }) => {
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
          const result = yield* store.get(namespace, connectionId);
          if (Option.isNone(result)) {
            return yield* new ProviderConnectionNotFoundError({
              connectionId,
              message: `Provider connection "${connectionId}" was not found.`,
            });
          }
          const record = result.value;
          if (providerConnectionRuntimeProviderId(record.connection) !== providerId) {
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
          return {
            source: 'saved' as const,
            connection: record.connection,
            credentials: record.credentials,
            credentialVersion: record.credentialVersion ?? 1,
            expiresAt: record.expiresAt,
          };
        });
      },
    } satisfies ProviderConnectionService;
  }),
);

export const resolveProviderConnectionForUse = (
  service: ProviderConnectionService,
  provider: ProviderDefinition | undefined,
  request: Parameters<ProviderConnectionService['resolve']>[0],
): Effect.Effect<ResolvedProviderConnection, Error> => service.resolve(request).pipe(
  Effect.flatMap((resolved) => {
    if (resolved.source !== 'saved') return Effect.succeed(resolved);
    if (provider?.connectionPrepare === undefined) {
      if (
        resolved.credentials.kind === 'oauth2-bearer'
        && (resolved.expiresAt === undefined || resolved.expiresAt.getTime() <= Date.now())
      ) {
        return Effect.fail(new ProviderConnectionPreparationRequiredError({
          providerId: resolved.connection.providerId,
          connectionId: resolved.connection.id,
          message: `Provider "${resolved.connection.providerId}" must be registered with OAuth configuration before this connection can be refreshed.`,
        }));
      }
      return Effect.succeed(resolved);
    }
    if (request.connectionId === undefined || request.namespace === undefined) return Effect.succeed(resolved);
    return provider.connectionPrepare(resolved, {
      reload: () => service.resolve(request),
      compareAndSetCredentials: (credentials, expectedVersion, expiresAt) => service.compareAndSetCredentials(
        request.namespace,
        resolved.connection.id,
        credentials,
        expectedVersion,
        expiresAt,
      ),
    });
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
  records: readonly (StoredProviderConnection & { readonly namespace: ProviderConnectionNamespace })[] = [],
  legacy: LegacyProviderConnectionResolver = makeLegacyProviderConnectionResolver({}),
): Layer.Layer<ProviderConnectionService> => {
  type InMemoryEntry = { readonly namespace: ProviderConnectionNamespace; readonly record: StoredProviderConnection };
  type InMemoryState = Map<ProviderConnectionId, InMemoryEntry>;
  type MetadataUpdateResult = { readonly _tag: 'Missing' | 'IdentityChange' | 'Updated' };
  const storeLayer = Layer.effect(
    ProviderConnectionStore,
    Effect.gen(function* () {
      const state = yield* Ref.make<InMemoryState>(new Map(
        records.map(({ namespace, ...record }) => [record.connection.id, { namespace, record }]),
      ));
      return {
        list: (namespace) => Effect.map(Ref.get(state), (stored) => Array.from(stored.values())
          .filter((entry) => entry.namespace === namespace)
          .map((entry) => entry.record.connection)),
        get: (namespace, id) => Effect.map(Ref.get(state), (stored) => {
          const entry = stored.get(id);
          return entry?.namespace === namespace ? Option.some(entry.record) : Option.none();
        }),
        put: (namespace, record) => Ref.modify(state, (stored) => {
          const existing = stored.get(record.connection.id);
          if (existing !== undefined && existing.namespace !== namespace) return [false, stored] as const;
          return [true, new Map(stored).set(record.connection.id, {
            namespace,
            record: {
              ...record,
              credentialVersion: (existing?.record.credentialVersion ?? 0) + 1,
              expiresAt: record.expiresAt ?? existing?.record.expiresAt,
            },
          })] as const;
        }).pipe(Effect.flatMap((saved) => saved
          ? Effect.void
          : Effect.fail(new ProviderConnectionStoreError({
            operation: 'put',
            message: 'Provider connection storage operation failed.',
          })))),
        updateMetadata: (namespace, connection) => Ref.modify(state, (stored): readonly [MetadataUpdateResult, InMemoryState] => {
          const existing = stored.get(connection.id);
          if (existing === undefined || existing.namespace !== namespace) return [{ _tag: 'Missing' as const }, stored] as const;
          if (
            existing.record.connection.providerId !== connection.providerId
            || existing.record.connection.auth.kind !== connection.auth.kind
          ) return [{ _tag: 'IdentityChange' as const }, stored] as const;
          return [
            { _tag: 'Updated' as const },
            new Map(stored).set(connection.id, {
              namespace,
              record: { ...existing.record, connection },
            }),
          ] as const;
        }).pipe(Effect.flatMap((result) => {
          if (result._tag === 'Missing') return Effect.succeed(false);
          if (result._tag === 'IdentityChange') {
            return Effect.fail(new ProviderConnectionIdentityChangeError({
              connectionId: connection.id,
              message: 'Provider identity and authentication kind require matching credential replacement.',
            }));
          }
          return Effect.succeed(true);
        })),
        compareAndSetCredentials: (namespace, id, nextCredentials, expectedVersion, expiresAt) => Ref.modify(state, (stored) => {
          const existing = stored.get(id);
          if (
            existing === undefined
            || existing.namespace !== namespace
            || (existing.record.credentialVersion ?? 1) !== expectedVersion
          ) return [false, stored] as const;
          return [true, new Map(stored).set(id, {
            namespace,
            record: {
              ...existing.record,
              credentials: nextCredentials,
              credentialVersion: expectedVersion + 1,
              expiresAt,
            },
          })] as const;
        }),
        remove: (namespace, id) => Ref.modify(state, (stored) => {
          const existing = stored.get(id);
          if (existing === undefined || existing.namespace !== namespace) return [false, stored] as const;
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
