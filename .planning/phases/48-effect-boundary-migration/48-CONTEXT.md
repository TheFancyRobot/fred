# Phase 48: Effect Boundary Migration - Context

**Gathered:** 2026-03-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Eliminate all non-boundary `Effect.runPromise`/`Effect.runFork` calls from **pipeline-related core business logic** (executors, pipeline service, checkpoint/pause storage). Convert executors to full Effect programs with service tags. Rename and extend the boundary guard test to cover runFork. Phase 48 covers the pipeline domain; peripheral modules (eval, hooks, MCP) and CLI guard finalization are deferred to Phase 49.

Satisfies CONS-04 partially (pipeline path). Phase 49 completes CONS-04 for peripheral modules.

</domain>

<decisions>
## Implementation Decisions

### Executor conversion
- Full Effect conversion for both `executor.ts` and `graph-executor.ts` (not incremental async-with-Effect-inside)
- Both executors converted in Phase 48 (not sequential-only)
- Create `ExecutorService` and `GraphExecutorService` service tags
- Dependencies come from R channel (Effect-native), not function parameters
- Optional dependencies (e.g., observability) use conditional no-op Layer when not configured — executor always calls the service
- Executor service API design and resume ownership: Claude's discretion

### Observability annotations
- ~15 fire-and-forget `runFork` calls for span/step/branch annotations: Claude decides composition approach (tap, fork, etc.)
- Annotation failures: log warning but don't fail pipeline (best-effort)
- All errors must be included in tracing; all tracing flows through OTEL
- Fix `as any` type casts on observability effects during conversion

### Checkpoint/pause storage
- 4 files with `runFork` for checkpoint writes
- Converted to non-blocking `Effect.fork`/`forkDaemon` within pipeline Effect (no `runFork` escape)
- Repurpose existing runFork helper functions as Effect combinators (return Effect instead of calling runFork)
- Checkpoint write failures: log at error level and flag pipeline context as degraded (more serious than annotation failure)
- Checkpoint/pause is a separate sub-plan from executors

### Agent processMessage bridging
- `Effect.runPromise(agent.processMessage(...))` calls in executors go away naturally with full Effect conversion — agent Effects compose via flatMap/pipe
- Error wrapping strategy (typed propagation vs pipeline error wrapper): Claude's discretion

### Pipeline service
- `pipeline/service.ts` runPromise call (line 280) included in executor sub-plan since it orchestrates executors
- Service becomes the Layer provider for executor service dependencies

### Guard test updates (Phase 48 scope)
- Rename from `phase-44-boundary-guard` to `boundary-guard`
- Extend to detect `Effect.runFork`/`Runtime.runFork` violations (not just runPromise)
- Guard updated first (test-driven migration) — starts failing, each sub-plan clears violations
- Phase 49 peripheral files listed as temporary known exceptions in Phase 48's guard
- Fix JSDoc comment detection (current guard misses `* ` prefixed doc blocks)

### Sub-plan structure and ordering
- Guard test update first (starts failing on current violations)
- Then: Checkpoint/pause storage (smallest, 4 files)
- Then: Peripheral modules skipped — Phase 49
- Then: Executors + pipeline/service.ts (largest)
- Tests rewritten as Effect-native alongside each sub-plan (not a separate test plan)

### Test approach
- Existing executor/pipeline tests rewritten as Effect-native (runPromise at test boundary with Layer-provided mocks)
- Tests included in each sub-plan (always-green CI at each step)
- Mock service approach (shared fixtures vs inline Layer.succeed): Claude's discretion

### Claude's Discretion
- Observability annotation composition pattern (tap vs fork vs other)
- Agent error wrapping strategy
- ExecutorService API surface design (single execute method vs current signatures)
- Resume logic ownership (PipelineService vs ExecutorService)
- No-op service layer placement (new files vs inline in service modules)
- Test mock organization (shared fixtures vs inline)
- Guard test file organization for CLI guard (same file vs separate)

</decisions>

<specifics>
## Specific Ideas

- User wants guard test to start failing immediately (not pre-populate with exceptions that shrink) — red CI is acceptable during migration
- User explicitly wants zero exceptions as the final target — no "legitimate exceptions" philosophy
- 3 of 10 current known exceptions are false positives (observability/otel.ts, observability/context.ts, effect/index.ts have runPromise only in JSDoc comments) — fix guard comment detection AND clean up doc examples
- Phase 49 should be added to roadmap BEFORE Phase 48 execution starts
- This CONTEXT.md covers decisions for both Phase 48 and Phase 49 — no separate discuss-phase needed for Phase 49

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `phase-44-boundary-guard.test.ts`: Existing guard test with file collection, comment skipping, and violation detection — foundation for rename and extension
- `tests/unit/helpers/`: Shared test mock infrastructure (AgentManagerLike, ToolRegistryLike patterns) — extend for executor service mocks
- `FredLayers` in `services.ts`: Canonical all-services Layer composition — executor services will integrate here

### Established Patterns
- Service tags with `Context.GenericTag` pattern used by all 14 existing services — ExecutorService and GraphExecutorService follow same pattern
- `Layer.succeed` / `Layer.effect` for service implementation — checkpoint no-op layers follow same pattern
- Conditional service composition via `Layer.merge` with config-driven overrides (established in Phase 45)

### Integration Points
- `PipelineService` (pipeline/service.ts) is the primary consumer of both executors — will depend on ExecutorService/GraphExecutorService via R channel
- `FredLayers` composition in `services.ts` — new executor services and no-op layers must be included
- Guard test currently lives at `tests/unit/core/migration/phase-44-boundary-guard.test.ts` — will be renamed/moved

### Violation Inventory (Phase 48 scope)
| File | runPromise | runFork | Total |
|------|-----------|---------|-------|
| pipeline/executor.ts | 1 | 5 | 6 |
| pipeline/graph-executor.ts | 2 | 7 | 9 |
| pipeline/service.ts | 1 | 0 | 1 |
| pipeline/checkpoint/manager.ts | 0 | 1 | 1 |
| pipeline/checkpoint/postgres.ts | 0 | 1 | 1 |
| pipeline/checkpoint/sqlite.ts | 0 | 1 | 1 |
| pipeline/pause/manager.ts | 0 | 1 | 1 |
| **Phase 48 total** | **4** | **16** | **20** |

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

- **Phase 49: Peripheral Boundary Migration** — eval, hooks, MCP module migration + doc cleanup + CLI guard + guard finalization to zero exceptions. Goal already written: "Eliminate remaining non-boundary runPromise/runFork calls from peripheral modules (eval, hooks, MCP), clean up doc-only false positives, add CLI boundary guard, and finalize guard test to zero exceptions."
- CLI boundary files definition for Phase 49 guard: commands/*.ts + eval.ts are legitimate boundaries; everything else in CLI is a violation

</deferred>

---

*Phase: 48-effect-boundary-migration*
*Context gathered: 2026-03-04*
