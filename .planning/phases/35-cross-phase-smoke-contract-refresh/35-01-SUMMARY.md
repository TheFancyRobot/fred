---
phase: 35-cross-phase-smoke-contract-refresh
plan: 01
subsystem: testing
tags: [cli, smoke-tests, contract, bun-test, session-runtime]

# Dependency graph
requires:
  - phase: 34-session-verification-recovery
    provides: deterministic verification posture and decisive-lines audit standards
  - phase: 33-default-launch-contract-alignment
    provides: launch smoke baselines and cross-suite contract stabilization context
provides:
  - canonical Fred smoke mock fixture shared by phase 27/28/33 suites
  - explicit STALE_CONTRACT regression guard for stale launch/stream mock drift
  - passing combined smoke bundle across launch, streaming, and session paths
affects: [35-02 cross-phase smoke runner, 35-03 audit evidence refresh, v0.2.1-milestone-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - single-source smoke contract fixture for @fancyrobot/fred module mocks
    - stale-contract diagnostics with explicit channel labeling and remediation hints

key-files:
  created:
    - tests/unit/cli/fixtures/fred-smoke-contract.ts
    - tests/unit/cli/phase35-cross-phase-smoke.contract.test.ts
  modified:
    - tests/unit/cli/phase27-smoke.test.ts
    - tests/unit/cli/phase28-streaming-smoke.test.ts
    - tests/unit/cli/phase33-launch-contract-smoke.test.ts

key-decisions:
  - "Cross-phase launch and streaming smoke suites should consume one shared Fred contract fixture instead of per-file mock classes"
  - "Stale contract drift should emit explicit STALE_CONTRACT diagnostics with fixture-targeted remediation guidance"

patterns-established:
  - "Smoke suites that exercise handleChatCommand should import contract mocks from tests/unit/cli/fixtures/fred-smoke-contract.ts"

# Metrics
duration: 4 min
completed: 2026-02-15
---

# Phase 35 Plan 01: Cross-Phase Smoke Contract Refresh Summary

**Cross-phase launch and streaming smoke coverage now runs on one session-aware Fred mock contract with an explicit STALE_CONTRACT guard that catches stale mock drift before opaque runtime failures.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-15T06:30:28Z
- **Completed:** 2026-02-15T06:34:46Z
- **Tasks:** 3
- **Files modified:** 5

## Accomplishments
- Created `tests/unit/cli/fixtures/fred-smoke-contract.ts` as a canonical fixture exporting `createMockContextManager`, `MockSqliteContextStorage`, `createMockFredClass`, and `installFredSmokeContractMock`.
- Migrated phase 27, phase 28, and phase 33 smoke suites to use the shared fixture so all `handleChatCommand` smoke paths share the same session-aware `@fancyrobot/fred` mock shape.
- Added `tests/unit/cli/phase35-cross-phase-smoke.contract.test.ts` to assert contract completeness and emit deterministic `STALE_CONTRACT` diagnostics with actionable fixture remediation hints.
- Verified both required bundles pass, including cross-phase suite execution with no `fred.getContextManager is not a function` regression signal.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create canonical Fred smoke contract fixture** - `297a56a` (feat)
2. **Task 2: Migrate phase smoke suites to the shared contract fixture** - `25d3e2a` (test)
3. **Task 3: Add explicit stale-contract regression guard for cross-phase smoke** - `4c43b66` (test)

**Plan metadata:** pending

## Files Created/Modified
- `tests/unit/cli/fixtures/fred-smoke-contract.ts` - Shared contract fixture for launch/stream/session-aware smoke mocks.
- `tests/unit/cli/phase27-smoke.test.ts` - Replaced inline Fred mock with shared fixture contract usage.
- `tests/unit/cli/phase28-streaming-smoke.test.ts` - Replaced stale inline Fred mock and aligned streaming harness to session-aware fixture.
- `tests/unit/cli/phase33-launch-contract-smoke.test.ts` - Replaced inline Fred mock with shared fixture contract usage.
- `tests/unit/cli/phase35-cross-phase-smoke.contract.test.ts` - New stale-contract guard suite with deterministic `STALE_CONTRACT` diagnostics.

## Decisions Made
- Standardized cross-phase smoke harnesses on one reusable Fred mock contract fixture to prevent per-file mock-shape drift.
- Introduced explicit stale-contract diagnostics (`STALE_CONTRACT`) with fixture remediation hints instead of relying on opaque runtime TypeErrors.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 35-01 must-haves are satisfied and cross-phase smoke contracts are aligned.
- Ready for `35-02-PLAN.md` to build consolidated non-fail-fast smoke orchestration and machine-first evidence output.

---
*Phase: 35-cross-phase-smoke-contract-refresh*
*Completed: 2026-02-15*
