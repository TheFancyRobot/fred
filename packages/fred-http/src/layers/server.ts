import { HttpApiBuilder, HttpServer } from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import { Layer } from 'effect';
import { FredHttpApi, FredDocsLayer, FredOpenApiLayer } from '../api';
import { FredHttpHandlersLive } from '../handlers/index';
import { FredHttpSecurityLive, type FredHttpSecurityOptions } from '../middleware';

export interface FredHttpServerLayerOptions extends FredHttpSecurityOptions {
  readonly port?: number;
  readonly hostname?: string;
}

export const FredHttpApiLive = HttpApiBuilder.api(FredHttpApi).pipe(
  Layer.provide(FredHttpHandlersLive),
);

export const FredHttpServerLive = (options: FredHttpServerLayerOptions = {}) =>
  HttpApiBuilder.serve().pipe(
    Layer.provide(FredDocsLayer),
    Layer.provide(FredOpenApiLayer),
    Layer.provide(FredHttpSecurityLive(options)),
    Layer.provide(FredHttpApiLive),
    Layer.provideMerge(BunHttpServer.layer({
      port: options.port ?? 0,
      hostname: options.hostname ?? '127.0.0.1',
      maxRequestBodySize: options.security?.maxRequestBodySize,
      idleTimeout: options.security?.requestTimeoutSeconds,
    })),
  );

export const serverAddress = (server: HttpServer.HttpServer) => {
  if (server.address._tag !== 'TcpAddress') {
    return { hostname: 'localhost', port: 0, url: '' };
  }
  const hostname = server.address.hostname === '0.0.0.0' ? '127.0.0.1' : server.address.hostname;
  return {
    hostname: server.address.hostname,
    port: server.address.port,
    url: `http://${hostname}:${server.address.port}`,
  };
};
