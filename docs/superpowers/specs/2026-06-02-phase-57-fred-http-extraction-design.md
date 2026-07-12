# Phase 57 fred-http Extraction Design

## Summary

Phase 57 should be redefined from the already-completed sibling-consumption clarification effort into a full extraction and migration effort that moves Fred's reusable Bun HTTP server layer out of `packages/dev` into a new workspace package, `packages/fred-http`, published as `@fancyrobot/fred-http`.

`@fancyrobot/fred-http` becomes the canonical runtime package for the Bun HTTP server surface. `@fancyrobot/fred-dev` remains a dev-only package focused on dev-chat and related development helpers.

## Goals

- Create `packages/fred-http` as the canonical home of Fred's reusable HTTP layer.
- Move the existing server runtime/API from `packages/dev` into `packages/fred-http`.
- Remove server API ownership from `@fancyrobot/fred-dev`.
- Update all internal and sibling consumers to import `@fancyrobot/fred-http`.
- Allow consumers to build broader HTTP APIs in front of Fred, including custom consumer-defined routes and handlers in the same secured server app.
- Validate all affected consumers, builds, docs, and tests after migration.
- Orchestrate the full Phase 57 execution through vault step orchestration.

## Non-Goals

- No temporary compatibility facade in `@fancyrobot/fred-dev` for server exports.
- No new HTTP framework or runtime abstraction beyond the current Bun boundary.
- No weakening of auth, rate limiting, CORS, body-size, timeout, or sanitized error behavior.
- No unrelated Convex or BAML work.

## Recommended Approach

### Option A — Hard extraction and immediate cutover (recommended)
Create `packages/fred-http`, move the HTTP server implementation there, switch all consumers immediately, and remove HTTP server exports from `@fancyrobot/fred-dev`.

**Why recommended:** aligns with the clarified goal, yields clean ownership, and avoids compatibility debt.

### Option B — Transitional re-export facade
Create `packages/fred-http` but keep `@fancyrobot/fred-dev` re-exporting server APIs temporarily.

**Rejected because:** it keeps ownership ambiguous and conflicts with the desired immediate migration.

### Option C — Internal refactor before package extraction
Refactor internals first, then publish the new package later.

**Rejected because:** it delays the real boundary and creates extra migration churn.

## Architecture

### New package boundary
Add `packages/fred-http` published as `@fancyrobot/fred-http`.

This package owns:
- a simple server launcher
- a standalone server class
- server security config/types
- route wiring
- auth/rate-limit/CORS/error-sanitization behavior
- Bun HTTP runtime integration required to host a Fred instance over HTTP
- a composable, Effect-friendly app builder surface for consumer-defined routes and handlers

### API shape
`@fancyrobot/fred-http` should expose two usage modes.

#### Simple mode
A batteries-included entrypoint for consumers who just want Fred's HTTP API:
- simple launcher usage
- standalone server usage

#### Composable mode
An Effect-oriented composition surface for consumers who need to build a wider HTTP API around Fred:
- register consumer-defined routes/handlers
- mount Fred routes into the same app
- share one centrally managed security pipeline
- avoid deep imports into internal route files

The composable API should follow Effect-TS best practices: small composable services/modules, explicit dependency wiring, and no APIs that encourage bypassing security or runtime boundaries.

### Remaining dev package boundary
`packages/dev` keeps:
- `dev-chat`
- dev-only convenience helpers
- any packaging/docs specific to local development workflows

`packages/dev` should stop owning or exporting the reusable HTTP server surface.

### Runtime constraint
`@fancyrobot/fred-http` remains explicitly Bun-oriented for this phase. Success means normal Bun package-name imports and workspace/`file:` dependency consumption, not generic Node portability.

### Security model
Security must default to safe composition.

The package should provide a top-level builder/factory that enforces the request pipeline in the correct order and makes the secure path the easiest path for both Fred routes and consumer-defined routes.

Required request path:
- CORS preflight
- request classification / public-route decision
- rate limit
- auth when required
- route handler
- conditional CORS response headers
- sanitized errors

Design constraints:
- custom consumer routes should plug into the app inside the controlled security pipeline
- public or unauthenticated routes must be explicit opt-ins
- built-in Fred routes and consumer routes should share the same default hardening behavior
- the API should avoid encouraging middleware bypasses, ad hoc auth handling, or unsanitized error paths

## Migration Plan Shape

Phase 57 should be rewritten in the vault as an execution phase with linear, orchestratable steps:

1. Redefine Phase 57 vault notes around `fred-http` extraction and migration.
2. Scaffold `packages/fred-http` with manifest, exports, build config, and dependency contract.
3. Move server implementation from `packages/dev` to `packages/fred-http` while preserving behavior.
4. Update all monorepo and sibling consumers to import `@fancyrobot/fred-http`.
5. Trim `packages/dev` to a dev-only role.
6. Run full validation across tests, builds, and sibling-style smoke checks.
7. Update docs/examples and close the phase.

## Code Movement Expectations

Likely source movement:
- `packages/dev/src/server.ts` -> `packages/fred-http/src/server.ts` or equivalent
- `packages/dev/src/server/*` -> `packages/fred-http/src/server/*`
- server exports currently exposed from `packages/dev/src/index.ts` -> `packages/fred-http/src/index.ts`

The migration should prefer moving existing code with minimal semantic changes before any cleanup/refinement.

## Consumer Migration Rules

- All repo consumers should switch to `@fancyrobot/fred-http`.
- No deep imports into package internals.
- No compatibility alias from `@fancyrobot/fred-dev`.
- Sibling consumers should be tested after the migration using local package-name installs.

## Validation Requirements

Validation must cover:
- target unit tests for the HTTP layer and affected consumers
- build of `@fancyrobot/fred-http`
- build of `@fancyrobot/fred-dev`
- build/test of all updated sibling consumers
- sibling-style `file:` dependency import smoke tests
- package-surface checks for exported server APIs
- custom-route composition behavior in the same app as Fred routes
- auth/public route separation for consumer-defined handlers
- sanitized failures from both Fred-owned and consumer-owned handlers

At minimum, behavior preservation must confirm:
- CORS preflight
- rate limiting
- auth handling
- route execution
- conditional CORS response headers
- sanitized errors
- health/smoke route behavior
- custom consumer route handling under the shared security model

## Effect and boundary rules

- Preserve approved Effect runtime boundaries.
- Do not add new `Effect.runPromise`/`Runtime.runPromise` uses outside approved boundary files.
- Keep HTTP package logic within established Effect/Bun patterns already present in the repo.
- Use existing test and architecture patterns rather than introducing new abstractions without need.

## Vault / orchestration rules

- Existing Phase 57 notes are based on the wrong interpretation and must be corrected before execution.
- Phase 57 should be orchestrated step-by-step with fresh subagents after the vault rewrite.
- Spawned team members should use `hf:zai-org/GLM-5.1` if orchestration proceeds.
- Orchestration should stop on unrecovered step failure rather than allowing phase drift.

## Risks

- Hidden consumers may still import server APIs from `@fancyrobot/fred-dev`.
- Tests may be tightly coupled to old paths under `packages/dev`.
- Build/package metadata may need adjustment for Bun-targeted sibling consumption.
- Vault state currently claims completion and must be rewritten carefully to avoid stale execution history.

## Success Criteria

Phase 57 is complete when:
- `packages/fred-http` exists and owns the reusable HTTP server API.
- `packages/fred-http` supports both simple server startup and composable consumer-defined routes/handlers.
- `packages/dev` no longer exports the server surface.
- all known consumers import `@fancyrobot/fred-http`.
- tests/builds/sibling smoke checks pass after migration.
- custom routes can be hosted alongside Fred routes under the shared security model.
- docs/examples are updated.
- vault phase and step notes reflect the new execution reality.
