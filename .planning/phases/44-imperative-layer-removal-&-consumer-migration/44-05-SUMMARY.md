---
phase: 44-imperative-layer-removal-&-consumer-migration
plan: 05
subsystem: core
tags: [deletion, manager-removal, exports-cleanup, rmvl, effect-migration]

# Dependency graph
requires:
  - phase: 44-03
    provides: MessageProcessor/AgentFactory decoupling required before manager file deletion
  - phase: 44-04
    provides: Pipeline and router structural decoupling required before manager file deletion
provides:
  - Eight imperative wrapper/manager files were deleted in simple-to-complex order
  - Core export surface no longer re-exports deleted manager/router classes
  - Safety rollback tag `pre-phase-44-deletion` anchors pre-deletion repository state
affects: [44-06 boundary verification, 45 public api cleanup, test migration follow-up]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Deletion-first cleanup with pre-deletion safety tag and dependency-ordered removal
    - Export surface is reduced immediately after source file deletion to prevent dangling API symbols

key-files:
  created:
    - .planning/phases/44-imperative-layer-removal-&-consumer-migration/44-05-VERIFICATION.md
    - .planning/phases/44-imperative-layer-removal-&-consumer-migration/44-05-SUMMARY.md
  modified:
    - packages/core/src/context/manager.ts
    - packages/core/src/hooks/manager.ts
    - packages/core/src/platform/registry.ts
    - packages/core/src/provider/service.ts
    - packages/core/src/tool/registry.ts
    - packages/core/src/agent/manager.ts
    - packages/core/src/pipeline/manager.ts
    - packages/core/src/routing/router.ts
    - packages/core/src/exports.ts

key-decisions:
  - "Create `pre-phase-44-deletion` tag before first `git rm` as rollback checkpoint"
  - "Keep deletion order strict: simple wrappers first, complex managers second"
  - "Use exact constructor grep (`new XyzManager(`) for RMVL-08 verification to avoid service-name false positives"

patterns-established:
  - "Large dead-code removals should pair safety tag + ordered deletion + immediate build verification"
  - "Verification-only task outcomes can be captured as explicit artifacts when task-atomic commit boundaries are required"

requirements-completed: [RMVL-01, RMVL-02, RMVL-03, RMVL-04, RMVL-05, RMVL-06]

# Metrics
duration: 3 min
completed: 2026-03-01
---

# Phase 44 Plan 05: Imperative Manager Deletion Summary

**Deleted the 6 target imperative managers plus 2 additional imperative wrappers, removed their exports, and anchored the cutover with a pre-deletion safety tag for rollback.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-01T17:20:32Z
- **Completed:** 2026-03-01T17:23:43Z
- **Tasks:** 3
- **Files modified:** 10

## Accomplishments
- Created safety tag `pre-phase-44-deletion` before any deletion work.
- Deleted simple-tier files first: `context/manager.ts`, `hooks/manager.ts`, `platform/registry.ts`, `provider/service.ts`.
- Deleted complex-tier files second: `tool/registry.ts`, `agent/manager.ts`, `pipeline/manager.ts`, `routing/router.ts`.
- Removed deleted-class re-exports from `packages/core/src/exports.ts` (`ToolRegistry`, `AgentManager`, `ContextManager`, `HookManager`, `MessageRouter`).
- Verified full workspace build passes after deletions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create safety tag and delete simple manager files** - `8630873` (fix)
2. **Task 2: Delete complex managers and clean exports.ts** - `5b284a2` (fix)
3. **Task 3: Verify RMVL-08 and document test cleanup targets** - `f9f5545` (docs)

**Plan metadata:** pending

## Files Created/Modified
- `packages/core/src/context/manager.ts` - deleted imperative ContextManager implementation.
- `packages/core/src/hooks/manager.ts` - deleted imperative HookManager implementation.
- `packages/core/src/platform/registry.ts` - deleted imperative ProviderRegistry implementation.
- `packages/core/src/provider/service.ts` - deleted additional imperative provider wrapper.
- `packages/core/src/tool/registry.ts` - deleted imperative ToolRegistry implementation.
- `packages/core/src/agent/manager.ts` - deleted imperative AgentManager implementation.
- `packages/core/src/pipeline/manager.ts` - deleted imperative PipelineManager implementation (~1k LOC).
- `packages/core/src/routing/router.ts` - deleted additional imperative MessageRouter wrapper.
- `packages/core/src/exports.ts` - removed exports that referenced deleted files.
- `.planning/phases/44-imperative-layer-removal-&-consumer-migration/44-05-VERIFICATION.md` - captured deletion checks and test cleanup inventory.

## Decisions Made
- Enforced simple-to-complex deletion order exactly as user-directed to reduce blast radius while deleting interdependent legacy files.
- Kept `IntentMatcher`, `IntentRouter`, and `WorkflowManager` exports untouched because they are outside this deletion scope.
- Used exact RMVL-08 grep matching (`new XyzManager(`) for correctness, since substring grep also matched `*ServiceImpl` constructors.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Corrected RMVL-08 verification matching to avoid false positives**
- **Found during:** Task 3 (RMVL-08 verification)
- **Issue:** The provided substring grep pattern matched `ToolRegistryServiceImpl` / `HookManagerServiceImpl` constructor names, causing false failures despite zero `new XxxManager()` usages.
- **Fix:** Switched verification to exact constructor matching with `rg -n "new (ToolRegistry|AgentManager|PipelineManager|ContextManager|HookManager|ProviderRegistry)\("`.
- **Files modified:** `.planning/phases/44-imperative-layer-removal-&-consumer-migration/44-05-VERIFICATION.md`
- **Verification:** Exact grep count is `0` for both all-package and production-only scopes.
- **Committed in:** `f9f5545` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Verification bug fix improved accuracy only; no scope creep and all deletion goals remained unchanged.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- RMVL-01 through RMVL-06 deletion requirements are complete and build is green.
- Safety tag is in place for rollback if needed.
- Test suites still include imports/usages of deleted imperative files and should be cleaned in `44-06-PLAN.md` alongside boundary guard verification.

---
*Phase: 44-imperative-layer-removal-&-consumer-migration*
*Completed: 2026-03-01*
