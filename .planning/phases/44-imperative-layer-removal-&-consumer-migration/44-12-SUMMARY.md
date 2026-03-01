---
phase: 44-imperative-layer-removal-&-consumer-migration
plan: 12
subsystem: api
tags: [fred, context, session, cli, effect]

# Dependency graph
requires:
  - phase: 44-11
    provides: Stable post-deletion baseline before final consumer migration
provides:
  - Fred exposes direct public context/session methods for remaining compatibility-surface operations
  - CLI chat command uses direct Fred API with no context-manager proxy accessor
  - CLI session command uses direct Fred session APIs with no legacy fallback path
affects: [44-13, 45-public-api-surface-&-verification, consumer-migration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Fred facade methods are first-class public API; compatibility proxies delegate to public methods only

key-files:
  created:
    - .planning/phases/44-imperative-layer-removal-&-consumer-migration/44-12-SUMMARY.md
  modified:
    - packages/core/src/index.ts
    - packages/cli/src/commands/chat.ts
    - packages/cli/src/commands/session.ts
    - tests/unit/cli/fixtures/fred-smoke-contract.ts
    - tests/unit/cli/phase35-cross-phase-smoke.contract.test.ts

key-decisions:
  - Promote context/session operations to direct Fred public methods and keep getContextManager as a delegating compatibility shim for this phase.
  - Treat stale smoke fixtures as regressions to fix in-plan so full-suite verification remains green after consumer migration.

patterns-established:
  - "CLI consumers should target direct Fred APIs, not dynamic compatibility accessors"

requirements-completed: [CONS-01, CONS-02, CONS-04]

# Metrics
duration: 29 min
completed: 2026-03-01
---

# Phase 44 Plan 12: Fred Public Context API and CLI Migration Summary

**Fred now exposes complete public context/session methods and CLI chat/session consumers call those methods directly without `getContextManager` proxy/fallback access patterns.**

## Performance

- **Duration:** 29 min
- **Started:** 2026-03-01T19:32:29Z
- **Completed:** 2026-03-01T20:01:37Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Added direct public `Fred` methods for context/session operations: `generateConversationId`, `setDefaultPolicy`, `setStorage`, `getHistory`, `addMessages`, `getContext`, `updateMetadata`, and `clearContext`
- Updated `getContextManager` compatibility proxy to delegate to the new public methods instead of duplicating implementation logic
- Removed chat command proxy helpers (`getFredContextProxy`, `GET_CONTEXT_MANAGER`) and switched to direct `fred.setStorage()` and `fred` as session context service
- Removed session command legacy fallback path (`getLegacySessionApi`/dynamic accessor) and now call direct `fred.listSessions()`, `fred.getSession()`, `fred.exportSession()`, and `fred.deleteSession()`
- Verified migration guard and full test suite passed (`1625 pass, 0 fail`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add direct public context methods to Fred class** - `f5a2de6` (feat)
2. **Task 2: Migrate CLI chat/session consumers off proxy/fallback patterns** - `9fcb86f` (feat)

**Plan metadata:** (captured in docs commit for this plan)

## Files Created/Modified
- `packages/core/src/index.ts` - Added direct public context/session methods and made `getContextManager` delegate to them
- `packages/cli/src/commands/chat.ts` - Removed proxy access pattern and switched to direct Fred API usage
- `packages/cli/src/commands/session.ts` - Removed legacy fallback helpers and switched to direct session API calls
- `tests/unit/cli/fixtures/fred-smoke-contract.ts` - Updated smoke fixture Fred mock to expose new direct context/session API surface
- `tests/unit/cli/phase35-cross-phase-smoke.contract.test.ts` - Updated stale-contract assertions to validate the direct Fred API contract

## Decisions Made
- Kept `getContextManager` in place for compatibility in this plan but reduced it to a thin delegator over the new direct Fred methods so migration can continue safely in 44-13.
- Updated smoke-contract fixtures to reflect the direct API contract immediately, preventing test harnesses from masking consumer migration regressions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed CLI smoke fixtures that still modeled proxy-only Fred contract**
- **Found during:** Task 2 (Migrate CLI chat.ts and session.ts off getContextManager proxy)
- **Issue:** Full-suite runs failed because injected smoke-test doubles did not implement the new direct `fred.setStorage`/context-session method surface, causing chat launch contract tests to break.
- **Fix:** Added direct context/session methods to shared smoke fixture `MockFred` and updated phase35 stale-contract assertions to validate direct API members.
- **Files modified:** tests/unit/cli/fixtures/fred-smoke-contract.ts, tests/unit/cli/phase35-cross-phase-smoke.contract.test.ts
- **Verification:** `bun test tests/unit/cli/phase28-streaming-smoke.test.ts`, `bun test tests/unit/cli/phase33-launch-contract-smoke.test.ts`, `bun test tests/unit/cli/phase35-cross-phase-smoke.contract.test.ts`, and full `bun test` all passed.
- **Committed in:** `9fcb86f` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Auto-fix aligned test contracts with the migrated public API and prevented false regressions; no scope creep.

## Issues Encountered
- Initial full-suite run after consumer migration failed in CLI smoke contract tests due stale mocks expecting old proxy behavior; resolved by updating fixtures/contracts to the new direct API.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Gap 1 for CLI consumer migration is closed; chat/session now use Fred public APIs directly.
- Ready for `44-13-PLAN.md` to migrate remaining dev consumers and remove the `getContextManager` compatibility proxy.

---
*Phase: 44-imperative-layer-removal-&-consumer-migration*
*Completed: 2026-03-01*
