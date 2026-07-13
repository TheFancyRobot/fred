import {
  HttpApiBuilder,
  HttpMethod,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import type { FredClient, WorkflowDescriptor } from '@fancyrobot/fred';
import { Effect, Layer, Schema } from 'effect';
import {
  FRED_DOCS_PATH,
  FRED_OPENAPI_PATH,
  FredHttpApi,
  FredDocsLayer,
  FredOpenApiLayer,
  FredOpenApiSpec,
} from '../api';
import { FredHttpHandlersLive } from '../handlers/index';
import { FredHttpSecurityLive, type FredHttpSecurityOptions } from '../middleware';
import {
  buildFredHttpApi,
  buildWorkflowHandlersLayer,
  resolveWorkflowEndpoints,
  type WorkflowEndpointsConfig,
} from '../workflows';
import {
  canonicalizeHttpPath,
  resolveServerSecurityConfig,
  validateFredHttpRuntimeConfig,
} from '../security';

export interface FredHttpServerLayerOptions extends FredHttpSecurityOptions {
  readonly port?: number;
  readonly hostname?: string;
  readonly workflowEndpoints?: WorkflowEndpointsConfig;
  readonly routes?: ReadonlyArray<FredHttpRoute>;
}

export type FredHttpRouteVisibility = 'public' | 'authenticated';

export interface FredHttpRoute {
  readonly method: HttpMethod.HttpMethod;
  readonly path: `/${string}`;
  readonly visibility?: FredHttpRouteVisibility;
  readonly handler: (request: Request) => Response | Promise<Response>;
}

export class FredHttpRouteConfigurationError extends Schema.TaggedError<FredHttpRouteConfigurationError>()(
  'FredHttpRouteConfigurationError',
  { message: Schema.String },
) {}

const validateCustomRoutes = (
  routes: ReadonlyArray<FredHttpRoute>,
  workflowPaths: ReadonlyArray<string>,
): void => {
  const reservedPaths = new Set([
    ...Object.keys(FredOpenApiSpec.paths),
    FRED_DOCS_PATH,
    FRED_OPENAPI_PATH,
    ...workflowPaths,
  ].map((path) => canonicalizeHttpPath(path) ?? path));
  const methodsAndPaths = new Set<string>();
  const visibilityByPath = new Map<string, FredHttpRouteVisibility>();
  for (const route of routes) {
    if (route.method === 'OPTIONS') {
      throw new FredHttpRouteConfigurationError({
        message: `OPTIONS custom routes are intercepted by CORS preflight handling: ${route.path}`,
      });
    }
    if (!HttpMethod.isHttpMethod(route.method) || canonicalizeHttpPath(route.path) !== route.path) {
      throw new FredHttpRouteConfigurationError({
        message: `Invalid custom route: ${String(route.method)} ${String(route.path)}`,
      });
    }
    if (reservedPaths.has(route.path)) {
      throw new FredHttpRouteConfigurationError({ message: `Reserved custom route path: ${route.path}` });
    }
    const key = `${route.method} ${route.path}`;
    if (methodsAndPaths.has(key)) {
      throw new FredHttpRouteConfigurationError({ message: `Duplicate custom route: ${key}` });
    }
    methodsAndPaths.add(key);
    const visibility = route.visibility ?? 'authenticated';
    const existingVisibility = visibilityByPath.get(route.path);
    if (existingVisibility !== undefined && existingVisibility !== visibility) {
      throw new FredHttpRouteConfigurationError({
        message: `Custom routes sharing ${route.path} must use the same visibility`,
      });
    }
    visibilityByPath.set(route.path, visibility);
  }
};

const customRoutesLayer = (routes: ReadonlyArray<FredHttpRoute>) =>
  HttpApiBuilder.Router.use((router) =>
    Effect.forEach(routes, (route) =>
      router.addRoute(HttpRouter.makeRoute(
        route.method,
        route.path,
        Effect.gen(function* () {
          const serverRequest = yield* HttpServerRequest.HttpServerRequest;
          const request = yield* HttpServerRequest.toWeb(serverRequest);
          const response = yield* Effect.tryPromise({
            try: (signal) => Promise.resolve(route.handler(new Request(request, { signal }))),
            catch: (cause) => cause,
          });
          return HttpServerResponse.fromWeb(response);
        }),
      )),
    { discard: true }),
  );

const addAllowedMethod = (
  methodsByPath: Map<string, string[]>,
  path: string,
  method: HttpMethod.HttpMethod,
): void => {
  const canonicalPath = canonicalizeHttpPath(path) ?? path;
  const methods = methodsByPath.get(canonicalPath) ?? ['OPTIONS'];
  if (!methods.includes(method)) methods.unshift(method);
  methodsByPath.set(canonicalPath, methods);
};

export const FredHttpApiLive = HttpApiBuilder.api(FredHttpApi).pipe(
  Layer.provide(FredHttpHandlersLive),
);

export const FredHttpServerLive = (
  options: FredHttpServerLayerOptions = {},
  fred?: FredClient,
  workflowSnapshot: readonly WorkflowDescriptor[] = [],
) => {
  const runtimeConfig = validateFredHttpRuntimeConfig({
    port: options.port,
    hostname: options.hostname,
    trustProxy: options.trustProxy,
    apiKeyStorage: options.apiKeyStore?.backend,
    apiKeyVerifier: options.apiKeyVerifierRegistry?.defaultVerifierId,
    rateLimitStorage: options.rateLimitStore?.backend,
    security: options.security,
  });
  const security = resolveServerSecurityConfig(
    runtimeConfig.security,
    options.apiKeyStore === undefined ? undefined : 'api-key-store',
  ).config;
  const resolvedOptions: FredHttpServerLayerOptions = {
    ...options,
    port: runtimeConfig.port,
    hostname: runtimeConfig.hostname,
    trustProxy: runtimeConfig.trustProxy,
    security,
  };
  const endpoints = resolveWorkflowEndpoints(workflowSnapshot, options.workflowEndpoints);
  const routes = options.routes ?? [];
  validateCustomRoutes(routes, endpoints.map((endpoint) => endpoint.path));
  const authRequirements = new Map<string, false | readonly string[]>(endpoints.map((endpoint) => [
    canonicalizeHttpPath(endpoint.path) ?? endpoint.path,
    endpoint.auth === false ? false : (endpoint.auth?.scopes ?? []),
  ] as const));
  const allowedMethodsByPath = new Map<string, string[]>();
  for (const [path, operations] of Object.entries(FredOpenApiSpec.paths)) {
    for (const method of Object.keys(operations)) {
      const normalizedMethod = method.toUpperCase();
      if (HttpMethod.isHttpMethod(normalizedMethod)) {
        addAllowedMethod(allowedMethodsByPath, path, normalizedMethod);
      }
    }
  }
  addAllowedMethod(allowedMethodsByPath, FRED_DOCS_PATH, 'GET');
  addAllowedMethod(allowedMethodsByPath, FRED_OPENAPI_PATH, 'GET');
  for (const endpoint of endpoints) {
    addAllowedMethod(allowedMethodsByPath, endpoint.path, 'POST');
  }
  for (const route of routes) {
    const path = canonicalizeHttpPath(route.path) ?? route.path;
    authRequirements.set(path, route.visibility === 'public' ? false : []);
    addAllowedMethod(allowedMethodsByPath, path, route.method);
  }
  const api = buildFredHttpApi(endpoints);
  const apiHandlers = fred === undefined
    ? FredHttpHandlersLive
    : Layer.merge(FredHttpHandlersLive, buildWorkflowHandlersLayer(api, fred, endpoints));
  const handlerLayers = routes.length === 0
    ? apiHandlers
    : Layer.merge(apiHandlers, customRoutesLayer(routes));
  const apiLive = HttpApiBuilder.api(api).pipe(
    Layer.provide(handlerLayers),
  ) as unknown as typeof FredHttpApiLive;
  return HttpApiBuilder.serve().pipe(
    Layer.provide(FredDocsLayer),
    Layer.provide(FredOpenApiLayer),
    Layer.provide(FredHttpSecurityLive({
      ...resolvedOptions,
      authRequirements,
      allowedMethodsByPath,
    })),
    Layer.provide(apiLive),
    Layer.provideMerge(BunHttpServer.layer({
      port: runtimeConfig.port ?? 0,
      hostname: runtimeConfig.hostname ?? '127.0.0.1',
      maxRequestBodySize: security.maxRequestBodySize,
      idleTimeout: security.requestTimeoutSeconds,
    })),
  );
};

export const serverAddress = (server: HttpServer.HttpServer) => {
  if (server.address._tag !== 'TcpAddress') {
    return { hostname: 'localhost', port: 0, url: '' };
  }
  const hostname = server.address.hostname === '0.0.0.0' ? '127.0.0.1' : server.address.hostname;
  return {
    hostname,
    port: server.address.port,
    url: `http://${hostname}:${server.address.port}`,
  };
};
