# Phase 45: Public API Surface & Verification - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Clean up public exports to remove imperative classes, expose only Effect services + types + utilities, compose the final Layer, document all v0.3.0 breaking changes, and verify the full test suite and build pass cleanly. This is the verification gate for the v0.3.0 Effect migration milestone.

</domain>

<decisions>
## Implementation Decisions

### Export surface design
- Main export (`@fancyrobot/fred`) includes Effect service tags, commonly-used types, and utility functions — removes only imperative classes
- Fred class AND Effect runtime creation (`createFredRuntime`, `FredLayers`) both exported — transition period where consumers can use either
- Eval/test framework exports (GoldenTraceRecorder, TestCase, assertions, etc.) move to `@fancyrobot/fred/eval` sub-path; update CLI test.ts imports accordingly
- Storage implementations (SqliteContextStorage, PostgresContextStorage, CheckpointStorage) move to sub-paths (e.g., `@fancyrobot/fred/context/sqlite`); update consumer imports
- Observability export organization: research implementation patterns in other Effect-based libraries and use that research as guidance for where observability exports live
- Package.json `"exports"` field must be added/updated to explicitly control which paths consumers can import — prevent accidental deep imports into internals
- Built-in tools (createCalculatorTool) move to sub-path within `@fancyrobot/fred/tools` as intermediate step

### Breaking change documentation
- CHANGELOG uses changesets format with before/after code examples showing migration paths
- Version: 0.3.0
- Covers the entire v0.3.0 milestone (phases 41-45) as one cohesive breaking change release
- Audience: external consumers — docs must be clear for someone unfamiliar with the migration context
- Changesets for all affected packages: @fred/core (breaking), @fred/cli, @fred/dev (patch/minor for import path updates)
- No "why this change" motivation section — just the facts: what changed, what replaces it, code examples

### Backward compatibility policy
- Clean break: remove imperative exports entirely, no deprecation shims
- Phase 44 must be verified complete before Phase 45 starts — no straggler consumer imports of imperative classes
- Block removal of any imperative class that has NO Effect service equivalent — every removal must have a migration path
- WorkflowManager MUST have an Effect service equivalent; if not already implemented, create it in this phase
- Audit type-only exports: keep only types that consumers actually use or that map to Effect service APIs; remove orphaned types tied to imperative classes

### Pre-existing error resolution
- Fix ALL pre-existing LSP errors: Effect yield errors in index.ts, tracing import errors, config/initializer reference — no known issues left
- Fix and verify: Phase 45 actively fixes any broken tests caused by the migration, not just verifies they pass
- Verify build output: `bun run build` succeeds AND verify dist output has correct exports with a smoke test importing from the built package
- Verify boundary guard test: confirm `phase-44-boundary-guard.test.ts` passes with no new Effect.runPromise violations
- Phase 45 handles interface tweaks needed to fix LSP errors — even if they touch service interfaces
- Remove ALL @ts-ignore and @ts-expect-error workaround annotations added during the migration; fix underlying type issues

### Claude's Discretion
- Provider pack export location (main vs sub-path) — determine based on consumer usage patterns
- Build scope (all packages vs core + consumers) — determine based on dependency graph
- Exact sub-path naming conventions for moved exports

</decisions>

<specifics>
## Specific Ideas

- Built-in tools should eventually live in a dedicated `@fancyrobot/fred-tools` package (deferred — see below)
- External consumers need clear before/after code examples in the CHANGELOG

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `services.ts`: Already has complete FredLayers composition with wave-based dependency ordering, FredRuntime type, createFredRuntime, createScopedFredRuntime, and re-exports of all Effect services
- `exports.ts`: Current public API surface — 109 lines mixing imperative and Effect exports; this is the primary file to refactor
- Boundary guard test (`tests/unit/core/migration/phase-44-boundary-guard.test.ts`): Automated enforcement of Effect.runPromise placement

### Established Patterns
- Effect service pattern: each domain has `service.ts` with Context.Tag + Live layer (e.g., `ToolRegistryService` + `ToolRegistryServiceLive`)
- Sub-path imports already exist: `@fancyrobot/fred/mcp/registry` is used by CLI
- Changesets already configured in the monorepo for versioning

### Integration Points
- Consumer packages (`@fred/cli`, `@fred/dev`) import from `@fancyrobot/fred` — all imports must be updated when exports change
- `dev/server/chat/handlers.ts` imports `ContextManager` directly — must be migrated before exports cleanup
- `cli/src/eval.ts` imports eval types — must update to new sub-path
- `cli/src/test.ts` imports test framework types — must update to new sub-path
- Package.json needs `"exports"` field to formalize the new import surface

</code_context>

<deferred>
## Deferred Ideas

- `@fancyrobot/fred-tools` package: Dedicated package for built-in tools (calculator, etc.) as Effect-based tools — future phase
- Motivation/architecture documentation: A blog post or README section explaining the why behind the Effect migration — not CHANGELOG content

</deferred>

---

*Phase: 45-public-api-surface-verification*
*Context gathered: 2026-03-01*
