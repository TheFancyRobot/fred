# Fred independent-line migration guide

This guide is the source of truth for the Phase 68 breaking release. Fred's
packages do not share one synchronized `v0.4.0` version. Each package remains
on its existing major line, and compatible stable versions are published together.

> **Warning:**
> Older guides and API-reference pages on the published documentation site
> describe the removed pre-Phase-68 facade. Until they are refreshed, use this
> guide and the linked package READMEs for the current stable API.

The version column records the final stable release set. Peer ranges describe
the compatible package lines and intentionally remain semver ranges.

## Package compatibility matrix

| Package | Version | Required Fred/peer line | Purpose |
| --- | --- | --- | --- |
| `@fancyrobot/fred` | `2.1.0` | `effect ^3.21.5`, `@effect/ai ^0.35.0`, `@effect/platform ^0.96.0` | Core `createFred()` client and Effect services |
| `@fancyrobot/fred-cli` | `0.7.0` | `effect ^3.21.0` | CLI, TUI, development chat, and API-key commands |
| `@fancyrobot/fred-dev` | `1.0.1` | CLI `^0.7.0` | Final deprecated compatibility shim |
| `@fancyrobot/fred-http` | `1.1.0` | Fred `^2.0.0`; `effect ^3.21.5`; `@effect/platform ^0.96.2`; `@effect/platform-bun ^0.89.0` | Optional Bun HTTP server and workflow endpoints |
| `@fancyrobot/fred-postgres` | `1.0.0` | Fred `^2.0.0`; `effect ^3.21.0` | Explicit PostgreSQL migrations and pgvector lifecycle |
| `@fancyrobot/fred-baml` | `1.0.0` | Fred `^2.0.0`; `effect ^3.21.0` | Consumer-owned BAML tools and prompt adapter |
| `@fancyrobot/fred-convex` | `1.0.0` | Fred `^2.0.0`; `convex ^1.42.1`; `effect ^3.21.0` | Convex runtime and tool adapters |
| `@fancyrobot/fred-anthropic` | `4.1.0` | Fred `^2.0.0`; `effect ^3.21.0`; `@effect/ai ^0.35.0`; `@effect/ai-anthropic ^0.25.0` | Anthropic provider |
| `@fancyrobot/fred-google` | `4.1.0` | Fred `^2.0.0`; `effect ^3.21.5`; `@effect/ai ^0.35.0`; `@effect/ai-google ^0.14.0`; `@effect/platform ^0.96.0` | Google provider |
| `@fancyrobot/fred-groq` | `4.1.0` | Fred `^2.0.0`; `effect ^3.21.5`; `@effect/ai ^0.35.0`; `@effect/platform ^0.96.0` | Groq provider |
| `@fancyrobot/fred-minimax` | `2.1.0` | Fred `^2.0.0`; `effect ^3.21.5`; `@effect/ai ^0.35.0`; `@effect/platform ^0.96.0` | MiniMax language and native multimodal adapters |
| `@fancyrobot/fred-openai` | `4.1.0` | Fred `^2.0.0`; `effect ^3.21.0`; `@effect/ai ^0.35.0`; `@effect/ai-openai ^0.39.0`; `@effect/ai-openrouter ^0.10.0` | OpenAI provider |
| `@fancyrobot/fred-openrouter` | `5.1.0` | Fred `^2.0.0`; `effect ^3.21.0`; `@effect/ai ^0.35.0`; `@effect/ai-openrouter ^0.10.0` | OpenRouter provider |

The final `@fancyrobot/fred-dev` shim requires CLI `^0.7.0`. Prefer removing
the shim rather than extending that compatibility window.

The stable release contains the Fred package subset below. The
Fred package specs are exact; Effect dependencies use the supported peer
ranges. Confirm these values against the published registry before installing.
Do not mix this release set with older Fred majors:

```bash
bun add \
  @fancyrobot/fred@2.1.0 \
  @fancyrobot/fred-http@1.1.0 \
  @fancyrobot/fred-minimax@2.1.0 \
  effect@^3.21.5 @effect/ai@^0.35.0 @effect/platform@^0.96.2 @effect/platform-bun@^0.89.0
```

Use the versions from the published matrix if they differ from this checkout.
See the
[release runbook](https://github.com/TheFancyRobot/fred/blob/main/RELEASE.md)
for dist-tag and promotion rules.

## `Fred` facade to `createFred`

The `Fred`, `FredBase`, `FredInstance`, and manager-style facade APIs were
removed. Promise consumers now own a scoped `FredClient` returned by
`createFred()`. Always call `shutdown()`.

Before:

```ts
import { Fred, type FredInstance } from '@fancyrobot/fred';

const fred: FredInstance = await Fred.create();
fred.registerTools(tools);
const agent = await fred.createAgent(agentConfig);
fred.setDefaultAgent('assistant');
const response = await fred.processMessage('Hello');
```

After:

```ts
import { createFred, type FredClient } from '@fancyrobot/fred';

const fred: FredClient = await createFred({
  routing: { defaultAgent: 'assistant', rules: [] },
});

await Promise.all(tools.map((tool) => fred.tools.register(tool)));
const agent = await fred.agents.register(agentConfig);
const response = await fred.messages.process('Hello');
await fred.shutdown();
```

The supported grouped capabilities are `agents`, `messages`, `tools`, `hooks`,
`templates`, `variables`, `workflows`, `sessions`, `providers`, `mcp`,
`warnings`, and `subagents`. `effects.run()` and `runtime` are explicit escape
hatches for programs that need the same scoped Effect services.

Effect-native applications import service tags, layers, and tagged errors from
`@fancyrobot/fred/effect`; core business logic must remain inside Effect rather
than adding new `Effect.runPromise` boundaries.

## Unified workflows

The V1 `PipelineConfig`, `compilePipelineV1`, Promise executor wrappers, and
PipelineService create/get/execute/utterance-routing methods were removed.
Define V2, graph, or native `WorkflowIR` definitions through one client API:

```ts
await fred.workflows.define({
  id: 'draft-review',
  steps: [
    { type: 'agent', name: 'draft', agentId: 'writer' },
    { type: 'agent', name: 'review', agentId: 'editor' },
  ],
});

const result = await fred.workflows.run(
  'draft-review',
  'Draft the launch note',
  { sessionId: 'release-session' },
);

const resumed = await fred.workflows.resume('run-id-from-paused-result', {
  humanInput: 'approve',
  resumeBehavior: 'continue',
});
```

In YAML/JSON, replace the old top-level `pipelines` array with the
`pipelinesV2` record and typed steps. Pipeline utterances no longer route
messages; use an explicit intent/routing rule or call `workflows.run()`.

## Development chat moves to the CLI

`@fancyrobot/fred-cli` owns development chat, provider detection, default-agent
setup, hot reload, and terminal cleanup. Use the exact CLI `0.7.0` version from
the stable matrix. Remove the compatibility package:

```bash
bun remove @fancyrobot/fred-dev
bun add -d --exact @fancyrobot/fred-cli@0.7.0
fred chat
```

If a temporary programmatic integration is unavoidable, change imports from
`@fancyrobot/fred-dev` to `@fancyrobot/fred-cli`. The `fred dev` command and
`@fancyrobot/fred-dev` are compatibility shims scheduled for removal in the
next major release.

## HTTP is opt-in with `withHttp`

Core stays transport-neutral. `ServerApp`, `startServer()`,
`createFredHttpApp()`, and the standalone fetch adapters were removed.

Before:

```ts
import { createFredHttpApp } from '@fancyrobot/fred-http';

const app = createFredHttpApp({ fred });
const server = Bun.serve({ port: 3000, fetch: app.fetch });
```

After:

```ts
import { createFred } from '@fancyrobot/fred';
import { withHttp } from '@fancyrobot/fred-http';

const fred = withHttp(await createFred(), {
  security: {
    requireAuth: true,
    corsAllowedOrigins: ['https://app.example.com'],
  },
});
const server = await fred.server.listen({ port: 3000 });

// On SIGINT/SIGTERM:
await fred.shutdown();
```

Move custom handlers to the `routes` option. `conversation_id` request-body
aliases were removed; send a printable `X-Session-Id` header to `/chat` and
`/v1/chat/completions`.

Workflow endpoints are also opt-in. Register workflows before `listen()` and
use an explicit production allowlist:

```ts
const fred = withHttp(core, {
  workflowEndpoints: {
    report: { auth: { scopes: ['workflows:run'] } },
    progress: { stream: true, auth: { scopes: ['workflows:stream'] } },
  },
});
```

Definitions and OpenAPI are snapshotted at `listen()`; restart the listener
after changing the workflow registry.

## API-key verifier migration and rotation

The development bearer token is for trusted local use. Production workflow
routes should use durable, scoped API-key storage shared by the server and CLI:

```bash
fred keys create --sqlite ./fred.db --scopes workflows:run,workflows:stream
fred keys create --postgres "$DATABASE_URL" --scopes workflows:run
```

New records use `argon2id-v1` by default. The default registry also provides
`scrypt-v1`, `pbkdf2-sha256-v1`, and read-only `sha256-v1`. Applications can
register `hmac-sha256-v1` with current/previous pepper keys or supply a reviewed
custom KMS/HSM-backed verifier. Verifier IDs are registry keys, not a closed
enum.

Important production rules:

- Inject HMAC pepper keys from a secret manager. Never persist them as verifier
  metadata, commit them, print them, or place them in examples.
- Benchmark the KDF on production hardware and bound authentication
  concurrency. Memory-hard settings can exhaust a small process under load.
- Legacy SHA-256 hashes cannot be converted offline because raw tokens are not
  stored. A successful, fully authorized request can lazily compare-and-swap
  the record to the configured default. Dormant keys must be revoked/reissued.
- Rotate by adding the new pepper/key ID, making it current, migrating or
  reissuing active keys, and only then removing the old secret. Roll back by
  restoring the prior registry/default while the prior secret is still
  available.
- Fred fails closed for unknown/disabled verifier IDs, invalid metadata,
  revoked/expired keys, missing scopes, and durable-store failures.

Keep `trustProxy` false unless a trusted edge overwrites forwarded-address
headers. Configure explicit CORS origins, body/time limits, durable rate-limit
storage, and redaction paths before production exposure.

## Stanza migration checklist

Stanza should validate against packed or registry release candidates in a
clean temporary checkout. Do not depend on a dirty Fred or Stanza worktree.

1. Replace local `file:../fred/packages/...` dependencies with the exact
   release-candidate versions from the matrix.
2. Replace `Fred`/`FredInstance` with `createFred`/`FredClient`.
3. Keep `Tool` on the supported `@fancyrobot/fred/tool/tool` subpath.
4. Replace direct `MiniMaxProviderFactory` setup with
   `import '@fancyrobot/fred-minimax'` and `fred.providers.use('minimax', config)`.
5. Keep BAML imports at `@fancyrobot/fred-baml`; the generated BAML client and
   renderer remain consumer-owned.
6. Keep Convex imports at `@fancyrobot/fred-convex` (and `/testing` only in
   tests); the generated Convex API, URL, and auth remain consumer-owned.
7. Replace `createFredHttpApp`/`FredHttpApp` with `withHttp`/`FredWithHttp`, and
   type custom routes as `FredHttpRoute`.
8. Start with `fred.server.listen()` and shut down with `fred.shutdown()`.

The repository includes a reference patch at
`docs/migration/stanza-phase68-step04.patch`; apply its intent to the clean
candidate checkout rather than applying it blindly.

## Removed API index

| Removed | Replacement |
| --- | --- |
| `Fred`, `FredBase`, `FredInstance` | `createFred()`, `FredClient` |
| manager-style facade accessors | grouped `FredClient` capabilities |
| `Fred.create()`, `new Fred()` | `await createFred()` |
| `createAgent`, `registerTool(s)`, `registerHook` | `agents.register`, `tools.register`, `hooks.register` |
| `processMessage` | `messages.process` |
| root `resume`/pending helpers | `workflows.resume`/`pending`/`listPending` |
| V1 pipeline config/compiler/executors | `workflows.define` and `workflows.run` |
| `@fancyrobot/fred-dev` implementation | `@fancyrobot/fred-cli`, `fred chat` |
| `ServerApp`, `startServer`, `createFredHttpApp` | `withHttp`, `server.listen` |

## Verification

After migration, run the consumer with a frozen install and no workspace
resolution:

```bash
bun install --frozen-lockfile
bunx tsc --noEmit
bun test
bun run build
```

For Fred itself, the release gates also include declarations, documentation,
all 15 examples, tarball contents, and an isolated offline consumer. Stable
promotion waits for those gates and the external Stanza candidate build.
