import { HttpApiBuilder, HttpServer } from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import type { FredClient, WorkflowDescriptor } from '@fancyrobot/fred';
import { Layer } from 'effect';
import { FredHttpApi, FredDocsLayer, FredOpenApiLayer } from '../api';
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
}

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
  const authRequirements = new Map(endpoints.map((endpoint) => [
    canonicalizeHttpPath(endpoint.path) ?? endpoint.path,
    endpoint.auth === false ? false : (endpoint.auth?.scopes ?? []),
  ] as const));
  const api = buildFredHttpApi(endpoints);
  const handlerLayers = fred === undefined
    ? FredHttpHandlersLive
    : Layer.merge(FredHttpHandlersLive, buildWorkflowHandlersLayer(api, fred, endpoints));
  const apiLive = HttpApiBuilder.api(api).pipe(
    Layer.provide(handlerLayers),
  ) as unknown as typeof FredHttpApiLive;
  return HttpApiBuilder.serve().pipe(
    Layer.provide(FredDocsLayer),
    Layer.provide(FredOpenApiLayer),
    Layer.provide(FredHttpSecurityLive({ ...resolvedOptions, authRequirements })),
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
