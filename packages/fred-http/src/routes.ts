import { sanitizeError } from '@fancyrobot/fred';
import { ServerHandlers, validateMessageRequest } from './handlers';
import { ChatRoutes } from './chat/routes';

type RouteHandler = (request: Request) => Promise<Response>;

export class Router {
  private handlers: ServerHandlers;
  private routes: Map<string, RouteHandler> = new Map();
  private chatRoutes?: ChatRoutes;

  constructor(handlers: ServerHandlers, chatRoutes?: ChatRoutes) {
    this.handlers = handlers;
    this.chatRoutes = chatRoutes;
    this.setupRoutes();
  }

  private setupRoutes(): void {
    this.routes.set('POST /message', async (req) => {
      try {
        const body = await req.json();
        const validatedBody = validateMessageRequest(body);
        const response = await this.handlers.handleMessage(validatedBody);
        return Response.json(response);
      } catch (error) {
        const sanitized = sanitizeError(error, 'Invalid request');
        return Response.json(
          { success: false, error: sanitized.message },
          { status: 400 }
        );
      }
    });

    this.routes.set('GET /agents', async () => {
      const response = await this.handlers.handleListAgents();
      return Response.json(response);
    });

    this.routes.set('GET /intents', async () => {
      const response = await this.handlers.handleListIntents();
      return Response.json(response);
    });

    this.routes.set('GET /tools', async () => {
      const response = await this.handlers.handleListTools();
      return Response.json(response);
    });

    this.routes.set('GET /health', async () => {
      return Response.json({ status: 'ok', timestamp: new Date().toISOString() });
    });

    if (this.chatRoutes) {
      this.routes.set('POST /v1/chat/completions', async (req) => {
        return this.chatRoutes!.handleChatCompletions(req);
      });

      this.routes.set('POST /chat', async (req) => {
        return this.chatRoutes!.handleChat(req);
      });
    }
  }

  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;
    const routeKey = `${method} ${path}`;
    const handler = this.routes.get(routeKey);

    if (handler) {
      return handler(request);
    }

    return Response.json(
      { success: false, error: 'Route not found' },
      { status: 404 }
    );
  }
}
