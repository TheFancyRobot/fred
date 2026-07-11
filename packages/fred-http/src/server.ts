#!/usr/bin/env bun

import { BunRuntime } from '@effect/platform-bun';
import { Effect, Schema } from 'effect';
import { Fred } from '@fancyrobot/fred';
import { ServerApp } from './app';

function parseArgs(): { configPath?: string; port: number } {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  const portIndex = args.indexOf('--port');

  const configPath = configIndex !== -1 ? args[configIndex + 1] : undefined;
  const port = portIndex !== -1 ? parseInt(args[portIndex + 1]) : 3000;

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

function initializeFred(fred: Fred, configPath?: string): Effect.Effect<void, FredServerInitializationError> {
  if (configPath) {
    return Effect.tryPromise({
      try: () => fred.initializeFromConfig(configPath),
      catch: (cause) => initializationError('Failed to load config', cause),
    }).pipe(Effect.tap(() => Effect.log(`Initialized from config: ${configPath}`)));
  }

  return Effect.tryPromise({
    try: () => fred.registerDefaultProviders(),
    catch: (cause) => initializationError('Failed to register providers', cause),
  }).pipe(
    Effect.tap(() => Effect.log('No config file provided. Using default providers.')),
    Effect.tap(() => Effect.log('Register agents, intents, and tools programmatically or provide a config file.')),
  );
}

const program = Effect.gen(function* () {
  const { configPath, port } = parseArgs();
  const fred = new Fred();

  yield* initializeFred(fred, configPath);

  const app = new ServerApp(fred);
  yield* Effect.acquireRelease(
    Effect.promise(() => app.start(port)),
    () => Effect.promise(() => app.stop())
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
    const fred = new Fred();

    if (options?.configPath) {
      yield* Effect.tryPromise({
        try: () => fred.initializeFromConfig(options.configPath!),
        catch: (cause) => initializationError('Failed to load config', cause),
      });
    } else {
      yield* Effect.tryPromise({
        try: () => fred.registerDefaultProviders(),
        catch: (cause) => initializationError('Failed to register providers', cause),
      });
    }

    const app = new ServerApp(fred);
    yield* Effect.acquireRelease(
      Effect.promise(() => app.start(options?.port ?? 3000)),
      () => Effect.promise(() => app.stop())
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
