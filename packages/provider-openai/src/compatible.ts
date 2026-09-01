import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import { Data, Effect, Either } from 'effect';
import {
  providerApiKey,
  providerAuthTransform,
  type EffectProviderFactory,
  type ProviderConfig,
  type ProviderDefinition,
  type ProviderModelDefaults,
} from '@fancyrobot/fred';

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
  readonly reason: string;
  readonly message: string;
}> {}

/** Options for creating a generic OpenAI-compatible provider factory. */
export interface OpenAiCompatibleProviderFactoryOptions {
  readonly id: string;
  readonly aliases?: readonly string[];
}

type CompatibleConfigError = InvalidOpenAiCompatibleProviderConfigError;

const failConfig = (reason: string, message: string): Effect.Effect<never, CompatibleConfigError> =>
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
): Effect.Effect<ProviderDefinition, InvalidOpenAiCompatibleProviderConfigError | Error> {
  return Effect.gen(function* () {
    const baseUrl = yield* validateBaseUrl(config.baseUrl);
    const headers = yield* validateHeaders(config.headers);
    yield* validateCredentials(config.credentials);

    const adapter = yield* Effect.tryPromise({
      try: () => import('@effect/ai-openrouter'),
      catch: (error) => (error instanceof Error ? error : new Error(String(error))),
    });

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
 * consumer-chosen id, and never auto-registers with the built-in registry.
 * Registration is explicit via `FredClient.providers.registerFactory(...)`.
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
