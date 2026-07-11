import { HttpApiBuilder, HttpServer } from '@effect/platform';
import type { Fred } from '@fancyrobot/fred';
import { Effect, Either, Layer, Option } from 'effect';
import { isIP } from 'node:net';
import { FredDocsLayer, FredOpenApiLayer } from './api';
import { FredHttpApiLive } from './layers/server';
import {
  makeMemoryRateLimitStore,
  makeRateLimitService,
  type RateLimitStoreService,
} from './rate-limiter';
import {
  ApiKeyScopeError,
  ApiKeyStoreError,
  authorizeApiKey,
  type ApiKeyStoreService,
  type AuthenticatedApiKeyIdentity,
} from './api-keys';
import {
  checkAuth,
  DEFAULT_SECURITY_CONFIG,
  matchOrigin,
  type ServerSecurityConfig,
} from './security';

export type FredHttpRouteVisibility = 'public' | 'authenticated';

export interface FredHttpCustomRoute {
  method: string;
  path: string;
  visibility?: FredHttpRouteVisibility;
  handler: (request: Request) => Response | Promise<Response>;
}

export interface CreateFredHttpAppOptions {
  fred: Fred;
  security?: Partial<ServerSecurityConfig>;
  routes?: ReadonlyArray<FredHttpCustomRoute>;
  trustProxy?: boolean;
  getClientIp?: (request: Request) => string | undefined;
  apiKeyStore?: ApiKeyStoreService;
  rateLimitStore?: RateLimitStoreService;
}

export interface FredHttpApp {
  fetch(request: Request): Promise<Response>;
  dispose(): Promise<void>;
}

interface NormalizedCustomRoute extends FredHttpCustomRoute {
  method: string;
  visibility: FredHttpRouteVisibility;
}

const normalizeRoutes = (routes: ReadonlyArray<FredHttpCustomRoute>): ReadonlyArray<NormalizedCustomRoute> =>
  routes.map((route) => ({
    ...route,
    method: route.method.toUpperCase(),
    visibility: route.visibility ?? 'authenticated',
  }));

const matchCustomRoute = (
  request: Request,
  routes: ReadonlyArray<NormalizedCustomRoute>,
): NormalizedCustomRoute | undefined => {
  const url = new URL(request.url);
  return routes.find((route) => route.method === request.method.toUpperCase() && route.path === url.pathname);
};

const getAllowedCorsMethods = (routes: ReadonlyArray<NormalizedCustomRoute>): string => {
  const methods = new Set<string>(['GET', 'POST', 'OPTIONS']);
  for (const route of routes) methods.add(route.method);
  return Array.from(methods).join(', ');
};

const applyCorsHeaders = (
  response: Response,
  origin: string | null,
  securityConfig: ServerSecurityConfig,
  allowedMethods: string,
): Response => {
  if (!origin || !matchOrigin(origin, securityConfig.corsAllowedOrigins)) return response;
  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', allowedMethods);
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Session-Id');
  response.headers.set('Access-Control-Expose-Headers', 'X-Session-Id');
  return response;
};

const extractProxyIp = (request: Request): string | undefined => {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const candidate = forwardedFor.split(',')[0]?.trim();
    if (candidate && isIP(candidate)) return candidate;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  return realIp && isIP(realIp) ? realIp : undefined;
};

const resolveClientIp = (request: Request, options: CreateFredHttpAppOptions): string => {
  const explicitClientIp = options.getClientIp?.(request)?.trim();
  if (explicitClientIp) return explicitClientIp;
  return options.trustProxy ? extractProxyIp(request) ?? 'unknown' : 'unknown';
};

/**
 * @deprecated Prefer `withHttp(await createFred())` for a scoped listener.
 * This fetch adapter remains for one release for embedding and custom routes.
 */
export function createFredHttpApp(options: CreateFredHttpAppOptions): FredHttpApp {
  const securityConfig: ServerSecurityConfig = { ...DEFAULT_SECURITY_CONFIG, ...options.security };
  const customRoutes = normalizeRoutes(options.routes ?? []);
  const rateLimitStore = options.rateLimitStore ?? makeMemoryRateLimitStore();
  const rateLimiter = Effect.runPromise(makeRateLimitService(rateLimitStore));
  const initialization = Effect.runPromise(options.apiKeyStore?.initialize ?? Effect.void);
  const allowedCorsMethods = getAllowedCorsMethods(customRoutes);
  let disposed = false;
  let webHandler: ReturnType<typeof HttpApiBuilder.toWebHandler> | undefined;

  const getWebHandler = async () => {
    if (webHandler) return webHandler;
    const runtime = await options.fred.getRuntime();
    const fredApiLayer = FredHttpApiLive.pipe(
      Layer.provide(Layer.succeedContext(runtime.context)),
    );
    const webLayer = Layer.mergeAll(
      fredApiLayer,
      FredDocsLayer.pipe(Layer.provide(fredApiLayer)),
      FredOpenApiLayer.pipe(Layer.provide(fredApiLayer)),
      HttpServer.layerContext,
    );
    webHandler = HttpApiBuilder.toWebHandler(webLayer);
    return webHandler;
  };

  return {
    async fetch(request: Request): Promise<Response> {
      if (disposed) throw new Error('Fred HTTP app has been disposed');
      try {
        await initialization;
      } catch {
        return new Response('Service Unavailable', { status: 503 });
      }
      const origin = request.headers.get('Origin');
      if (request.method === 'OPTIONS') {
        return applyCorsHeaders(new Response(null, { status: 204 }), origin, securityConfig, allowedCorsMethods);
      }

      const matchedCustomRoute = matchCustomRoute(request, customRoutes);
      const clientIP = resolveClientIp(request, options);
      const requiresAuth = matchedCustomRoute ? matchedCustomRoute.visibility !== 'public' : true;
      let identity: AuthenticatedApiKeyIdentity | undefined;
      if (requiresAuth && options.apiKeyStore !== undefined) {
        const result = await Effect.runPromise(Effect.either(authorizeApiKey(
          options.apiKeyStore,
          request.headers.get('Authorization') ?? undefined,
        )));
        if (Either.isLeft(result)) {
          const status = result.left instanceof ApiKeyScopeError
            ? 403
            : result.left instanceof ApiKeyStoreError
              ? 503
              : 401;
          return applyCorsHeaders(new Response(
            status === 503 ? 'Service Unavailable' : status === 403 ? 'Forbidden' : 'Unauthorized',
            { status },
          ), origin, securityConfig, allowedCorsMethods);
        }
        identity = result.right;
      } else if (requiresAuth) {
        const authResult = checkAuth(clientIP, request.headers.get('Authorization'), securityConfig);
        if (!authResult.allowed) {
          return applyCorsHeaders(new Response('Unauthorized', { status: authResult.status ?? 401 }), origin, securityConfig, allowedCorsMethods);
        }
      }

      const policy = identity === undefined
        ? {
            maxRequests: securityConfig.rateLimitMaxRequests,
            windowMs: securityConfig.rateLimitWindowMs,
          }
        : Option.getOrElse(identity.rateLimit, () => ({
            maxRequests: securityConfig.rateLimitMaxRequests,
            windowMs: securityConfig.rateLimitWindowMs,
          }));
      const bucketKey = identity === undefined ? `ip:${clientIP}` : `key:${identity.id}`;
      const rateLimitResult = await Effect.runPromise(Effect.either(
        (await rateLimiter).consume({ key: bucketKey, policy }),
      ));
      if (Either.isLeft(rateLimitResult)) {
        return applyCorsHeaders(
          new Response('Service Unavailable', { status: 503 }),
          origin,
          securityConfig,
          allowedCorsMethods,
        );
      }
      if (!rateLimitResult.right.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil(rateLimitResult.right.retryAfterMs / 1_000));
        return applyCorsHeaders(new Response('Too Many Requests', {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        }), origin, securityConfig, allowedCorsMethods);
      }

      try {
        const response = matchedCustomRoute
          ? await matchedCustomRoute.handler(request)
          : await (await getWebHandler()).handler(request);
        return applyCorsHeaders(response, origin, securityConfig, allowedCorsMethods);
      } catch {
        return applyCorsHeaders(Response.json(
          { success: false, error: 'Request failed' },
          { status: 500 },
        ), origin, securityConfig, allowedCorsMethods);
      }
    },
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      await Effect.runPromise(rateLimitStore.close);
      await webHandler?.dispose();
    },
  };
}
