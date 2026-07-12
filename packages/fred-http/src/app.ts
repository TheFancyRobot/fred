import type { FredClient } from '@fancyrobot/fred';
import { withHttp, type FredHttpServerHandle, type FredWithHttp } from './client';
import type { ServerSecurityConfig } from './security';

/**
 * @deprecated Use `withHttp(await createFred()).server.listen()` instead.
 * This compatibility wrapper will be removed in the next major release.
 */
export class ServerApp {
  private readonly framework: FredClient;
  private readonly http: FredWithHttp;
  private server: { readonly port: number } | undefined;

  constructor(framework: FredClient, securityConfig?: Partial<ServerSecurityConfig>) {
    this.framework = framework;
    this.http = withHttp(framework, { security: securityConfig });
  }

  async start(port = 3000, hostname = '0.0.0.0'): Promise<void> {
    if (this.server) return;
    const handle: FredHttpServerHandle = await this.http.server.listen({ port, hostname });
    this.server = { port: handle.port };
  }

  async stop(): Promise<void> {
    await this.http.server.stop();
    this.server = undefined;
  }

  getFramework(): FredClient {
    return this.framework;
  }
}
