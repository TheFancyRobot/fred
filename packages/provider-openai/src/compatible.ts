import type * as OpenRouterAdapter from '@effect/ai-openrouter';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import { Data, Effect, Either } from 'effect';
import {
  makeProviderConnectionTestHook,
  providerApiKey,
  providerAuthTransform,
  providerConnectionProbeAuthHeaders,
  providerConnectionProbeUrl,
  type EffectProviderFactory,
  type ProviderConfig,
  type ProviderDefinition,
  type ProviderModelDefaults,
} from '@fancyrobot/fred';

/**
 * The stable machine-readable reasons a generic OpenAI-compatible provider
 * configuration can be rejected.
 */
export type OpenAiCompatibleConfigErrorReason =
  | 'missing-base-url'
  | 'invalid-url'
  | 'unsupported-scheme'
  | 'userinfo'
  | 'query-string'
  | 'fragment'
  | 'authorization-header'
  | 'unsupported-credential-kind';

/**
 * Typed failure for invalid generic OpenAI-compatible provider configuration.
 *
 * `reason` is a stable machine-readable discriminator. `message` is safe to
 * surface to users and logs: it never includes credentials, custom header
 * values, or the full base URL (which may carry sensitive query data).
 */
export class InvalidOpenAiCompatibleProviderConfigError extends Data.TaggedError(
  'InvalidOpenAiCompatibleProviderConfigError'
)<{
  readonly reason: OpenAiCompatibleConfigErrorReason;
  readonly message: string;
}> {}

/** Options for creating a generic OpenAI-compatible provider factory. */
export interface OpenAiCompatibleProviderFactoryOptions {
  readonly id: string;
  readonly aliases?: readonly string[];
}

type CompatibleConfigError = InvalidOpenAiCompatibleProviderConfigError;

const failConfig = (reason: OpenAiCompatibleConfigErrorReason, message: string): Effect.Effect<never, CompatibleConfigError> =>
  Effect.fail(new InvalidOpenAiCompatibleProviderConfigError({ reason, message }));

/**
 * Validates the base URL of a generic compatible endpoint.
 *
 * Accepts only absolute http/https URLs without userinfo, query, or fragment.
 * Path prefixes such as `/v1` are preserved so the adapter's single
 * `/chat/completions` suffix resolves exactly once.
 */
const validateBaseUrl = (baseUrl: string | undefined): Effect.Effect<URL, CompatibleConfigError> => {
  if (baseUrl === undefined || baseUrl.trim() === '') {
    return failConfig('missing-base-url', 'baseUrl is required for OpenAI-compatible providers.');
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return failConfig('invalid-url', 'baseUrl must be an absolute URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return failConfig('unsupported-scheme', `baseUrl scheme must be http: or https: (got ${url.protocol}).`);
  }
  if (url.username !== '' || url.password !== '') {
    return failConfig('userinfo', 'baseUrl must not include userinfo (user:pass@).');
  }
  if (url.search !== '') {
    return failConfig('query-string', 'baseUrl must not include a query string.');
  }
  if (url.hash !== '') {
    return failConfig('fragment', 'baseUrl must not include a fragment.');
  }
  return Effect.succeed(url);
};

/**
 * Validates and copies custom headers once at load time.
 *
 * Authentication always comes from credentials, so an Authorization entry is
 * rejected rather than silently shadowed. Header values never reach errors.
 */
const validateHeaders = (
  headers: Record<string, string> | undefined,
): Effect.Effect<Record<string, string> | undefined, CompatibleConfigError> => {
  if (headers === undefined) {
    return Effect.succeed(undefined);
  }
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === 'authorization') {
      return failConfig(
        'authorization-header',
        'config.headers must not include an Authorization header; authentication comes from credentials.',
      );
    }
  }
  return Effect.succeed({ ...headers });
};

/** Rejects credential kinds outside the generic compatible contract. */
const validateCredentials = (credentials: ProviderConfig['credentials']): Effect.Effect<void, CompatibleConfigError> =>
  credentials !== undefined && credentials.kind === 'oauth2-bearer'
    ? failConfig(
        'unsupported-credential-kind',
        'OpenAI-compatible providers do not support oauth2-bearer credentials; use api-key, basic, or none.',
      )
    : Effect.void;

/**
 * Composes the request transform for one load.
 *
 * User headers are applied first, then the credential-derived auth transform,
 * so credential-derived authorization always wins.
 */
const makeTransformClient = (
  headers: Record<string, string> | undefined,
  credentials: ProviderConfig['credentials'],
) => (client: HttpClient.HttpClient): HttpClient.HttpClient => {
  const withUserHeaders = headers === undefined
    ? client
    : client.pipe(
        HttpClient.mapRequest((request) =>
          Object.entries(headers).reduce(
            (next, [name, value]) => next.pipe(HttpClientRequest.setHeader(name, value)),
            request,
          ),
        ),
      );
  return providerAuthTransform(credentials)(withUserHeaders);
};

/**
 * Options for loading the generic OpenAI-compatible runtime.
 *
 * `importAdapter` is a dependency seam that lets a caller (primarily tests)
 * supply the adapter module without the dynamic import, so the loader's
 * install-hint failure path and the missing-model guard are testable without
 * process-global module mocking. When omitted, `@effect/ai-openrouter` is
 * imported dynamically as before.
 */
export interface OpenAiCompatibleRuntimeOptions {
  readonly importAdapter?: () => Promise<typeof OpenRouterAdapter>;
}

/**
 * Loads the generic OpenAI-compatible (Chat Completions) runtime.
 *
 * Shared by generated factories and saved local-compatible connections:
 * validates the configuration before any network I/O or adapter import,
 * constructs the client layer once, and defers model construction to
 * `getModel(...)`. The internal adapter is `@effect/ai-openrouter`, used
 * strictly as a Chat Completions transport: no attribution fields, no model
 * ID rewriting, and no OpenRouter-named errors.
 */
export function loadOpenAiCompatibleRuntime(
  config: ProviderConfig,
  options: OpenAiCompatibleRuntimeOptions = {},
): Effect.Effect<ProviderDefinition, InvalidOpenAiCompatibleProviderConfigError | Error> {
  return Effect.gen(function* () {
    const baseUrl = yield* validateBaseUrl(config.baseUrl);
    const headers = yield* validateHeaders(config.headers);
    yield* validateCredentials(config.credentials);

    const adapter = yield* Effect.tryPromise({
      try: () => (options.importAdapter ? options.importAdapter() : import('@effect/ai-openrouter')),
      catch: () => new Error('Failed to load @effect/ai-openrouter. Install it with: bun add @effect/ai-openrouter'),
    });

    // Adapter shape guard: a missing optional dependency, a stub module, or a
    // partial install must fail with a stable message instead of a TypeError
    // inside client-layer construction.
    if (
      !adapter.OpenRouterClient ||
      typeof adapter.OpenRouterClient.layer !== 'function' ||
      !adapter.OpenRouterLanguageModel?.model
    ) {
      return yield* Effect.fail(
        new Error('OpenAI-compatible adapter did not expose OpenRouterClient.layer or OpenRouterLanguageModel.model.'),
      );
    }

    const layer = adapter.OpenRouterClient.layer({
      apiKey: providerApiKey(config.credentials),
      apiUrl: baseUrl.toString(),
      transformClient: makeTransformClient(headers, config.credentials),
    });

    return {
      id: 'openai-compatible',
      aliases: [...(config.aliases ?? [])],
      config,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) =>
        Effect.succeed(
          adapter.OpenRouterLanguageModel.model(modelId, {
            temperature: overrides?.temperature,
            max_tokens: overrides?.maxTokens,
          }),
        ),
      layer,
    };
  });
}

/**
 * Creates a generic OpenAI-compatible provider factory.
 *
 * Pure and side-effect-free: copies the alias array, declares the
 * openai-compatible protocol with none/api-key/basic authentication under the
 * consumer-chosen id, wires a bounded `/models` connection-test probe that
 * authenticates only from credentials, and never auto-registers with the
 * built-in registry.
 */
export function createOpenAiCompatibleProviderFactory(
  options: OpenAiCompatibleProviderFactoryOptions,
): EffectProviderFactory {
  if (options.id === undefined || options.id === '') {
    throw new Error('createOpenAiCompatibleProviderFactory requires a non-empty id.');
  }
  return {
    id: options.id,
    aliases: [...(options.aliases ?? [])],
    connectionCapabilities: {
      providerId: options.id,
      auth: ['api-key', 'basic', 'none'],
      login: ['manual-secret'],
      protocols: ['openai-compatible'],
    },
    connectionTest: makeProviderConnectionTestHook({
      providerId: options.id,
      request: (draft, credentials) => {
        if (draft.endpoint === undefined) {
          throw new Error(`Provider "${options.id}" connection tests require an endpoint.`);
        }
        return {
          url: providerConnectionProbeUrl(draft, draft.endpoint, 'models').toString(),
          init: { headers: providerConnectionProbeAuthHeaders(credentials) },
        };
      },
    }),
    load: (config) =>
      Effect.runPromise(loadOpenAiCompatibleRuntime(config).pipe(Effect.either)).then((either) => {
        if (Either.isLeft(either)) {
          throw either.left;
        }
        return {
          layer: either.right.layer,
          getModel: either.right.getModel,
        };
      }),
  };
}
