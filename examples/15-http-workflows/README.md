# 15 - HTTP Workflows

This project exposes Fred workflows declaratively through the optional
`@fancyrobot/fred-http` package. It uses deterministic function workflows, so
the server and smoke test do not need an AI provider key.

## What you'll learn

- Keep core `createFred()` transport-neutral and opt into HTTP with `withHttp()`
- Derive request, response, and OpenAPI schemas from workflow Effect Schemas
- Use the default `/workflows/:id` path and a custom path
- Configure inherited, explicitly public, and all-required scoped auth
- Consume a JSON execution envelope and ordered SSE lifecycle events
- Configure CORS, request limits, timeouts, and per-key/per-IP rate limits
- Create durable API keys whose raw secret is returned exactly once

## Run the credential-free smoke test

```bash
bun run smoke
```

The smoke command starts on an ephemeral port and verifies typed JSON, SSE
event order and terminal cardinality, the auth matrix, CORS, rate limiting,
and generated OpenAPI. It uses in-memory stores only as deterministic fixtures
and makes no external network call.

## Create a durable key and run the server

The standalone server uses SQLite. Create its directory, then mint a key with
both scopes used by the protected examples:

```bash
mkdir -p .fred
bunx fred keys create \
  --sqlite .fred/http.sqlite \
  --scopes workflows:run,workflows:stream
```

The command prints the raw key once, after the hash has been persisted. Copy it
to `FRED_HTTP_API_KEY` in an untracked `.env` or secret manager. Fred cannot
recover it later. To rotate a key, create a replacement, update clients, then
revoke the old record. Never commit a raw key, provider key, or populated
SQLite database.

```bash
cp .env.example .env
bun run start
```

In a second terminal, with the same environment loaded:

```bash
bun run client
```

For Postgres, run `fred keys create --postgres "$DATABASE_URL" ...` and provide
a `makePostgresApiKeyStore()` adapter backed by your application pool. The
server and CLI must use the same durable store. In-memory keys are suitable for
tests and local fixtures, but `fred keys create` intentionally rejects them.

## Endpoint declaration

`src/server.ts` registers workflows on core, then snapshots them when the HTTP
listener starts:

```ts
const core = await createFred();
await core.workflows.define(defineWorkflow({
  id: 'greet',
  // input/output schemas and graph omitted here
}));

const fred = withHttp(core, {
  workflowEndpoints: {
    greet: {}, // POST /workflows/greet; inherits authenticated access
    normalize: { path: '/public/normalize', auth: false },
    sum: { path: '/workflows/secure-sum', auth: { scopes: ['workflows:run'] } },
    progress: { stream: true, auth: { scopes: ['workflows:stream'] } },
  },
});
```

Use `workflowEndpoints: true` to expose every workflow with default paths and
inherited auth. The record form is safer for production because exposure is an
explicit allowlist. `auth: false` is a deliberate public opt-out; only use it
for workflows designed for anonymous, untrusted callers.

The registry is snapshotted by `server.listen()`. Define workflows before
listening and restart the listener after changing definitions.

## Response contracts

JSON endpoints return a stable envelope with `status` equal to `completed`,
`paused`, or `failed`. The completed `output` schema is the workflow output
Schema. SSE endpoints emit `started`, zero or more `node-completed` events, and
exactly one terminal `completed` or `failed` event. Cancel the response reader
when a client disconnects so the server can interrupt and release the stream.

## Production checklist

- Persist API keys and limiter state in SQLite or Postgres for restart safety.
- Put CORS origins on an explicit allowlist.
- Set body and timeout limits for the workload.
- Leave `trustProxy` off unless a trusted reverse proxy overwrites forwarding headers.
- Store only hashes; rotate and revoke keys through the storage boundary.
- Do not expose workflows publicly unless their side effects and abuse limits are safe.
