#!/usr/bin/env bun

import { BunRuntime } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import {
  createFred,
  getBuiltinPackIds,
  type FredClient,
} from '@fancyrobot/fred';
import { withHttp, type FredWithHttp } from './client';

export function parseArgs(args: readonly string[] = process.argv.slice(2)): { configPath?: string; port: number } {
  const configIndex = args.indexOf('--config');
  const portIndex = args.indexOf('--port');

  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const requestedPort = portIndex === -1 ? undefined : args[portIndex + 1];
  const parsedPort = requestedPort === undefined ? Number.NaN : Number(requestedPort);
  const port = Number.isSafeInteger(parsedPort) && parsedPort >= 1 && parsedPort <= 65_535
    ? parsedPort
    : 3000;

  return { configPath, port };
}

class FredServerInitializationError extends Schema.TaggedError<FredServerInitializationError>()(
  'FredServerInitializationError',
  { message: Schema.String, cause: Schema.optional(Schema.String) },
) {}

const initializationError = (message: string, cause: unknown) =>
  new FredServerInitializationError({
    message,
    cause: cause instanceof Error ? cause.message : String(cause),
  });

export const registerDefaultProvidersBestEffort = (
  useProvider: FredClient['providers']['use'],
  providerIds: readonly string[] = getBuiltinPackIds(),
): Effect.Effect<void> =>
  Effect.forEach(
    providerIds,
    (providerId) => Effect.tryPromise({
      try: () => useProvider(providerId),
      catch: (cause) => initializationError(
        `Failed to register built-in provider: ${providerId}`,
        cause,
      ),
    }).pipe(
      Effect.catchTag('FredServerInitializationError', (error) =>
        Effect.logDebug('Built-in provider not available').pipe(
          Effect.annotateLogs({ providerId, error: error.cause ?? error.message }),
        )),
    ),
    { discard: true },
  );

const createConfiguredFred = (configPath?: string): Effect.Effect<FredClient, FredServerInitializationError> =>
  Effect.gen(function* () {
    const fred = yield* Effect.tryPromise({
      try: () => createFred(configPath ? { configPath } : {}),
      catch: (cause) => initializationError(
        configPath ? 'Failed to load config' : 'Failed to initialize Fred',
        cause,
      ),
    });
    if (!configPath) {
      yield* registerDefaultProvidersBestEffort(fred.providers.use);
    }
    return fred;
  }).pipe(
    Effect.tap(() => configPath
      ? Effect.log(`Initialized from config: ${configPath}`)
      : Effect.log('No config file provided. Using default providers.')),
    Effect.tap(() => configPath
      ? Effect.void
      : Effect.log('Register agents, intents, and tools programmatically or provide a config file.')),
  );

const listen = (
  configPath: string | undefined,
  port: number,
): Effect.Effect<FredWithHttp, FredServerInitializationError> =>
  Effect.gen(function* () {
    const fred = withHttp(yield* createConfiguredFred(configPath));
    return yield* Effect.tryPromise({
      try: () => fred.server.listen({ port, hostname: '0.0.0.0' }),
      catch: (cause) => initializationError('Failed to start server', cause),
    }).pipe(
      Effect.as(fred),
      Effect.catchTag('FredServerInitializationError', (error) =>
        Effect.promise(() => fred.shutdown().catch(() => undefined)).pipe(
          Effect.zipRight(Effect.fail(error)),
        )),
    );
  });

const program = Effect.gen(function* () {
  const { configPath, port } = parseArgs();
  yield* Effect.acquireRelease(
    listen(configPath, port),
    (fred) => Effect.promise(() => fred.shutdown()),
  );

  return yield* Effect.never;
}).pipe(
  Effect.scoped,
  Effect.tapError((error) => Effect.logError('Failed to start server', error)),
  Effect.catchAll((error) =>
    Effect.sync(() => {
      process.exit(1);
    })
  )
);

if (import.meta.main) {
  BunRuntime.runMain(program);
}

export { ServerApp } from './app';

/**
 * @deprecated Prefer `withHttp(await createFred()).server.listen()`.
 * This development entrypoint remains for one release.
 */
export function startServer(options?: { configPath?: string; port?: number }): void {
  const serverProgram = Effect.gen(function* () {
    yield* Effect.acquireRelease(
      listen(options?.configPath, options?.port ?? 3000),
      (fred) => Effect.promise(() => fred.shutdown()),
    );

    return yield* Effect.never;
  }).pipe(
    Effect.scoped,
    Effect.tapError((error) => Effect.logError('Failed to start server', error)),
    Effect.catchAll((error) =>
      Effect.sync(() => {
        process.exit(1);
      })
    )
  );

  BunRuntime.runMain(serverProgram);
}
