import { HttpServer } from '@effect/platform';
import type { FredClient } from '@fancyrobot/fred';
import { Cause, Effect, Exit, Layer, Runtime, Schema, Scope } from 'effect';
import {
  FredHttpServerLive,
  serverAddress,
  type FredHttpServerLayerOptions,
} from './layers/server';
import { resolveServerSecurityConfig } from './security';
import {
  WorkflowEndpointConfigurationError,
  type WorkflowEndpointsConfig,
} from './workflows';

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
  /** Token required by the default authenticated server; generated when callers do not provide one. */
  readonly authToken?: string;
  close(): Promise<void>;
}

export interface FredWithHttp extends FredClient {
  readonly server: {
    listen(options?: FredHttpListenOptions): Promise<FredHttpServerHandle>;
    stop(): Promise<void>;
  };
  shutdown(): Promise<void>;
}

export type WithHttpOptions = Omit<FredHttpServerLayerOptions, 'port' | 'hostname'> & {
  readonly workflowEndpoints?: WorkflowEndpointsConfig;
};

const squash = (cause: Cause.Cause<unknown>): Error => {
  const error = Cause.squash(cause);
  return error instanceof Error ? error : new Error(String(error));
};

export const withHttp = (fred: FredClient, options: WithHttpOptions = {}): FredWithHttp => {
  const resolvedSecurity = resolveServerSecurityConfig(
    options.security,
    options.apiKeyStore === undefined ? undefined : 'api-key-store',
  );
  const serverOptions: WithHttpOptions = {
    ...options,
    security: resolvedSecurity.config,
  };
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
        ...serverOptions,
        port: listenOptions.port,
        hostname: listenOptions.hostname,
      }, fred, await fred.workflows.list());
      const runtimeExit = await Runtime.runPromise(fred.runtime)(
        Effect.exit(Scope.extend(Layer.toRuntime(layer), scope)),
      );
      if (Exit.isFailure(runtimeExit)) throw squash(runtimeExit.cause);
      const server = Runtime.runSync(runtimeExit.value)(HttpServer.HttpServer);
      const address = serverAddress(server);
      const nextHandle: FredHttpServerHandle = {
        ...address,
        ...(options.apiKeyStore === undefined
          && resolvedSecurity.config.requireAuth
          && resolvedSecurity.config.authToken !== undefined
          ? { authToken: resolvedSecurity.config.authToken }
          : {}),
        close: stop,
      };
      handle = nextHandle;
      state = 'running';
      return nextHandle;
    } catch (cause) {
      await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
      if (serverScope === scope) serverScope = undefined;
      state = 'idle';
      throw cause instanceof ServerStartError || cause instanceof WorkflowEndpointConfigurationError
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
