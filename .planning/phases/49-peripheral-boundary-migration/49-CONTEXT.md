# Phase 49: Peripheral Boundary Migration - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate all remaining non-boundary `Effect.runPromise`/`Effect.runFork` calls from peripheral modules (eval, hooks, MCP). Clean up doc-only false positives in observability and effect modules. Add CLI boundary guard. Finalize boundary guard test to zero known exceptions.

Completes CONS-04 (started in Phase 48 for pipeline domain).

</domain>

<decisions>
## Implementation Decisions

### Eval module migration
- `eval/service.ts` (1 runPromise) and `eval/replay.ts` (2 runPromise) — compose into Effect pipelines
- Eval is a separate subsystem; migration should not change eval's public API surface

### Hooks service migration
- `hooks/service.ts` (1 runPromise for trace export inside hook execution) — compose trace export into the hook execution Effect chain

### MCP health migration
- `mcp/health.ts` (1 runPromise for tool discovery during health checks) — compose into Effect pipeline

### Doc-only false positive cleanup
- `observability/otel.ts`, `observability/context.ts`, `effect/index.ts` — runPromise only appears in JSDoc comments
- Fix guard's comment detection to handle JSDoc blocks properly (current logic misses `* ` prefixed lines)
- Also rewrite doc examples to show idiomatic patterns (not runPromise)

### CLI boundary guard
- Add boundary guard for `packages/cli/` package
- Legitimate boundary files: `commands/*.ts` + `eval.ts` (application entry points)
- Everything else in CLI is a violation
- Guard test file organization (same file vs separate): Claude's discretion

### Guard finalization
- Remove ALL remaining known exceptions from boundary guard — zero exceptions target
- Guard covers both `runPromise` and `runFork` (extended in Phase 48)
- Phase 48 will have left Phase 49 peripheral files as temporary known exceptions — this phase removes them all

### Error handling approach
- Consistent with Phase 48 decisions: annotation failures log warnings, checkpoint failures log errors
- Eval/hooks/MCP failures: Claude's discretion on error wrapping, consistent with surrounding patterns

### Test approach
- Tests rewritten as Effect-native alongside each migration (not a separate test plan)
- Mock service approach: Claude's discretion, consistent with Phase 48 patterns

### Claude's Discretion
- Effect composition patterns for each module (tap, flatMap, fork — whatever fits)
- Error wrapping strategy per module
- CLI guard test file organization
- Test mock organization
- Sub-plan structure within Phase 49

</decisions>

<specifics>
## Specific Ideas

- All errors must be included in tracing; all tracing flows through OTEL (carried from Phase 48 discussion)
- Zero exceptions is a hard target — no "legitimate exceptions" philosophy
- This context was gathered during Phase 48 discussion — user confirmed no separate discuss-phase needed

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 48's renamed `boundary-guard.test.ts` — foundation for adding CLI guard and removing final exceptions
- Phase 48's Effect executor patterns — inform how eval/hooks/MCP should compose their runPromise calls
- `tests/unit/helpers/` — shared test mock infrastructure

### Established Patterns
- Service tag pattern with `Context.GenericTag` — consistent across all services
- Conditional no-op Layer for optional dependencies (established in Phase 48)
- Effect-native test pattern with Layer-provided mocks (established in Phase 48)

### Integration Points
- Guard test (renamed in Phase 48) — Phase 49 removes remaining exceptions and adds CLI section
- `FredLayers` in `services.ts` — if any new service layers are needed

### Violation Inventory (Phase 49 scope)
| File | runPromise | runFork | Total |
|------|-----------|---------|-------|
| eval/service.ts | 1 | 0 | 1 |
| eval/replay.ts | 2 | 0 | 2 |
| hooks/service.ts | 1 | 0 | 1 |
| mcp/health.ts | 1 | 0 | 1 |
| observability/otel.ts | 0 (doc only) | 0 | 0 |
| observability/context.ts | 0 (doc only) | 0 | 0 |
| effect/index.ts | 0 (doc only) | 0 | 0 |
| **Phase 49 total** | **5 real + 3 doc** | **0** | **5+3** |

</code_context>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 49-peripheral-boundary-migration*
*Context gathered: 2026-03-04*
