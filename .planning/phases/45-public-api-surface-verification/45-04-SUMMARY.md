---
phase: 45-public-api-surface-verification
plan: 04
subsystem: api
tags: [effect, layer-composition, type-safety, services]

# Dependency graph
requires:
  - phase: 41-effect-service-contracts
    provides: All 14 Effect service implementations
  - phase: 44-imperative-deletion
    provides: Removed imperative managers; runtime uses Effect services exclusively
provides:
  - Canonical FredLayers providing all 14 FredServices tags without type assertions
  - Default no-op MessageRouterService layer for base composition
  - Clean removal of FredLayersWithIntentRouting (consolidated into FredLayers)
affects: [45-05-PLAN, api-surface, release-verification]

# Tech tracking
tech-stack:
  added: []
  patterns: [Layer.succeed for no-op service defaults, Layer.merge for service override in composition]

key-files:
  created: []
  modified:
    - packages/core/src/services.ts
    - packages/core/src/index.ts
    - tests/unit/core/services.test.ts

key-decisions:
  - "Default no-op MessageRouterService uses Layer.succeed with NoAgentsAvailableError to satisfy FredServices union without external config"
  - "makeFredLayersWithLeafRouting uses Layer.merge (not Layer.provideMerge) so the config-driven router takes priority over the default no-op"
  - "FredLayersWithIntentRouting removed entirely (not deprecated) since FredLayers now includes intent services"

patterns-established:
  - "No-op service defaults via Layer.succeed: provide placeholder implementations for optional services so the base layer composition satisfies all tags"
  - "Service override via Layer.merge: right-side layer takes priority, enabling config-driven replacements of default services"

requirements-completed: [API-03, TEST-01, TEST-02, TEST-03]

# Metrics
duration: 4min
completed: 2026-03-01
---

# Phase 45 Plan 04: Canonical FredLayers Summary

**Canonical FredLayers now provides all 14 FredServices tags with zero type assertions, using Layer.succeed for default no-op MessageRouterService and Layer.merge for config-driven override**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-01T21:24:23Z
- **Completed:** 2026-03-01T21:28:55Z
- **Tasks:** 1
- **Files modified:** 3

## Accomplishments
- FredLayers provides all 14 services from FredServices (IntentMatcher, IntentRouter, MessageRouter now included)
- Zero `as Layer.Layer<FredServices>` casts remain in services.ts
- TS2322 type error at effect/layers.ts:36 is resolved (withCustomLayer now typechecks naturally)
- FredLayersWithIntentRouting removed entirely (replaced by FredLayers)
- All 1629 tests pass with zero regressions

## Task Commits

Each task was committed atomically:

1. **Task 1: Include intent and router services in FredLayers and remove type assertions** - `278ae1c` (feat)

**Plan metadata:** (pending docs commit)

## Files Created/Modified
- `packages/core/src/services.ts` - Added default no-op MessageRouterService layer, included intentLayer and defaultRouterLayer in FredLayers, removed FredLayersWithIntentRouting, removed `as` casts from makeFredRuntimeLayer, updated makeFredLayersWithLeafRouting to use Layer.merge
- `packages/core/src/index.ts` - Removed FredLayersWithIntentRouting from re-export block
- `tests/unit/core/services.test.ts` - Replaced all FredLayersWithIntentRouting references with FredLayers, updated import and test description

## Decisions Made
- Used `Layer.succeed(MessageRouterService, { ... })` for the default no-op router layer since it has no dependencies and just fails with `NoAgentsAvailableError`
- Used `Layer.merge` (not `Layer.provideMerge`) in `makeFredLayersWithLeafRouting` because right-side takes priority in merge, allowing the config-driven router to replace the default
- Clean removal of `FredLayersWithIntentRouting` rather than deprecation alias, since FredLayers now subsumes its functionality

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Used Layer.merge instead of Layer.provideMerge for router override**
- **Found during:** Task 1 (verification step)
- **Issue:** Plan specified `Layer.provideMerge(FredLayers, routerLayer)` for `makeFredLayersWithLeafRouting`, but `Layer.provideMerge` does not replace the output of an already-provided service tag. The routing integration tests failed because the default no-op MessageRouterService was still being used.
- **Fix:** Changed to `Layer.merge(FredLayers, routerLayer)` where Layer.merge gives the right-side layer priority for duplicate output tags.
- **Files modified:** packages/core/src/services.ts
- **Verification:** All 17 previously-failing routing tests now pass. Full suite: 1629 pass, 0 fail.
- **Committed in:** 278ae1c (Task 1 commit)

**2. [Rule 3 - Blocking] Updated test file that imports FredLayersWithIntentRouting**
- **Found during:** Task 1
- **Issue:** Plan did not mention tests/unit/core/services.test.ts which imports and uses FredLayersWithIntentRouting extensively. Removing the export without updating tests would break compilation.
- **Fix:** Replaced all FredLayersWithIntentRouting references with FredLayers in the test file and updated the import.
- **Files modified:** tests/unit/core/services.test.ts
- **Verification:** All 36 services tests pass.
- **Committed in:** 278ae1c (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 blocking)
**Impact on plan:** Both auto-fixes were necessary for correctness. Layer.merge was the correct composition primitive. Test updates were required to remove deleted export. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- FredLayers is now the single canonical all-services layer for the framework
- API-03 requirement (canonical layer) is satisfied
- Ready for Phase 45 Plan 05 (if any remaining verification tasks)

---
*Phase: 45-public-api-surface-verification*
*Completed: 2026-03-01*
