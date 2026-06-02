import { Fred } from '@fancyrobot/fred';
import type { Prompt } from '@effect/ai';
import { ServerHandlers } from './handlers';
import { Router } from './routes';
import { ChatRoutes } from './chat/routes';
import { ChatHandlers } from './chat/handlers';
import {
  checkAuth,
  DEFAULT_SECURITY_CONFIG,
  matchOrigin,
  type ServerSecurityConfig,
} from './security';
import { RateLimiter } from './rate-limiter';

export class ServerApp {
  private framework: Fred;
  private handlers: ServerHandlers;
  private router: Router;
  private chatRoutes: ChatRoutes;
  private server: any;
  private securityConfig: ServerSecurityConfig;
  private rateLimiter: RateLimiter;
  private generatedAuthToken = false;

  constructor(framework: Fred, securityConfig?: Partial<ServerSecurityConfig>) {
    this.framework = framework;
    this.handlers = new ServerHandlers(framework);
    this.securityConfig = {
      ...DEFAULT_SECURITY_CONFIG,
      ...securityConfig,
    };
    if (
      this.securityConfig.requireAuth &&
      !this.securityConfig.authToken &&
      !process.env.FRED_DEV_SERVER_TOKEN
    ) {
      this.securityConfig.authToken = crypto.randomUUID();
      this.generatedAuthToken = true;
    }
    this.rateLimiter = new RateLimiter(
      this.securityConfig.rateLimitMaxRequests,
      this.securityConfig.rateLimitWindowMs
    );

    const chatContextAdapter = {
      generateConversationId: () => framework.generateConversationId(),
      addMessage: (conversationId: string, message: Prompt.MessageEncoded) =>
        framework.addMessages(conversationId, [message]),
    };
    const chatHandlers = new ChatHandlers(framework, chatContextAdapter);
    this.chatRoutes = new ChatRoutes(chatHandlers);

    this.router = new Router(this.handlers, this.chatRoutes);
  }

  async start(port: number = 3000, hostname: string = '0.0.0.0'): Promise<void> {
    this.server = Bun.serve({
      port,
      hostname,
      maxRequestBodySize: this.securityConfig.maxRequestBodySize,
      idleTimeout: this.securityConfig.requestTimeoutSeconds,
      fetch: async (req, server) => {
        const origin = req.headers.get('Origin');

        if (req.method === 'OPTIONS') {
          const corsAllowed = origin ? matchOrigin(origin, this.securityConfig.corsAllowedOrigins) : false;

          if (!corsAllowed || !origin) {
            return new Response(null, { status: 204 });
          }

          return new Response(null, {
            status: 204,
            headers: {
              'Access-Control-Allow-Origin': origin,
              'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
              'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            },
          });
        }

        const clientIP = server.requestIP(req)?.address ?? 'unknown';
        const rateLimitResult = this.rateLimiter.check(clientIP);
        if (!rateLimitResult.allowed) {
          const retryAfterSeconds = Math.max(1, Math.ceil((rateLimitResult.retryAfterMs ?? 0) / 1000));
          return new Response('Too Many Requests', {
            status: 429,
            headers: {
              'Retry-After': String(retryAfterSeconds),
            },
          });
        }

        const authResult = checkAuth(
          clientIP,
          req.headers.get('Authorization'),
          this.securityConfig
        );
        if (!authResult.allowed) {
          return new Response('Unauthorized', {
            status: authResult.status ?? 401,
          });
        }

        const corsAllowed = origin ? matchOrigin(origin, this.securityConfig.corsAllowedOrigins) : false;

        try {
          const response = await this.router.handleRequest(req);
          if (corsAllowed && origin) {
            response.headers.set('Access-Control-Allow-Origin', origin);
            response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          }

          return response;
        } catch {
          const errorResponse = Response.json(
            {
              success: false,
              error: 'Request failed',
            },
            { status: 500 }
          );

          if (corsAllowed && origin) {
            errorResponse.headers.set('Access-Control-Allow-Origin', origin);
            errorResponse.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            errorResponse.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          }

          return errorResponse;
        }
      },
    });

    const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
    console.log(`Server running on http://${displayHost}:${port}`);
    if (this.generatedAuthToken && this.securityConfig.authToken) {
      console.log(`Dev server auth token: ${this.securityConfig.authToken}`);
    }
  }

  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
    this.rateLimiter.dispose();
    console.log('HTTP server stopped');
  }

  getFramework(): Fred {
    return this.framework;
  }
}
