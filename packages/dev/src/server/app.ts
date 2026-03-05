import { Fred, sanitizeError } from '@fancyrobot/fred';
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

/**
 * HTTP server application
 */
export class ServerApp {
  private framework: Fred;
  private handlers: ServerHandlers;
  private router: Router;
  private chatRoutes: ChatRoutes;
  private server: any;
  private securityConfig: ServerSecurityConfig;
  private rateLimiter: RateLimiter;

  constructor(framework: Fred, securityConfig?: Partial<ServerSecurityConfig>) {
    this.framework = framework;
    this.handlers = new ServerHandlers(framework);
    this.securityConfig = {
      ...DEFAULT_SECURITY_CONFIG,
      ...securityConfig,
    };
    this.rateLimiter = new RateLimiter(
      this.securityConfig.rateLimitMaxRequests,
      this.securityConfig.rateLimitWindowMs
    );

    // Initialize chat routes
    const chatContextAdapter = {
      generateConversationId: () => framework.generateConversationId(),
      getHistory: (conversationId: string) => framework.getHistory(conversationId),
      addMessage: (conversationId: string, message: Prompt.MessageEncoded) =>
        framework.addMessages(conversationId, [message]),
    };
    const chatHandlers = new ChatHandlers(framework, chatContextAdapter);
    this.chatRoutes = new ChatRoutes(chatHandlers);

    this.router = new Router(this.handlers, this.chatRoutes);
  }

  /**
   * Start the HTTP server
   */
  async start(port: number = 3000, hostname: string = '0.0.0.0'): Promise<void> {
    this.server = Bun.serve({
      port,
      hostname,
      maxRequestBodySize: this.securityConfig.maxRequestBodySize,
      idleTimeout: this.securityConfig.requestTimeoutSeconds,
      fetch: async (req, server) => {
        const origin = req.headers.get('Origin');

        // Handle CORS
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

        try {
          const response = await this.router.handleRequest(req);

          // Add CORS headers to response
          const corsAllowed = origin ? matchOrigin(origin, this.securityConfig.corsAllowedOrigins) : false;
          if (corsAllowed && origin) {
            response.headers.set('Access-Control-Allow-Origin', origin);
            response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
          }

          return response;
        } catch (error) {
          // Sanitize error message to prevent information leakage
          const sanitized = sanitizeError(error, 'Request failed');
          return Response.json(
            {
              success: false,
              error: sanitized.message,
            },
            { status: 500 }
          );
        }
      },
    });

    const displayHost = hostname === '0.0.0.0' ? 'localhost' : hostname;
    console.log(`Server running on http://${displayHost}:${port}`);
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (this.server) {
      this.server.stop();
    }
    this.rateLimiter.dispose();
    console.log('HTTP server stopped');
  }

  /**
   * Get the framework instance
   */
  getFramework(): Fred {
    return this.framework;
  }
}
