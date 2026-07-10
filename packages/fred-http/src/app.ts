import { HttpServer } from '@effect/platform';
import type { Fred } from '@fancyrobot/fred';
import { Cause, Effect, Exit, Layer, Runtime, Scope } from 'effect';
import { FredHttpServerLive, serverAddress } from './layers/server';
import type { ServerSecurityConfig } from './security';

/**
 * @deprecated Use `withHttp(await createFred()).server.listen()` instead.
 * This compatibility wrapper will be removed in the next major release.
 */
export class ServerApp {
  private readonly framework: Fred;
  private readonly securityConfig?: Partial<ServerSecurityConfig>;
  private scope: Scope.CloseableScope | undefined;
  private server: { readonly port: number } | undefined;

  constructor(framework: Fred, securityConfig?: Partial<ServerSecurityConfig>) {
    this.framework = framework;
    this.securityConfig = securityConfig;
  }

  async start(port = 3000, hostname = '0.0.0.0'): Promise<void> {
    if (this.scope) return;

    const runtime = await this.framework.getRuntime();
    const scope = Effect.runSync(Scope.make());
    this.scope = scope;

    const exit = await Runtime.runPromise(runtime)(
      Effect.exit(Scope.extend(
        Layer.toRuntime(FredHttpServerLive({
          port,
          hostname,
          security: this.securityConfig,
        })),
        scope,
      )),
    );

    if (Exit.isFailure(exit)) {
      this.scope = undefined;
      await Effect.runPromise(Scope.close(scope, Exit.void));
      const cause = Cause.squash(exit.cause);
      throw cause instanceof Error ? cause : new Error(String(cause));
    }

    const httpServer = Runtime.runSync(exit.value)(HttpServer.HttpServer);
    const address = serverAddress(httpServer);
    this.server = { port: address.port };
  }

  async stop(): Promise<void> {
    const scope = this.scope;
    this.scope = undefined;
    this.server = undefined;
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
  }

  getFramework(): Fred {
    return this.framework;
  }
}
