import { HttpServer } from '@effect/platform';
import type { FredClient } from '@fancyrobot/fred';
import { Cause, Effect, Exit, Layer, Runtime, Schema, Scope } from 'effect';
import {
  FredHttpServerLive,
  serverAddress,
  type FredHttpServerLayerOptions,
} from './layers/server';

export class ServerAlreadyRunningError extends Schema.TaggedError<ServerAlreadyRunningError>()(
  'ServerAlreadyRunningError',
  { message: Schema.String },
) {}

export class HttpClientClosedError extends Schema.TaggedError<HttpClientClosedError>()(
  'HttpClientClosedError',
  { message: Schema.String },
) {}

export class ServerStartError extends Schema.TaggedError<ServerStartError>()(
  'ServerStartError',
  { message: Schema.String },
) {}

export interface FredHttpListenOptions {
  readonly port?: number;
  readonly hostname?: string;
}

export interface FredHttpServerHandle {
  readonly hostname: string;
  readonly port: number;
  readonly url: string;
  close(): Promise<void>;
}

export interface FredWithHttp extends FredClient {
  readonly server: {
    listen(options?: FredHttpListenOptions): Promise<FredHttpServerHandle>;
    stop(): Promise<void>;
  };
  shutdown(): Promise<void>;
}

export type WithHttpOptions = Omit<FredHttpServerLayerOptions, 'port' | 'hostname'>;

const squash = (cause: Cause.Cause<unknown>): Error => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error : new Error(String(error));
};

export const withHttp = (fred: FredClient, options: WithHttpOptions = {}): FredWithHttp => {
  let state: 'idle' | 'starting' | 'running' | 'closed' = 'idle';
  let serverScope: Scope.CloseableScope | undefined;
  let handle: FredHttpServerHandle | undefined;
  let shutdownPromise: Promise<void> | undefined;

  const stop = async (): Promise<void> => {
    const scope = serverScope;
    serverScope = undefined;
    handle = undefined;
    if (state !== 'closed') state = 'idle';
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
  };

  const listen = async (listenOptions: FredHttpListenOptions = {}): Promise<FredHttpServerHandle> => {
    if (state === 'closed') {
      throw new HttpClientClosedError({ message: 'The HTTP-enhanced Fred client has shut down' });
    }
    if (state !== 'idle') {
      throw new ServerAlreadyRunningError({ message: 'The Fred HTTP server is already starting or running' });
    }
    state = 'starting';
    const scope = Effect.runSync(Scope.make());
    serverScope = scope;
    try {
      const layer = FredHttpServerLive({
        ...options,
        port: listenOptions.port,
        hostname: listenOptions.hostname,
      });
      const runtimeExit = await Runtime.runPromise(fred.runtime)(
        Effect.exit(Scope.extend(Layer.toRuntime(layer), scope)),
      );
      if (Exit.isFailure(runtimeExit)) throw squash(runtimeExit.cause);
      const server = Runtime.runSync(runtimeExit.value)(HttpServer.HttpServer);
      const address = serverAddress(server);
      const nextHandle: FredHttpServerHandle = {
        ...address,
        close: stop,
      };
      handle = nextHandle;
      state = 'running';
      return nextHandle;
    } catch (cause) {
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
      if (serverScope === scope) serverScope = undefined;
      state = 'idle';
      throw cause instanceof ServerStartError
        ? cause
        : new ServerStartError({ message: cause instanceof Error ? cause.message : String(cause) });
    }
  };

  const shutdown = (): Promise<void> => {
    if (shutdownPromise) return shutdownPromise;
    state = 'closed';
    shutdownPromise = (async () => {
      const scope = serverScope;
      serverScope = undefined;
      handle = undefined;
      let stopError: unknown;
      if (scope) {
        try {
          await Effect.runPromise(Scope.close(scope, Exit.void));
        } catch (cause) {
          stopError = cause;
        }
      }
      try {
        await fred.shutdown();
      } catch (cause) {
        if (stopError === undefined) throw cause;
      }
      if (stopError !== undefined) throw stopError;
    })();
    return shutdownPromise;
  };

  return {
    ...fred,
    server: { listen, stop },
    shutdown,
  };
};
