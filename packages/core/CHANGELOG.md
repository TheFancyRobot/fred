# @fred/core

## 2.0.0-alpha.2

### Patch Changes

- [#88](https://github.com/TheFancyRobot/fred/pull/88) [`d66c541`](https://github.com/TheFancyRobot/fred/commit/d66c541f3e7d235f7c305679d4cc84a070317ab6) Thanks [@sincspecv](https://github.com/sincspecv)! - Require `effect@^3.21.5` in packages that directly peer on the
  `@effect/platform` 0.96 line. The reviewed workspace lock resolves
  `@effect/platform@0.96.3`, whose Effect peer range starts at 3.21.5. This is a
  compatibility boundary; no upstream vulnerability is being claimed for Effect
  3.21.0 through 3.21.4.

- [#84](https://github.com/TheFancyRobot/fred/pull/84) [`ca49ada`](https://github.com/TheFancyRobot/fred/commit/ca49ada282c008a42c2bbdaacf5ed5dc7c472cd8) Thanks [@sincspecv](https://github.com/sincspecv)! - Allow typed tools to cross the scoped client and registry boundaries without unsafe consumer casts.

## 2.0.0-alpha.1

### Minor Changes

- [#66](https://github.com/TheFancyRobot/fred/pull/66) [`c3d92d2`](https://github.com/TheFancyRobot/fred/commit/c3d92d2831a936a9ab6bf0ef43afb920bf88b1ce) Thanks [@sincspecv](https://github.com/sincspecv)! - Add transport-neutral typed workflow discovery and execution, opt-in generated
  JSON/SSE workflow endpoints, scoped hash-only API keys with durable stores,
  persistent rate limiting, hardened HTTP configuration, and the keys CLI.

- [#62](https://github.com/TheFancyRobot/fred/pull/62) [`b51ebb1`](https://github.com/TheFancyRobot/fred/commit/b51ebb1f7861647b562411399642eacd4d404c0c) Thanks [@sincspecv](https://github.com/sincspecv)! - Add text, template, and BAML-backed agent prompt sources plus programmatic Effect Schema input/output validation, malformed-output repair, typed direct agent execution, structured evaluation artifacts, and a consumer-owned BAML prompt adapter layer.

### Patch Changes

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

- [#68](https://github.com/TheFancyRobot/fred/pull/68) [`1fdb1db`](https://github.com/TheFancyRobot/fred/commit/1fdb1db156eb6dda340a7f9f4d3f673197ec4b05) Thanks [@sincspecv](https://github.com/sincspecv)! - Move development chat, provider/default-agent helpers, setup loading, hot reload,
  and lifecycle ownership into `@fancyrobot/fred-cli`. Publish
  `@fancyrobot/fred-dev` as a final deprecated re-export shim with migration
  guidance before removing it in the next major release.

  Declare the core comparison runtime dependencies required when packed CLI
  consumers load Fred through Bun's source export condition.

## 2.0.0-alpha.0

### Major Changes

- [#54](https://github.com/TheFancyRobot/fred/pull/54) [`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217) Thanks [@sincspecv](https://github.com/sincspecv)! - Effect-first core rewrite (Phase 60): the Fred facade is now a thin kernel over Effect services.

  Breaking changes:

  - The snapshot/replay hot-reload machinery is gone. The Effect runtime is built lazily exactly once and never invalidated; configuration changes (`configureRouting`, `configureWorkflows`, `enableTracing`, `registerIntents`) are live service mutations. `configureObservability` after the runtime is built warns instead of rebuilding.
  - The built-in calculator tool now lives in the runtime tool registry (previously snapshot-only and invisible to agents).
  - `shutdown()` followed by reuse rebuilds a fresh runtime with instance-level settings only — registered tools/agents/intents are not replayed.
  - `registerIntents` is an additive upsert by intent id (previously replaced the full set).

  New APIs:

  - `createFred(options?): Promise<FredClient>` — scoped Promise client with `agents`, `workflows`, `sessions`, `providers` sub-APIs, a `runtime` escape hatch, and idempotent `shutdown()` (use-after-shutdown rejects with `FredClientClosedError`).
  - `@fancyrobot/fred/effect` is the complete Effect-native entry point: all service tags, live layers, `makeFredRuntimeLayer`, and tagged errors.

## 1.0.0

### Major Changes

- [#41](https://github.com/TheFancyRobot/fred/pull/41) [`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103) Thanks [@sincspecv](https://github.com/sincspecv)! - v0.3.0 finalizes the Effect-first public API surface for `@fancyrobot/fred`.

  ## Breaking changes

  ### Imperative manager classes removed

  The following imperative manager classes are no longer part of the public API:

  - `ToolRegistry`
  - `AgentManager`
  - `PipelineManager`
  - `ContextManager`
  - `HookManager`
  - `ProviderRegistry`
  - `MessageRouter`
  - Promise-wrapper methods from `MessageProcessor`

  ### Imperative class exports removed

  The following imperative class exports are removed from the package surface:

  - `IntentMatcher` class
  - `IntentRouter` class
  - `WorkflowManager` class

  ### Effect service tags are the replacement API

  Use Effect services from the public API surface:

  - `ToolRegistryService`
  - `AgentService`
  - `PipelineService`
  - `ContextStorageService`
  - `HookManagerService`
  - `ProviderRegistryService`
  - `MessageRouterService`
  - `IntentMatcherService`
  - `IntentRouterService`
  - `WorkflowService`

  ### Public sub-path imports

  Public sub-paths are now the supported import path for domain-specific APIs:

  - `@fancyrobot/fred/eval`
  - `@fancyrobot/fred/context/sqlite`
  - `@fancyrobot/fred/context/postgres`
  - `@fancyrobot/fred/tools`

  ### `package.json` exports now define the public boundary

  Deep imports outside defined export paths are not part of the supported API surface.

  ## Migration examples

  ### 1) Effect services instead of imperative classes

  Before:

  ```ts
  import { ToolRegistry } from "@fancyrobot/fred";

  const registry = new ToolRegistry();
  registry.register(tool);
  ```

  After:

  ```ts
  import { Effect } from "effect";
  import { ToolRegistryService } from "@fancyrobot/fred";

  const program = Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    yield* registry.registerTools([tool]);
  });
  ```

  ### 2) `Fred` class remains available

  Before:

  ```ts
  import { Fred } from "@fancyrobot/fred";

  const fred = new Fred(config);
  const response = await fred.processMessage("hello");
  ```

  After:

  ```ts
  import { Fred } from "@fancyrobot/fred";

  const fred = new Fred(config);
  const response = await fred.processMessage("hello");
  ```

  `Fred` still works for consumers and now delegates to Effect services internally.

  ### 3) Eval imports move to sub-path

  Before:

  ```ts
  import { runEvaluation, EvaluationSuite } from "@fancyrobot/fred";
  ```

  After:

  ```ts
  import { runEvaluation, EvaluationSuite } from "@fancyrobot/fred/eval";
  ```

  ### 4) Storage imports move to sub-path

  Before:

  ```ts
  import { createSQLiteStorage } from "@fancyrobot/fred";
  ```

  After:

  ```ts
  import { createSQLiteStorage } from "@fancyrobot/fred/context/sqlite";
  ```

### Patch Changes

- [#41](https://github.com/TheFancyRobot/fred/pull/41) [`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103) Thanks [@sincspecv](https://github.com/sincspecv)! - Fix TUI session persistence, session picker UX, and slash command search

  - Fix session persistence by delegating `listSessions()` to storage adapter
  - Skip session picker when no previous sessions exist
  - Add `/exit` command to command palette
  - Lowercase all slash command labels

## 0.2.2

### Patch Changes

- Release `@fancyrobot/fred` as `0.2.2` for the v0.2.2 milestone cut from PR #33.

## 0.2.1

### Patch Changes

- [#30](https://github.com/TheFancyRobot/fred/pull/30) [`6197d13`](https://github.com/TheFancyRobot/fred/commit/6197d130f10fa52ef2008effc0043c1b59158e86) Thanks [@sincspecv](https://github.com/sincspecv)! - Implemented portable TUI with session management for all fred projects

- [#28](https://github.com/TheFancyRobot/fred/pull/28) [`d524cb7`](https://github.com/TheFancyRobot/fred/commit/d524cb723370088fc0eb3516ad621b41994f5aa4) Thanks [@sincspecv](https://github.com/sincspecv)! - Implemented observability and logging functionality along with tool gating.

## 0.2.0

### Minor Changes

- [`e7f17bb`](https://github.com/TheFancyRobot/fred/commit/e7f17bbcb4c7d408a4df9817565c5837576bb978) Thanks [@sincspecv](https://github.com/sincspecv)! - Release v0.2.5 - Monorepo conversion complete with Effect-based services, built-in calculator tool, streaming support, and automatic package publishing
