# 14 - Optional HTTP Layer

This project turns a core Fred client into a Bun HTTP server with the optional
`@fancyrobot/fred-http` package. It includes a credential-free infrastructure
smoke run and an optional OpenRouter-backed live client.

## What you'll learn

- Enhance `createFred()` explicitly with `withHttp()`
- Start on a fixed or ephemeral port and shut down cleanly
- Configure bearer auth, CORS, request limits, timeouts, and rate limiting
- Inspect health, live status, agents, intents, tools, OpenAPI, and API docs
- Call Fred's native `/message` and `/chat` endpoints
- Continue a conversation with `X-Session-Id`
- Use the OpenAI SDK for normal and SSE-streaming chat completions

The core client has no HTTP listener of its own:

```ts
const core = await createFred();
const fred = withHttp(core, { /* HTTP-only options */ });
const server = await fred.server.listen({ port: 3000 });
```

## 1. Run the credential-free smoke test

From this directory:

```bash
bun run smoke
```

This starts a real server on an ephemeral port and verifies CORS, bearer auth,
admin endpoints, OpenAPI/docs, rate limiting, and coordinated shutdown. It does
not load a provider or make an external request.

## 2. Configure live chat

```bash
cp .env.example .env
```

Set `OPENROUTER_API_KEY` in the server's environment. The HTTP client never
needs the provider key; it only needs the optional HTTP bearer token. The default model is
`openrouter/free`; override it with `FRED_EXAMPLE_MODEL` if desired.

Start the server in one terminal:

```bash
bun run start
```

Run all native, OpenAI-compatible, session, and streaming client calls in a
second terminal:

```bash
bun run client
```

You can also inspect:

- <http://127.0.0.1:3000/health>
- <http://127.0.0.1:3000/status>
- <http://127.0.0.1:3000/docs>
- <http://127.0.0.1:3000/docs/openapi.json>

## Enable authentication

Generate a strong random token and set it only in your environment or secret
manager:

```bash
FRED_HTTP_AUTH_TOKEN='replace-with-a-long-random-secret' bun run start
```

`src/server.ts` passes that value into the HTTP security options and enables
`requireAuth`. `src/client.ts` sends the same value as a bearer token. The
important pieces are:

```ts
const fred = withHttp(core, {
  security: {
    requireAuth: true,
    authToken: process.env.FRED_HTTP_AUTH_TOKEN,
  },
});

await fetch(`${serverUrl}/health`, {
  headers: {
    Authorization: `Bearer ${process.env.FRED_HTTP_AUTH_TOKEN}`,
  },
});
```

For the OpenAI SDK, use the HTTP token as its `apiKey`; the SDK sends it as a
bearer token automatically:

```ts
const openai = new OpenAI({
  apiKey: process.env.FRED_HTTP_AUTH_TOKEN,
  baseURL: `${serverUrl}/v1`,
});
```

Never embed a real token in source code or commit it to `.env`.

## Useful curl calls

Without auth:

```bash
curl http://127.0.0.1:3000/health
```

With auth:

```bash
curl \
  -H "Authorization: Bearer $FRED_HTTP_AUTH_TOKEN" \
  http://127.0.0.1:3000/health
```

Continue a session:

```bash
curl -i \
  -H "Authorization: Bearer $FRED_HTTP_AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: my-demo-session" \
  -d '{"message":"Hello from curl"}' \
  http://127.0.0.1:3000/message
```

## Lifecycle

- `server.close()` or `fred.server.stop()` stops only the HTTP listener.
- `fred.shutdown()` stops HTTP and releases the underlying Fred runtime.
- The standalone server handles `SIGINT` and `SIGTERM` with coordinated shutdown.
