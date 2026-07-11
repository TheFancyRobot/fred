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
  const endpoints = resolveWorkflowEndpoints(workflowSnapshot, options.workflowEndpoints);
  const authRequirements = new Map(endpoints.map((endpoint) => [
    endpoint.path,
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
    Layer.provide(FredHttpSecurityLive({ ...options, authRequirements })),
    Layer.provide(apiLive),
    Layer.provideMerge(BunHttpServer.layer({
      port: options.port ?? 0,
      hostname: options.hostname ?? '127.0.0.1',
      maxRequestBodySize: options.security?.maxRequestBodySize,
      idleTimeout: options.security?.requestTimeoutSeconds,
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
