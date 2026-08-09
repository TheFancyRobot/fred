import { Effect, Redacted, Schema } from 'effect';
import {
  LOCAL_PROVIDER_CONNECTION_CAPABILITIES,
  ProviderConnectionEndpointSchema,
  ProviderConnectionTestError,
  providerConnectionRuntimeProviderId,
  validateProviderConnectionCapability,
  type ProviderConnectionCredentials,
  type ProviderConnectionDraft,
  type ProviderConnectionTestHook,
} from './connections';
import { loadProviderPackEffect } from './loader';

const DEFAULT_TIMEOUT_MS = 10_000;

export interface ProviderConnectionProbeRequest {
  readonly url: string;
  readonly init?: RequestInit;
}

export interface ProviderConnectionProbeOptions {
  readonly providerId: string;
  readonly request: (
    draft: ProviderConnectionDraft,
    credentials: ProviderConnectionCredentials,
  ) => ProviderConnectionProbeRequest;
  readonly timeoutMs?: number;
}

class ProbeStatusError {
  constructor(readonly status: number) {}
}

class ProbeTimeoutError {}

/** Join a provider base URL and a bounded probe path without dropping a base path. */
export const providerConnectionProbeUrl = (
  draft: ProviderConnectionDraft,
  defaultBaseUrl: string,
  path: string,
): URL => {
  const endpoint = Schema.decodeUnknownSync(ProviderConnectionEndpointSchema)(draft.endpoint ?? defaultBaseUrl);
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/$/, '')}/${path.replace(/^\//, '')}`;
  return url;
};

/** Build the supported runtime authorization header without exposing its value in errors. */
export const providerConnectionProbeAuthHeaders = (
  credentials: ProviderConnectionCredentials,
  apiKeyHeader: 'authorization' | 'x-api-key' = 'authorization',
): Record<string, string> => {
  if (credentials.kind === 'none') return {};
  if (credentials.kind === 'basic') {
    const value = Buffer.from(
      `${Redacted.value(credentials.username)}:${Redacted.value(credentials.password)}`,
    ).toString('base64');
    return { authorization: `Basic ${value}` };
  }
  const secret = credentials.kind === 'api-key'
    ? Redacted.value(credentials.apiKey)
    : Redacted.value(credentials.accessToken);
  return apiKeyHeader === 'x-api-key'
    ? { 'x-api-key': secret }
    : { authorization: `Bearer ${secret}` };
};

/** Create one provider-owned, bounded HTTP probe with typed and secret-safe failures. */
export const makeProviderConnectionTestHook = (
  options: ProviderConnectionProbeOptions,
): ProviderConnectionTestHook => ({
  test: (draft, credentials) => Effect.try({
    try: () => options.request(draft, credentials),
    catch: () => new ProviderConnectionTestError({
      providerId: options.providerId,
      reason: 'configuration',
      message: `Provider "${options.providerId}" connection test configuration is invalid.`,
    }),
  }).pipe(Effect.flatMap((request) => Effect.tryPromise({
    try: async () => {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new ProbeTimeoutError());
          }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        });
        const response = await Promise.race([
          globalThis.fetch(request.url, { ...request.init, signal: controller.signal }),
          timeout,
        ]);
        await response.body?.cancel().catch(() => undefined);
        if (!response.ok) throw new ProbeStatusError(response.status);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
    catch: (cause) => {
      if (cause instanceof ProbeTimeoutError) {
        return new ProviderConnectionTestError({
          providerId: options.providerId,
          reason: 'timeout',
          message: `Provider "${options.providerId}" connection test timed out.`,
        });
      }
      if (cause instanceof ProbeStatusError) {
        return new ProviderConnectionTestError({
          providerId: options.providerId,
          reason: cause.status === 401 || cause.status === 403 ? 'authentication' : 'upstream',
          statusCode: cause.status,
          message: `Provider "${options.providerId}" rejected the connection test (HTTP ${cause.status}).`,
        });
      }
      return new ProviderConnectionTestError({
        providerId: options.providerId,
        reason: 'connectivity',
        message: `Provider "${options.providerId}" connection test failed.`,
      });
    },
  }))),
});

/** Test an unsaved connection through its concrete provider pack. */
export const testProviderConnectionDraft = (
  draft: ProviderConnectionDraft,
  credentials: ProviderConnectionCredentials,
): Effect.Effect<void, ProviderConnectionTestError> => Effect.gen(function* () {
  if (draft.auth.kind !== credentials.kind) {
    return yield* new ProviderConnectionTestError({
      providerId: draft.providerId,
      reason: 'configuration',
      message: 'Provider connection authentication and credential kinds must match.',
    });
  }
  const providerId = providerConnectionRuntimeProviderId(draft);
  if (providerId === undefined) {
    return yield* new ProviderConnectionTestError({
      providerId: draft.providerId,
      reason: 'configuration',
      message: 'Local-compatible provider connection requires a supported protocol.',
    });
  }
  const factory = yield* loadProviderPackEffect(providerId).pipe(
    Effect.mapError(() => new ProviderConnectionTestError({
      providerId,
      reason: 'configuration',
      message: `Provider "${providerId}" package is not available.`,
    })),
  );
  const capabilities = draft.providerId === LOCAL_PROVIDER_CONNECTION_CAPABILITIES.providerId
    ? LOCAL_PROVIDER_CONNECTION_CAPABILITIES
    : factory.connectionCapabilities;
  if (capabilities === undefined || factory.connectionTest === undefined) {
    return yield* new ProviderConnectionTestError({
      providerId,
      reason: 'configuration',
      message: `Provider "${providerId}" does not declare connection testing support.`,
    });
  }
  yield* validateProviderConnectionCapability(draft, capabilities).pipe(
    Effect.mapError((error) => new ProviderConnectionTestError({
      providerId,
      reason: 'configuration',
      message: error.message,
    })),
  );
  return yield* factory.connectionTest.test(draft, credentials);
});
