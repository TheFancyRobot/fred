# @fancyrobot/fred-http

Reusable Bun HTTP server package for Fred.

Migrating from `ServerApp`, `startServer()`, or `createFredHttpApp()`? Follow
the [Phase 68 migration matrix and security guide](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md).

## Installation

```bash
bun add @fancyrobot/fred-http@1.1.0 \
  @fancyrobot/fred@2.2.0 effect@^3.21.5 \
  @effect/platform@^0.96.2 @effect/platform-bun@^0.89.0
```

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

The runnable [HTTP workflows example](https://github.com/TheFancyRobot/fred/tree/main/examples/15-http-workflows)
includes default/custom paths, public/inherited/scoped auth, CORS and limiter
checks, a deterministic smoke client, and durable SQLite/Postgres key guidance.

## Durable scoped API keys

Use the CLI to create a key in the same SQLite or Postgres store used by the
server:

```bash
fred keys create --sqlite ./fred.db --scopes workflows:run,workflows:stream
fred keys create --sqlite ./fred.db --verifier scrypt-v1 --expires-at 2027-01-01T00:00:00Z
```

New keys use `argon2id-v1` by default. `scrypt-v1` and
`pbkdf2-sha256-v1` are also registered by the default verifier registry;
PBKDF2-HMAC-SHA-256 is the built-in choice for FIPS-oriented deployments.
`hmac-sha256-v1` is available when the application supplies current/previous
pepper keys programmatically. Verifier IDs are registry keys, not a closed
enum, so a deployment can register a reviewed KMS/HSM-backed implementation.

Only a one-way verifier, its stable algorithm/version, and verifier-owned
non-secret metadata are persisted. The raw key is printed once after
persistence succeeds. Pepper values are never record metadata and must come
from a secret manager. The CLI rejects in-memory storage and rejects unknown or
disabled verifier IDs before emitting a token.

```ts
import {
  makeApiKeyVerifierRegistry,
  makeArgon2idApiKeyVerifier,
  makeHmacApiKeyVerifier,
  makeMemoryApiKeyStore,
  withHttp,
} from '@fancyrobot/fred-http';

const verifiers = makeApiKeyVerifierRegistry([
  makeArgon2idApiKeyVerifier(),
  makeHmacApiKeyVerifier({
    currentKeyId: 'pepper-2026-07',
    keys: {
      'pepper-2026-07': currentPepperFromSecretManager,
      'pepper-2026-06': previousPepperFromSecretManager,
    },
  }),
]);

const fred = withHttp(core, {
  apiKeyStore: makeMemoryApiKeyStore(),
  apiKeyVerifierRegistry: verifiers,
});
```

### Migration, rotation, and rollback

SQLite and Postgres initialization add verifier and expiration columns with
idempotent migrations. Rows without a verifier descriptor decode as the
read-only `sha256-v1` legacy format. They cannot be converted offline because
Fred never stores the raw token. After a legacy token authenticates and passes
revocation, expiration, and scope checks, Fred derives the configured default
and performs a compare-and-swap update; concurrent requests can upgrade the row
only once. A failed upgrade leaves the verified legacy row intact.

For pepper rotation, keep both key IDs available, make the new ID current, and
reissue or lazily migrate keys before removing the previous secret. Rollback
means restoring the prior registry/default while its pepper remains available.
Dormant SHA-256 records should be revoked and reissued by a deployment-defined
retirement date; they cannot be silently bulk-rehashed.

### Capacity and parameter bounds

Defaults are bounded before cryptographic work: Argon2id memory 19,456 KiB and
time cost 2 (allowed 4,096-262,144 KiB / 1-10), scrypt N=16,384/r=8/p=1
(allowed N 4,096-65,536, r 8-16, p 1-4), and PBKDF2 600,000 iterations
(allowed 100,000-2,000,000). On the project validation machine, a three-sample
serial derive+verify smoke measured approximately 29 ms Argon2id, 52 ms scrypt,
84 ms PBKDF2, and under 1 ms HMAC. Treat these as a smoke envelope, benchmark on
production hardware, and cap authentication concurrency according to the
chosen memory-hard settings.

## Custom routes

Consumer-defined routes compose through `withHttp()` and the canonical Effect
router:

```ts
import { createFred } from '@fancyrobot/fred';
import { withHttp } from '@fancyrobot/fred-http';

const fred = withHttp(await createFred(), {
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

const server = await fred.server.listen();
const response = await fetch(`${server.url}/public/ping`);
await fred.shutdown();
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

`withHttp()` uses the listener's remote address and does not trust proxy headers
by default. Only set `trustProxy: true` when the deployment boundary guarantees
`x-forwarded-for` / `x-real-ip` are trustworthy. `fred.shutdown()` closes the
listener scope and the underlying Fred client.

## Built-in endpoints

- `POST /v1/chat/completions` (OpenAI-compatible JSON and SSE)
- `POST /message` and `POST /chat`
- `GET /health`, `/status`, `/agents`, `/intents`, and `/tools`
- `GET /docs` and `/docs/openapi.json`
