---
phase: 43-fred-class-migration
plan: 06
subsystem: api
tags: [effect, context-storage, fred-facade, lazy-init, runtime-replay]

# Dependency graph
requires:
  - phase: 43-fred-class-migration (plans 01-05)
    provides: Fred facade migration with Effect runtime, service delegation, static guard compliance
provides:
  - Pre-runtime-safe getContextManager proxy (no throw on lazy-init Fred)
  - ContextStorageService.replaceStorage for runtime adapter injection
  - Pending context state replay (policy and storage) on runtime initialization
  - ensureRuntime guard in initializeFromConfig before ConfigInitializer delegation
affects: [44-imperative-layer-removal, dev-chat, cli-chat]

# Tech tracking
tech-stack:
  added: []
  patterns: [external-storage-adapter, pending-state-replay, pre-runtime-proxy]

key-files:
  created: []
  modified:
    - packages/core/src/context/service.ts
    - packages/core/src/index.ts
    - tests/unit/core/migration/phase-43-fred-facade-contract.test.ts

key-decisions:
  - "getContextManager proxy returns safe pre-runtime stubs that queue state for replay, matching getAgentManager pattern"
  - "ExternalStorageAdapter wraps Promise-based ContextStorage into Effect interface for replaceStorage"
  - "initializeFromConfig calls ensureRuntime() after invalidateRuntime to guarantee runtime exists before ConfigInitializer"

patterns-established:
  - "Pending state replay: pre-runtime calls queue state, applyRuntimeState replays into services"
  - "ExternalStorageAdapter: bridge between Promise-based ContextStorage and Effect-based service internals"

requirements-completed: [FRED-01, FRED-09]

# Metrics
duration: 3min
completed: 2026-03-01
---

# Phase 43 Plan 06: UAT Gap Closure Summary

**Pre-runtime-safe getContextManager proxy with replaceStorage adapter injection and pending state replay**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-01T05:08:49Z
- **Completed:** 2026-03-01T05:12:14Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Fixed getContextManager() to return a safe proxy pre-runtime instead of throwing, enabling lazy-init Fred consumers
- Added replaceStorage method to ContextStorageService with ExternalStorageAdapter bridge class
- Added pending state replay for context policy and storage adapter in applyRuntimeState
- Added ensureRuntime() guard in initializeFromConfig before ConfigInitializer delegation
- Added 5 contract tests covering pre-runtime proxy behavior and initializeFromConfig guard

## Task Commits

Each task was committed atomically:

1. **Task 1: Add replaceStorage to ContextStorageService and fix getContextManager proxy** - `a12b280` (feat)
2. **Task 2: Add contract tests for pre-runtime getContextManager and setStorage support** - `9d58ccf` (test)

## Files Created/Modified
- `packages/core/src/context/service.ts` - Added replaceStorage to interface/impl, ExternalStorageAdapter class
- `packages/core/src/index.ts` - Rewrote getContextManager proxy, added pending state fields, ensureRuntime in initializeFromConfig
- `tests/unit/core/migration/phase-43-fred-facade-contract.test.ts` - Added 5 consumer compatibility contract tests

## Decisions Made
- getContextManager proxy returns safe pre-runtime stubs that queue state for replay, matching the getAgentManager pattern
- ExternalStorageAdapter wraps Promise-based ContextStorage into Effect interface with error-tolerant Effect.tryPromise/catchAll
- initializeFromConfig calls ensureRuntime() after invalidateRuntime to guarantee runtime exists before ConfigInitializer accesses service proxies

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed test regex for initializeFromConfig method body extraction**
- **Found during:** Task 2
- **Issue:** The extractMethodBody regex matched the options parameter type literal brace instead of the method body brace, because the method signature spans multiple lines
- **Fix:** Changed regex to match up to `Promise<void>` return type using `[\s\S]*?` non-greedy multiline pattern
- **Files modified:** tests/unit/core/migration/phase-43-fred-facade-contract.test.ts
- **Verification:** All 11 tests pass
- **Committed in:** 9d58ccf (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor test regex adjustment, no scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 43 gap closure complete - all consumer compatibility issues resolved
- Fred facade now safe for lazy-init consumers (dev-chat, CLI chat)
- Ready for Phase 44: Imperative Layer Removal & Consumer Migration

## Self-Check: PASSED

All files exist. All commits verified.

---
*Phase: 43-fred-class-migration*
*Completed: 2026-03-01*
