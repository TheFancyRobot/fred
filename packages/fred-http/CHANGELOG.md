# @fancyrobot/fred-http

## 1.0.0

### Major Changes

- [#54](https://github.com/TheFancyRobot/fred/pull/54) [`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217) Thanks [@sincspecv](https://github.com/sincspecv)! - Effect-first core rewrite: `createFred()`/`FredClient` and the Effect service entrypoint replace the legacy `Fred` facade.

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

### Minor Changes

- [#66](https://github.com/TheFancyRobot/fred/pull/66) [`c3d92d2`](https://github.com/TheFancyRobot/fred/commit/c3d92d2831a936a9ab6bf0ef43afb920bf88b1ce) Thanks [@sincspecv](https://github.com/sincspecv)! - Add transport-neutral typed workflow discovery and execution, opt-in generated
  JSON/SSE workflow endpoints, scoped hash-only API keys with durable stores,
  persistent rate limiting, hardened HTTP configuration, and the keys CLI.

### Patch Changes

- [#88](https://github.com/TheFancyRobot/fred/pull/88) [`d66c541`](https://github.com/TheFancyRobot/fred/commit/d66c541f3e7d235f7c305679d4cc84a070317ab6) Thanks [@sincspecv](https://github.com/sincspecv)! - Require `effect@^3.21.5` in packages that directly peer on the
  `@effect/platform` 0.96 line. The reviewed workspace lock resolves
  `@effect/platform@0.96.3`, whose Effect peer range starts at 3.21.5. This is a
  compatibility boundary; no upstream vulnerability is being claimed for Effect
  3.21.0 through 3.21.4.

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## 1.0.0-alpha.2

### Patch Changes

- [#88](https://github.com/TheFancyRobot/fred/pull/88) [`d66c541`](https://github.com/TheFancyRobot/fred/commit/d66c541f3e7d235f7c305679d4cc84a070317ab6) Thanks [@sincspecv](https://github.com/sincspecv)! - Require `effect@^3.21.5` in packages that directly peer on the
  `@effect/platform` 0.96 line. The reviewed workspace lock resolves
  `@effect/platform@0.96.3`, whose Effect peer range starts at 3.21.5. This is a
  compatibility boundary; no upstream vulnerability is being claimed for Effect
  3.21.0 through 3.21.4.

## 1.0.0-alpha.1

### Minor Changes

- [#66](https://github.com/TheFancyRobot/fred/pull/66) [`c3d92d2`](https://github.com/TheFancyRobot/fred/commit/c3d92d2831a936a9ab6bf0ef43afb920bf88b1ce) Thanks [@sincspecv](https://github.com/sincspecv)! - Add transport-neutral typed workflow discovery and execution, opt-in generated
  JSON/SSE workflow endpoints, scoped hash-only API keys with durable stores,
  persistent rate limiting, hardened HTTP configuration, and the keys CLI.

### Patch Changes

- [#80](https://github.com/TheFancyRobot/fred/pull/80) [`852ed41`](https://github.com/TheFancyRobot/fred/commit/852ed4171ff6298b0a880062949beab63e5ef675) Thanks [@sincspecv](https://github.com/sincspecv)! - Ship the Phase 68 independent-version migration matrix, supported API recipes,
  security rotation guidance, package README links, and release/rollback runbook.

## 1.0.0-alpha.0

### Patch Changes

- Updated dependencies [[`42a5d01`](https://github.com/TheFancyRobot/fred/commit/42a5d0160f57fdd2d1a7761e489331f5f9587217)]:
  - @fancyrobot/fred@2.0.0-alpha.0

## Unreleased

### Minor Changes

- Rebuild the built-in server on Effect Platform `HttpApi` and Bun server Layers.
- Add the opt-in, non-mutating `withHttp(await createFred())` client enhancement.
- Add OpenAPI/Swagger, live status, ambient session headers, and OpenAI-compatible SSE.
- Remove the duplicate legacy router/handler implementation and dev-server source tree.
- Remove the deprecated standalone server and fetch adapters; `withHttp()` and Effect server Layers are the supported entrypoints.
- Extract Fred's reusable Bun HTTP server into a dedicated `@fancyrobot/fred-http` package.
- Add `withHttp({ routes })` for consumer-defined routes alongside Fred routes.
- Share one security-first pipeline across built-in and custom handlers, including CORS preflight, rate limiting, auth enforcement, and sanitized error responses.
- Add sibling `file:` dependency smoke coverage to validate package-name consumption from external Bun projects.
