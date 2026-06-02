# @fancyrobot/fred-http

Reusable Bun HTTP server package for Fred.

## Scope

`@fancyrobot/fred-http` provides:
- simple server startup APIs for Fred-backed HTTP services
- a composable HTTP app API for consumer-defined routes
- one shared security pipeline for built-in Fred routes and custom handlers

## Runtime

`@fancyrobot/fred-http` is Bun-only in this phase.

## Simple mode

```ts
import { Fred } from '@fancyrobot/fred';
import { ServerApp } from '@fancyrobot/fred-http';

const fred = new Fred();
const app = new ServerApp(fred);
await app.start(3000);
```

## Composable mode

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
