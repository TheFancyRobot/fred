# @fred/dev

## 1.0.0

### Major Changes

- [#68](https://github.com/TheFancyRobot/fred/pull/68) [`1fdb1db`](https://github.com/TheFancyRobot/fred/commit/1fdb1db156eb6dda340a7f9f4d3f673197ec4b05) Thanks [@sincspecv](https://github.com/sincspecv)! - Move development chat, provider/default-agent helpers, setup loading, hot reload,
  and lifecycle ownership into `@fancyrobot/fred-cli`. Publish
  `@fancyrobot/fred-dev` as a final deprecated re-export shim with migration
  guidance before removing it in the next major release.

  Declare the core comparison runtime dependencies required when packed CLI
  consumers load Fred through Bun's source export condition.

### Patch Changes

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## 1.0.0-alpha.1

### Major Changes

- [#68](https://github.com/TheFancyRobot/fred/pull/68) [`1fdb1db`](https://github.com/TheFancyRobot/fred/commit/1fdb1db156eb6dda340a7f9f4d3f673197ec4b05) Thanks [@sincspecv](https://github.com/sincspecv)! - Move development chat, provider/default-agent helpers, setup loading, hot reload,
  and lifecycle ownership into `@fancyrobot/fred-cli`. Publish
  `@fancyrobot/fred-dev` as a final deprecated re-export shim with migration
  guidance before removing it in the next major release.

  Declare the core comparison runtime dependencies required when packed CLI
  consumers load Fred through Bun's source export condition.

### Patch Changes

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## Unreleased

### Major Changes

- Reduce `@fancyrobot/fred-dev` to its final deprecated compatibility shim, forwarding root and `./chat-defaults` APIs to `@fancyrobot/fred-cli`.
- Remove the duplicate dev-chat, workflow-context, watcher, and server-command implementations. Install `@fancyrobot/fred-cli` and use `fred chat`; this shim will be removed in the next major release.

## 1.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217)]:
  - @fancyrobot/fred@2.0.0-alpha.0
  - @fancyrobot/fred-http@1.0.0-alpha.0

## Unreleased

### Patch Changes

- Move reusable HTTP server ownership out of `@fancyrobot/fred-dev` into the new `@fancyrobot/fred-http` package.
- Keep `@fancyrobot/fred-dev` focused on dev-only tooling and a thin local server command bridge.
- Update documentation to point reusable server consumers at `@fancyrobot/fred-http`.

## 0.2.1

### Patch Changes

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

- Updated dependencies [[`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103), [`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103)]:
  - @fancyrobot/fred@1.0.0

## 0.1.5

### Patch Changes

- [#39](https://github.com/TheFancyRobot/fred/pull/39) [`8033cce`](https://github.com/TheFancyRobot/fred/commit/8033cce497ea6c053554416e4f4073e1b0f13fe6) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship accumulated dev tooling improvements used during local development.

## 0.1.4

### Patch Changes

- [#37](https://github.com/TheFancyRobot/fred/pull/37) [`0c7f580`](https://github.com/TheFancyRobot/fred/commit/0c7f580fe7435fb484312175c12d39491cecce3d) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship accumulated dev tooling improvements used during local development.

## 0.1.3

### Patch Changes

- [#30](https://github.com/TheFancyRobot/fred/pull/30) [`6197d13`](https://github.com/TheFancyRobot/fred/commit/6197d130f10fa52ef2008effc0043c1b59158e86) Thanks [@sincspecv](https://github.com/sincspecv)! - Implemented portable TUI with session management for all fred projects

- Updated dependencies [[`6197d13`](https://github.com/TheFancyRobot/fred/commit/6197d130f10fa52ef2008effc0043c1b59158e86), [`d524cb7`](https://github.com/TheFancyRobot/fred/commit/d524cb723370088fc0eb3516ad621b41994f5aa4)]:
  - @fancyrobot/fred@0.2.1

## 0.1.2

### Patch Changes

- Updated dependencies [[`4b72cf1`](https://github.com/TheFancyRobot/fred/commit/4b72cf1793f3bbadc6356888abdcdf7011ba1d2b)]:
  - @fancyrobot/fred@0.2.0

## 0.1.1

### Patch Changes

- Updated dependencies [[`e7f17bb`](https://github.com/TheFancyRobot/fred/commit/e7f17bbcb4c7d408a4df9817565c5837576bb978)]:
  - @fred/core@0.2.0
