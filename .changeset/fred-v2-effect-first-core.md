---
"@fancyrobot/fred": major
"@fancyrobot/fred-http": major
---

Effect-first core rewrite: `createFred()`/`FredClient` and the Effect service entrypoint replace the legacy `Fred` facade.

Breaking changes:

- `Fred`, `FredBase`, `FredInstance`, their manager-style accessors, and the legacy config-initializer adapter are removed. Promise consumers use `createFred()` and its grouped `FredClient` capabilities; Effect consumers use `@fancyrobot/fred/effect`.
- The snapshot/replay hot-reload machinery is gone. The Effect runtime is built lazily exactly once and never invalidated; configuration changes (`configureRouting`, `configureWorkflows`, `enableTracing`, `registerIntents`) are live service mutations. `configureObservability` after the runtime is built warns instead of rebuilding.
- The built-in calculator tool now lives in the runtime tool registry (previously snapshot-only and invisible to agents).
- `shutdown()` followed by reuse rebuilds a fresh runtime with instance-level settings only — registered tools/agents/intents are not replayed.
- `registerIntents` is an additive upsert by intent id (previously replaced the full set).
- `@fancyrobot/fred-http` removes the deprecated `ServerApp`, `startServer`, and `createFredHttpApp` adapters, along with the legacy `conversation_id` request fields. Use `withHttp()` and session ids instead.

New APIs:

- `createFred(options?): Promise<FredClient>` — scoped Promise client with `agents`, `workflows`, `sessions`, `providers` sub-APIs, a `runtime` escape hatch, and idempotent `shutdown()` (use-after-shutdown rejects with `FredClientClosedError`).
- `@fancyrobot/fred/effect` is the complete Effect-native entry point: all service tags, live layers, `makeFredRuntimeLayer`, and tagged errors.
