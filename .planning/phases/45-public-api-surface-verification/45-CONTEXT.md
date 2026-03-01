# Phase 45: Public API Surface & Verification - Context

**Gathered:** 2026-03-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Finalize the public API to export only Effect services, ensure Layer composition is complete, document all breaking changes for the v0.3.0 migration, and verify the full test suite passes cleanly. This is the final phase of the imperative-to-Effect migration milestone.

</domain>

<decisions>
## Implementation Decisions

### Export contract design
- Both `@fred/core` and `@fred/core/services` import paths should work for Effect service tags
- Remove the 5 imperative class exports from `exports.ts`: `ToolRegistry`, `AgentManager`, `ContextManager`, `HookManager`, `MessageRouter`
- Light cleanup of `exports.ts`: organize remaining exports into clearer groups (types, services, utilities) without adding/removing non-migration exports
- Claude's discretion on whether `exports.ts` or `services.ts` is the primary entry point internally
- Claude's discretion on whether to keep or remove the `@fred/core/effect` path (check if anything imports from it)

### Migration documentation
- Full v0.3.0 CHANGELOG covering all breaking changes from the entire migration (Phases 41-45), not just Phase 45
- Summary format with 2-3 before/after code snippets for the most common consumer patterns (creating agents, running pipelines, registering tools)
- Claude's discretion on CHANGELOG file location (repo root vs package-level) and version header format (`v0.3.0` vs `[Unreleased]`)

### Pre-existing LSP error resolution
- Goal: fix all pre-existing LSP errors (Effect yield errors in index.ts, tracing import errors, config/initializer references)
- Claude judges per case: fix if safe, document if risky/requires major refactoring beyond phase scope
- If any remain unfixed: both inline TODO/FIXME comments at the code locations AND a Known Issues section in the CHANGELOG
- Verification: `tsc --noEmit` required as an explicit verification step (not just `bun build`)

### Test update strategy
- Migrate tests to use Effect services rather than imperative classes — tests become reference examples of the new API
- Delete imperative class tests that have equivalent coverage in service tests (remove dead weight)
- All tests that exist after cleanup must pass — zero failures
- Add a new API smoke test that imports from public entry points and verifies `FredLayers` constructs and runs a basic Effect

### Claude's Discretion
- Entry point structure (which file is primary, how re-exports are organized)
- `@fred/core/effect` path: keep or consolidate
- CHANGELOG location and version header format
- Per-error judgment on fix vs document for risky LSP errors

</decisions>

<specifics>
## Specific Ideas

- Consumer should be able to import Effect service tags directly from `@fred/core` (not forced into a sub-path)
- CHANGELOG should tell the full v0.3.0 story, not just Phase 45's changes — consumers upgrading need the complete picture
- Clean slate: aim to fix all LSP errors, only document as last resort
- API smoke test should be a real integration test (import, construct layers, run an Effect) not just a type-level check

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/services.ts`: Already has complete `FredLayers` composition with all services, `FredRuntime` type, `createFredRuntime()`, and all service re-exports
- `packages/core/src/effect/services.ts`: Secondary re-export of all services from `@fred/core/effect` path
- `packages/core/src/exports.ts`: Current public API surface — still exports 5 imperative classes alongside types, eval, observability, stream exports

### Established Patterns
- Layer composition in `services.ts` uses wave-based dependency graph (Wave 1: base → Wave 5: MessageProcessor)
- Service tags follow `XxxService` / `XxxServiceLive` naming convention
- Package exports use `package.json` `exports` field for sub-path routing

### Integration Points
- `exports.ts` is the main barrel file for `@fred/core`
- `services.ts` is the Layer composition and runtime entry point
- `effect/services.ts` provides an alternative import path
- Consumers: `packages/dev/src/dev-chat.ts`, `packages/cli/src/commands/chat.ts`, `packages/cli/src/commands/run.ts`

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 45-public-api-surface-verification*
*Context gathered: 2026-03-01*
