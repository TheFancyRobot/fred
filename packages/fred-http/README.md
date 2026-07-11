# @fancyrobot/fred-http

Reusable Bun HTTP server package for Fred.

## Scope

`@fancyrobot/fred-http` provides an optional HTTP enhancement for Fred, a
schema-first Effect `HttpApi`, OpenAPI/Swagger endpoints, and a shared security
pipeline. Importing `@fancyrobot/fred` alone has no HTTP side effects.

## Runtime

`@fancyrobot/fred-http` is Bun-only in this phase.

## Recommended: optional HTTP enhancement

```ts
import { createFred } from '@fancyrobot/fred';
import { withHttp } from '@fancyrobot/fred-http';

const fred = withHttp(await createFred(), {
  security: { authToken: process.env.FRED_DEV_SERVER_TOKEN },
});
const server = await fred.server.listen({ port: 3000 });
console.log(server.url);
// Auth is required by default. If no token was configured, Fred generates one
// and exposes it on the handle so a trusted local client can authenticate.
// Treat server.authToken as a secret: pass it directly, never log it.

// Closes the HTTP-owned child scope, then the core Fred client.
await fred.shutdown();
```

The enhancer returns a new view and does not mutate the supplied core client.
Call `server.stop()` to stop and restart only HTTP, or `shutdown()` for
coordinated cleanup.

## Declarative workflow endpoints

Define typed workflows on core, then opt selected workflows into HTTP when the
listener is created:

```ts
import { createFred, defineWorkflow } from '@fancyrobot/fred';
import { withHttp } from '@fancyrobot/fred-http';
import { Schema } from 'effect';

const core = await createFred();
await core.workflows.define(defineWorkflow({
  id: 'greet',
  entry: 'greet',
  nodes: [{
    id: 'greet',
    kind: 'function',
    fn: () => ({ message: 'hello' }),
  }],
  edges: [],
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.Struct({ message: Schema.String }),
}));

const fred = withHttp(core, {
  workflowEndpoints: {
    greet: { auth: { scopes: ['workflows:run'] } },
  },
});
```

`workflowEndpoints: true` exposes every registered workflow at
`POST /workflows/:id`. The record form exposes only named workflows and can set
an absolute `path`, `stream: true`, or `auth: false | { scopes }`. Omitted auth
inherits authenticated server access; `auth: false` is an explicit public
opt-out; every listed scope is required. Definitions and OpenAPI are
snapshotted at `listen()`, so restart the listener after registry changes.

JSON endpoints return completed/paused/failed execution envelopes whose
completed output is derived from the workflow output Schema. Streaming
endpoints use SSE lifecycle events: `started`, `node-completed`, and exactly one
terminal `completed` or `failed` event.

The runnable [HTTP workflows example](../../examples/15-http-workflows/)
includes default/custom paths, public/inherited/scoped auth, CORS and limiter
checks, a deterministic smoke client, and durable SQLite/Postgres key guidance.

## Durable scoped API keys

Use the CLI to create a key in the same SQLite or Postgres store used by the
server:

```bash
fred keys create --sqlite ./fred.db --scopes workflows:run,workflows:stream
```

Only the hash is persisted. The raw key is printed once after persistence
succeeds; store it in a secret manager, rotate by issuing a replacement, and
revoke the old record. The CLI rejects in-memory storage.

## Deprecated compatibility adapters

`ServerApp` and `createFredHttpApp` remain available for one release. They now
delegate built-in routes to the same Effect `HttpApi` implementation and will
be removed in the next major release.

The fetch adapter continues to support consumer-defined routes:

```ts
import { Fred } from '@fancyrobot/fred';
import { createFredHttpApp } from '@fancyrobot/fred-http';

const fred = new Fred();
const app = createFredHttpApp({
  fred,
  security: { requireAuth: false },
  routes: [
    {
      method: 'GET',
      path: '/public/ping',
      visibility: 'public',
      handler: () => new Response('pong', { status: 200 }),
    },
  ],
});

const response = await app.fetch(new Request('http://localhost/public/ping'));
await app.dispose();
```

## Route visibility

- `public` routes skip auth but still pass through shared request handling
- `authenticated` routes require auth unless explicitly disabled in security config

## Security model

The package applies a shared security-first request path:
- CORS preflight
- route classification
- rate limiting
- auth for authenticated routes
- route handler execution
- conditional CORS response headers
- sanitized errors

Custom route failures return sanitized error payloads and should not leak raw exception details.

`createFredHttpApp()` does not trust proxy headers by default. If your embedding server has a trusted client-IP source, pass `getClientIp(request)` explicitly. Only set `trustProxy: true` when the deployment boundary guarantees `x-forwarded-for` / `x-real-ip` are trustworthy.

Composable apps expose async `dispose()` so callers release both the web-handler
scope and rate-limiter resources during teardown.

## Built-in endpoints

- `POST /v1/chat/completions` (OpenAI-compatible JSON and SSE)
- `POST /message` and `POST /chat`
- `GET /health`, `/status`, `/agents`, `/intents`, and `/tools`
- `GET /docs` and `/docs/openapi.json`
