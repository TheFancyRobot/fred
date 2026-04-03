# @fred/cli

## 0.5.0

### Minor Changes

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

- Updated dependencies [[`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103), [`61f61fd`](https://github.com/TheFancyRobot/fred/commit/61f61fdc4b5f365a2f03d078a8521d192905b103)]:
  - @fancyrobot/fred@1.0.0
  - @fancyrobot/fred-dev@0.2.1
  - @fancyrobot/fred-anthropic@3.0.0
  - @fancyrobot/fred-google@3.0.0
  - @fancyrobot/fred-groq@3.0.0
  - @fancyrobot/fred-openai@3.0.0
  - @fancyrobot/fred-openrouter@4.0.0

## 0.3.0

### Minor Changes

- [#35](https://github.com/TheFancyRobot/fred/pull/35) [`b199aec`](https://github.com/TheFancyRobot/fred/commit/b199aec547598b0e1b67c72b34e0afe6bbee70ec) Thanks [@sincspecv](https://github.com/sincspecv)! - Release CLI/TUI visual polish and reliability improvements as v0.3.0 through
  the standard Changesets flow.

  This release also adds plugin compatibility guidance and test coverage for the
  `0.3.x` transition.

## 0.2.2

### Patch Changes

- [#30](https://github.com/TheFancyRobot/fred/pull/30) [`6197d13`](https://github.com/TheFancyRobot/fred/commit/6197d130f10fa52ef2008effc0043c1b59158e86) Thanks [@sincspecv](https://github.com/sincspecv)! - Implemented portable TUI with session management for all fred projects

- Updated dependencies [[`6197d13`](https://github.com/TheFancyRobot/fred/commit/6197d130f10fa52ef2008effc0043c1b59158e86), [`d524cb7`](https://github.com/TheFancyRobot/fred/commit/d524cb723370088fc0eb3516ad621b41994f5aa4)]:
  - @fancyrobot/fred-groq@2.0.1
  - @fancyrobot/fred@0.2.1
  - @fancyrobot/fred-dev@0.1.3

## 0.2.1

### Patch Changes

- Updated dependencies [[`4b72cf1`](https://github.com/TheFancyRobot/fred/commit/4b72cf1793f3bbadc6356888abdcdf7011ba1d2b)]:
  - @fancyrobot/fred@0.2.0
  - @fancyrobot/fred-dev@0.1.2

## 0.2.0

### Minor Changes

- [`e7f17bb`](https://github.com/TheFancyRobot/fred/commit/e7f17bbcb4c7d408a4df9817565c5837576bb978) Thanks [@sincspecv](https://github.com/sincspecv)! - Release v0.2.5 - Monorepo conversion complete with Effect-based services, built-in calculator tool, streaming support, and automatic package publishing

### Patch Changes

- Updated dependencies [[`e7f17bb`](https://github.com/TheFancyRobot/fred/commit/e7f17bbcb4c7d408a4df9817565c5837576bb978)]:
  - @fred/core@0.2.0
  - @fred/dev@0.1.1
