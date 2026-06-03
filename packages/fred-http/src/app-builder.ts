import { Fred } from '@fancyrobot/fred';
import type { Prompt } from '@effect/ai';
import { isIP } from 'node:net';
import { ChatHandlers } from './chat/handlers';
import { ChatRoutes } from './chat/routes';
import { ServerHandlers } from './handlers';
import { RateLimiter } from './rate-limiter';
import { Router } from './routes';
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
}

export interface FredHttpApp {
  fetch(request: Request): Promise<Response>;
  dispose(): void;
}

interface NormalizedCustomRoute extends FredHttpCustomRoute {
  method: string;
  visibility: FredHttpRouteVisibility;
}

function normalizeRoutes(routes: ReadonlyArray<FredHttpCustomRoute>): ReadonlyArray<NormalizedCustomRoute> {
  return routes.map((route) => ({
    ...route,
    method: route.method.toUpperCase(),
    visibility: route.visibility ?? 'authenticated',
  }));
}

function matchCustomRoute(
  request: Request,
  routes: ReadonlyArray<NormalizedCustomRoute>
): NormalizedCustomRoute | undefined {
  const url = new URL(request.url);
  return routes.find((route) => route.method === request.method.toUpperCase() && route.path === url.pathname);
}

function createBuiltInRouter(framework: Fred): Router {
  const handlers = new ServerHandlers(framework);
  const chatContextAdapter = {
    generateConversationId: () => framework.generateConversationId(),
    addMessage: (conversationId: string, message: Prompt.MessageEncoded) =>
      framework.addMessages(conversationId, [message]),
  };
  const chatHandlers = new ChatHandlers(framework, chatContextAdapter);
  const chatRoutes = new ChatRoutes(chatHandlers);
  return new Router(handlers, chatRoutes);
}

function getAllowedCorsMethods(routes: ReadonlyArray<NormalizedCustomRoute>): string {
  const methods = new Set<string>(['GET', 'POST', 'OPTIONS']);

  for (const route of routes) {
    methods.add(route.method);
  }

  return Array.from(methods).join(', ');
}

function applyCorsHeaders(
  response: Response,
  origin: string | null,
  securityConfig: ServerSecurityConfig,
  allowedMethods: string
): Response {
  const corsAllowed = origin ? matchOrigin(origin, securityConfig.corsAllowedOrigins) : false;
  if (!corsAllowed || !origin) {
    return response;
  }

  response.headers.set('Access-Control-Allow-Origin', origin);
  response.headers.set('Access-Control-Allow-Methods', allowedMethods);
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return response;
}

function extractProxyIp(request: Request): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const candidate = forwardedFor.split(',')[0]?.trim();
    if (candidate && isIP(candidate)) {
      return candidate;
    }
  }

  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && isIP(realIp)) {
    return realIp;
  }

  return undefined;
}

function resolveClientIp(request: Request, options: CreateFredHttpAppOptions): string {
  const explicitClientIp = options.getClientIp?.(request)?.trim();
  if (explicitClientIp) {
    return explicitClientIp;
  }

  if (options.trustProxy) {
    return extractProxyIp(request) ?? 'unknown';
  }

  return 'unknown';
}

export function createFredHttpApp(options: CreateFredHttpAppOptions): FredHttpApp {
  const securityConfig: ServerSecurityConfig = {
    ...DEFAULT_SECURITY_CONFIG,
    ...options.security,
  };
  const customRoutes = normalizeRoutes(options.routes ?? []);
  const builtInRouter = createBuiltInRouter(options.fred);
  const rateLimiter = new RateLimiter(
    securityConfig.rateLimitMaxRequests,
    securityConfig.rateLimitWindowMs
  );
  const allowedCorsMethods = getAllowedCorsMethods(customRoutes);

  return {
    async fetch(request: Request): Promise<Response> {
      const origin = request.headers.get('Origin');

      if (request.method === 'OPTIONS') {
        const corsAllowed = origin ? matchOrigin(origin, securityConfig.corsAllowedOrigins) : false;

        if (!corsAllowed || !origin) {
          return new Response(null, { status: 204 });
        }

        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': allowedCorsMethods,
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          },
        });
      }

      const matchedCustomRoute = matchCustomRoute(request, customRoutes);
      const clientIP = resolveClientIp(request, options);
      const rateLimitResult = rateLimiter.check(clientIP);
      if (!rateLimitResult.allowed) {
        const retryAfterSeconds = Math.max(1, Math.ceil((rateLimitResult.retryAfterMs ?? 0) / 1000));
        return new Response('Too Many Requests', {
          status: 429,
          headers: {
            'Retry-After': String(retryAfterSeconds),
          },
        });
      }

      const requiresAuth = matchedCustomRoute
        ? matchedCustomRoute.visibility !== 'public'
        : true;

      if (requiresAuth) {
        const authResult = checkAuth(
          clientIP,
          request.headers.get('Authorization'),
          securityConfig
        );
        if (!authResult.allowed) {
          return new Response('Unauthorized', {
            status: authResult.status ?? 401,
          });
        }
      }

      try {
        const response = matchedCustomRoute
          ? await matchedCustomRoute.handler(request)
          : await builtInRouter.handleRequest(request);

        return applyCorsHeaders(response, origin, securityConfig, allowedCorsMethods);
      } catch {
        return applyCorsHeaders(
          Response.json(
            {
              success: false,
              error: 'Request failed',
            },
            { status: 500 }
          ),
          origin,
          securityConfig,
          allowedCorsMethods
        );
      }
    },
    dispose(): void {
      rateLimiter.dispose();
    },
  };
}
