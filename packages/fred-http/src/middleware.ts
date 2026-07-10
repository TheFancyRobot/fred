import {
  HttpApiBuilder,
  HttpServerRequest,
  HttpServerResponse,
  type HttpApp,
} from '@effect/platform';
import { Config, Effect, Option, Redacted } from 'effect';
import { isIP } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import { RateLimiter } from './rate-limiter';
import {
  DEFAULT_SECURITY_CONFIG,
  isLocalRequest,
  matchOrigin,
  type ServerSecurityConfig,
} from './security';

export interface FredHttpSecurityOptions {
  readonly security?: Partial<ServerSecurityConfig>;
  readonly trustProxy?: boolean;
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

const makeSecurityMiddleware = (
  config: ServerSecurityConfig,
  trustProxy: boolean,
  token: string | undefined,
  limiter: RateLimiter,
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

    const authIsOptional = !config.requireAuth
      || (config.allowLocalRequestsWithoutAuth && isLocalRequest(ip));
    const authorization = request.headers.authorization;
    if (!authIsOptional && (!token || !authorization || !secureEqual(authorization, `Bearer ${token}`))) {
      return withCors(unauthorized, origin, config);
    }

    const response = yield* app.pipe(
      Effect.catchAllCause(() =>
        Effect.succeed(HttpServerResponse.unsafeJson(
          { success: false, error: 'Request failed' },
          { status: 500 },
        )),
      ),
    );
    return withCors(response, origin, config);
  });

export const FredHttpSecurityLive = (options: FredHttpSecurityOptions = {}) => {
  const config: ServerSecurityConfig = { ...DEFAULT_SECURITY_CONFIG, ...options.security };
  const token = options.security?.authToken === undefined
    ? Config.option(Config.redacted('FRED_DEV_SERVER_TOKEN')).pipe(
        Effect.map(Option.map(Redacted.value)),
        Effect.map(Option.getOrUndefined),
      )
    : Effect.succeed(options.security.authToken);

  return HttpApiBuilder.middleware(
    Effect.gen(function* () {
      const authToken = yield* token;
      const limiter = yield* Effect.acquireRelease(
        Effect.sync(() => new RateLimiter(config.rateLimitMaxRequests, config.rateLimitWindowMs)),
        (resource) => Effect.sync(() => resource.dispose()),
      );
      return makeSecurityMiddleware(config, options.trustProxy ?? false, authToken, limiter);
    }),
  );
};

