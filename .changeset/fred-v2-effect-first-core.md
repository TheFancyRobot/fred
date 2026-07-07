---
"@fancyrobot/fred": major
---

Effect-first core rewrite (Phase 60): the Fred facade is now a thin kernel over Effect services.

Breaking changes:

- The snapshot/replay hot-reload machinery is gone. The Effect runtime is built lazily exactly once and never invalidated; configuration changes (`configureRouting`, `configureWorkflows`, `enableTracing`, `registerIntents`) are live service mutations. `configureObservability` after the runtime is built warns instead of rebuilding.
- The built-in calculator tool now lives in the runtime tool registry (previously snapshot-only and invisible to agents).
- `shutdown()` followed by reuse rebuilds a fresh runtime with instance-level settings only — registered tools/agents/intents are not replayed.
- `registerIntents` is an additive upsert by intent id (previously replaced the full set).

New APIs:

- `createFred(options?): Promise<FredClient>` — scoped Promise client with `agents`, `workflows`, `sessions`, `providers` sub-APIs, a `runtime` escape hatch, and idempotent `shutdown()` (use-after-shutdown rejects with `FredClientClosedError`).
- `@fancyrobot/fred/effect` is the complete Effect-native entry point: all service tags, live layers, `makeFredRuntimeLayer`, and tagged errors.
