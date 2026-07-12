import { HttpServer } from '@effect/platform';
import type { Fred, FredClient } from '@fancyrobot/fred';
import { Cause, Effect, Exit, Layer, Runtime, Scope } from 'effect';
import { withHttp, type FredHttpServerHandle, type FredWithHttp } from './client';
import { FredHttpServerLive, serverAddress } from './layers/server';
import type { ServerSecurityConfig } from './security';

const isFredClient = (framework: Fred | FredClient): framework is FredClient =>
  'effects' in framework;

/**
 * @deprecated Use `withHttp(await createFred()).server.listen()` instead.
 * This compatibility wrapper will be removed in the next major release.
 */
export class ServerApp {
  private readonly framework: Fred | FredClient;
  private readonly securityConfig?: Partial<ServerSecurityConfig>;
  private readonly http: FredWithHttp | undefined;
  private readonly legacyFramework: Fred | undefined;
  private scope: Scope.CloseableScope | undefined;
  private server: { readonly port: number } | undefined;

  constructor(framework: Fred | FredClient, securityConfig?: Partial<ServerSecurityConfig>) {
    this.framework = framework;
    this.securityConfig = securityConfig;
    this.http = isFredClient(framework)
      ? withHttp(framework, { security: securityConfig })
      : undefined;
    this.legacyFramework = isFredClient(framework) ? undefined : framework;
  }

  async start(port = 3000, hostname = '0.0.0.0'): Promise<void> {
    if (this.server || this.scope) return;
    if (this.http) {
      const handle: FredHttpServerHandle = await this.http.server.listen({ port, hostname });
      this.server = { port: handle.port };
      return;
    }

    const legacyFramework = this.legacyFramework;
    if (!legacyFramework) {
      throw new Error('ServerApp compatibility framework is unavailable');
    }
    const runtime = await legacyFramework.getRuntime();
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
    this.server = { port: serverAddress(httpServer).port };
  }

  async stop(): Promise<void> {
    if (this.http) {
      await this.http.server.stop();
    }
    const scope = this.scope;
    this.scope = undefined;
    if (scope) await Effect.runPromise(Scope.close(scope, Exit.void));
    this.server = undefined;
  }

  getFramework(): Fred | FredClient {
    return this.framework;
  }
}
