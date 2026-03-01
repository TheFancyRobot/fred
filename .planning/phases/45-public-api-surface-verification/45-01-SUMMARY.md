---
phase: 45-public-api-surface-verification
plan: 01
subsystem: api
tags: [effect, workflow, exports, layers, fred]

# Dependency graph
requires:
  - phase: 44-imperative-layer-removal-consumer-migration
    provides: Fred runtime facade and consumer migration baseline without imperative managers
provides:
  - WorkflowService Effect implementation with Ref-backed state and AgentService validation
  - Public API cleanup removing imperative intent/workflow/checkpoint class exports
  - Main entrypoint re-exports for missing service tags and runtime composition helpers
affects: [45-02, 45-03, release-notes]

# Tech tracking
tech-stack:
  added: []
  patterns: [Effect Context.Tag services over imperative manager exports, runtime snapshot replay for workflow config]

key-files:
  created: [packages/core/src/workflow/service.ts, tests/unit/core/workflow/service.test.ts]
  modified: [packages/core/src/workflow/index.ts, packages/core/src/services.ts, packages/core/src/exports.ts, packages/core/src/index.ts, packages/core/src/effect/services.ts, packages/dev/src/dev-chat.ts, packages/cli/src/commands/list.ts, packages/cli/tests/commands/list.test.ts]

key-decisions:
  - "Keep Workflow type exported from manager.ts while replacing WorkflowManager class exports with WorkflowService tags"
  - "Expose workflow operations directly on Fred and keep getWorkflowManager as a compatibility adapter backed by WorkflowService"
  - "Include missing service and runtime helper re-exports from the main index.ts services export block"

patterns-established:
  - "Workflow registration replays from Fred snapshot state into runtime services during runtime bootstrap"
  - "Consumer workflow queries use Fred public methods instead of manager class instances"

# Metrics
duration: 5 min
completed: 2026-03-01
---

# Phase 45 Plan 01: Public API Workflow Service Summary

**Workflow management now ships as an Effect WorkflowService, and the public API surface removes imperative intent/workflow/checkpoint class exports while re-exporting missing service/runtime helpers.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-01T20:43:03Z
- **Completed:** 2026-03-01T20:48:35Z
- **Tasks:** 2 (Task 1 executed via TDD RED/GREEN)
- **Files modified:** 10

## Accomplishments
- Added `WorkflowService` + `WorkflowServiceLive` with Ref-backed workflow storage and non-blocking agent validation warnings.
- Wired WorkflowService into `FredLayers`, workflow barrels, and Effect services exports so runtime composition includes workflow functionality.
- Removed imperative class exports from `exports.ts` (IntentMatcher, IntentRouter, WorkflowManager, CheckpointManager, CheckpointCleanupTask).
- Added missing services/runtime creation helpers to `packages/core/src/index.ts` re-export block.
- Migrated dev chat and CLI list workflow usage to Fred workflow public methods.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Create failing WorkflowService tests** - `4084649` (test)
2. **Task 1 (GREEN): Implement WorkflowService and wire layers** - `5364669` (feat)
3. **Task 2: Clean exports, re-exports, and consumers** - `15f247f` (feat)

## Files Created/Modified
- `packages/core/src/workflow/service.ts` - New Effect WorkflowService implementation and layer.
- `tests/unit/core/workflow/service.test.ts` - WorkflowService unit tests (add/get/list/has/warn).
- `packages/core/src/workflow/index.ts` - Re-export WorkflowService tags; drop WorkflowManager barrel export.
- `packages/core/src/services.ts` - Include WorkflowService in FredServices and FredLayers.
- `packages/core/src/exports.ts` - Remove imperative class exports and add WorkflowService exports.
- `packages/core/src/index.ts` - Add workflow public methods and expand services/runtime helper re-exports.
- `packages/core/src/effect/services.ts` - Re-export WorkflowService from effect barrel.
- `packages/dev/src/dev-chat.ts` - Replace getWorkflowManager usage with Fred workflow methods.
- `packages/cli/src/commands/list.ts` - List workflows via `fred.listWorkflows()`.
- `packages/cli/tests/commands/list.test.ts` - Update workflow mocks for new Fred API.

## Decisions Made
- Exported workflow functionality as service tags (`WorkflowService`, `WorkflowServiceLive`) while preserving `Workflow` type export for config contracts.
- Kept `Fred.getWorkflowManager()` as a compatibility adapter backed by new workflow methods to avoid abrupt runtime breakage while consumers migrate.
- Re-exported runtime helper constructors (`createFredRuntime`, `createScopedFredRuntime`, `createFredRuntimeWithOptions`, `makeFredRuntimeLayer`, `makeFredLayersWithLeafRouting`, `FredLayersWithIntentRouting`) alongside service tags from main entrypoint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated CLI workflow list tests for new Fred workflow API**
- **Found during:** Task 2 full-suite verification (`bun test`)
- **Issue:** `packages/cli/tests/commands/list.test.ts` still mocked `getWorkflowManager()`, causing workflow list tests to fail after migrating command code to `fred.listWorkflows()`.
- **Fix:** Switched test doubles to mock `listWorkflows()` directly and updated stale test wording.
- **Files modified:** `packages/cli/tests/commands/list.test.ts`
- **Verification:** `bun test packages/cli/tests/commands/list.test.ts` and full `bun test` pass.
- **Committed in:** `15f247f`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Required to keep test suite green after planned API migration; no scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Authentication Gates
None.

## Next Phase Readiness
- Phase 45 Plan 01 requirements are met and verified with full `bun test` pass.
- Ready for `45-02-PLAN.md` (sub-path exports and consumer import migration).

---
*Phase: 45-public-api-surface-verification*
*Completed: 2026-03-01*
