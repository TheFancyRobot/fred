import {
  HttpApiBuilder,
  HttpServerRequest,
  HttpServerResponse,
  type HttpApp,
} from '@effect/platform';
import { Cause, Config, Effect, Either, Option, Redacted } from 'effect';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { RateLimiter } from './rate-limiter';
import {
  ApiKeyScopeError,
  ApiKeyStoreError,
  AuthenticatedApiKey,
  authorizeApiKey,
  type AuthenticatedApiKeyIdentity,
  type ApiKeyStoreService,
} from './api-keys';
import {
  isLocalRequest,
  matchOrigin,
  resolveServerSecurityConfig,
  type ServerSecurityConfig,
} from './security';

export interface FredHttpSecurityOptions {
  readonly security?: Partial<ServerSecurityConfig>;
  readonly trustProxy?: boolean;
  readonly apiKeyStore?: ApiKeyStoreService;
  readonly authRequirements?: ReadonlyMap<string, false | readonly string[]>;
}

const allowedMethods = ['GET', 'POST', 'OPTIONS'];
const allowedHeaders = ['Content-Type', 'Authorization', 'X-Session-Id'];
const exposedHeaders = ['X-Session-Id'];

const extractProxyIp = (headers: Readonly<Record<string, string | undefined>>): string | undefined => {
  const forwarded = headers['x-forwarded-for']?.split(',')[0]?.trim();
  if (forwarded && isIP(forwarded)) return forwarded;
  const realIp = headers['x-real-ip']?.trim();
  return realIp && isIP(realIp) ? realIp : undefined;
};

const clientIp = (
  request: HttpServerRequest.HttpServerRequest,
  trustProxy: boolean,
): string => {
  if (trustProxy) {
    const proxyIp = extractProxyIp(request.headers);
    if (proxyIp) return proxyIp;
  }
  return Option.getOrElse(request.remoteAddress, () => 'unknown');
};

const secureEqual = (actual: string, expected: string): boolean => {
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
};

const corsHeaders = (origin: string) => ({
  'access-control-allow-origin': origin,
  'access-control-allow-methods': allowedMethods.join(', '),
  'access-control-allow-headers': allowedHeaders.join(', '),
  'access-control-expose-headers': exposedHeaders.join(', '),
});

const withCors = (
  response: HttpServerResponse.HttpServerResponse,
  origin: string | undefined,
  config: ServerSecurityConfig,
) => origin && matchOrigin(origin, config.corsAllowedOrigins)
  ? HttpServerResponse.setHeaders(response, corsHeaders(origin))
  : response;

const unauthorized = HttpServerResponse.text('Unauthorized', { status: 401 });
const forbidden = HttpServerResponse.text('Forbidden', { status: 403 });
const unavailable = HttpServerResponse.text('Service Unavailable', { status: 503 });

const hasTag = (value: unknown, tag: string): boolean =>
  typeof value === 'object'
  && value !== null
  && '_tag' in value
  && value._tag === tag;

const makeSecurityMiddleware = (
  config: ServerSecurityConfig,
  trustProxy: boolean,
  token: string | undefined,
  limiter: RateLimiter,
  apiKeyStore: ApiKeyStoreService | undefined,
  authRequirements: ReadonlyMap<string, false | readonly string[]>,
) => (app: HttpApp.Default): HttpApp.Default =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const origin = request.headers.origin;

    if (request.method === 'OPTIONS') {
      return origin && matchOrigin(origin, config.corsAllowedOrigins)
        ? HttpServerResponse.empty({ status: 204, headers: corsHeaders(origin) })
        : HttpServerResponse.empty({ status: 204 });
    }

    const ip = clientIp(request, trustProxy);
    const limited = limiter.check(ip);
    if (!limited.allowed) {
      const retryAfter = Math.max(1, Math.ceil((limited.retryAfterMs ?? 0) / 1_000));
      return withCors(
        HttpServerResponse.text('Too Many Requests', {
          status: 429,
          headers: { 'retry-after': String(retryAfter) },
        }),
        origin,
        config,
      );
    }

    const path = request.url.split('?', 1)[0] ?? request.url;
    const routeRequirement = authRequirements.get(path);
    const authIsOptional = routeRequirement === false
      || !config.requireAuth
      || (config.allowLocalRequestsWithoutAuth && isLocalRequest(ip));
    const authorization = request.headers.authorization;
    let identity = Option.none<AuthenticatedApiKeyIdentity>();
    if (!authIsOptional && apiKeyStore !== undefined) {
      const authResult = yield* Effect.either(authorizeApiKey(
        apiKeyStore,
        authorization,
        routeRequirement === undefined ? [] : routeRequirement,
      ));
      if (Either.isLeft(authResult)) {
        const response = authResult.left instanceof ApiKeyScopeError
          ? forbidden
          : authResult.left instanceof ApiKeyStoreError
            ? unavailable
            : unauthorized;
        return withCors(response, origin, config);
      }
      identity = Option.some(authResult.right);
    } else if (!authIsOptional && (!token || !authorization || !secureEqual(authorization, `Bearer ${token}`))) {
        return withCors(unauthorized, origin, config);
    }

    const response = yield* app.pipe(
      Effect.provideService(AuthenticatedApiKey, identity),
      Effect.catchAllCause((cause) => {
        const failure = Cause.failureOption(cause);
        if (Option.isSome(failure) && hasTag(failure.value, 'RouteNotFound')) {
          return Effect.succeed(HttpServerResponse.empty({ status: 404 }));
        }
        if (Option.isSome(failure) && hasTag(failure.value, 'HttpApiDecodeError')) {
          return Effect.succeed(HttpServerResponse.unsafeJson(
            { success: false, error: 'Invalid request' },
            { status: 400 },
          ));
        }
        return Effect.succeed(HttpServerResponse.unsafeJson(
          { success: false, error: 'Request failed' },
          { status: 500 },
        ));
      }),
    );
    return withCors(response, origin, config);
  });

export const FredHttpSecurityLive = (options: FredHttpSecurityOptions = {}) => {
  const environmentToken = options.security?.authToken === undefined
    ? Config.option(Config.redacted('FRED_DEV_SERVER_TOKEN')).pipe(
        Effect.map(Option.map(Redacted.value)),
        Effect.map(Option.getOrUndefined),
      )
    : Effect.succeed(options.security.authToken);

  return HttpApiBuilder.middleware(
    Effect.gen(function* () {
      const configuredEnvironmentToken = yield* environmentToken;
      const resolved = resolveServerSecurityConfig(
        options.security,
        options.apiKeyStore === undefined ? configuredEnvironmentToken : 'api-key-store',
      );
      const config = resolved.config;
      if (options.apiKeyStore !== undefined) yield* options.apiKeyStore.initialize;
      const limiter = yield* Effect.acquireRelease(
        Effect.sync(() => new RateLimiter(config.rateLimitMaxRequests, config.rateLimitWindowMs)),
        (resource) => Effect.sync(() => resource.dispose()),
      );
      return makeSecurityMiddleware(
        config,
        options.trustProxy ?? false,
        options.apiKeyStore === undefined ? config.authToken : undefined,
        limiter,
        options.apiKeyStore,
        options.authRequirements ?? new Map(),
      );
    }),
  );
};
