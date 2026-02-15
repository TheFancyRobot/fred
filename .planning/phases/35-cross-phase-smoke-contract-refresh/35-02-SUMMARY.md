---
phase: 35-cross-phase-smoke-contract-refresh
plan: 02
subsystem: testing
tags: [cli, smoke-gate, contracts, bun-test, ci-evidence]

# Dependency graph
requires:
  - phase: 35-01
    provides: shared smoke-contract fixture and STALE_CONTRACT guard semantics
  - phase: 34-session-verification-recovery
    provides: decisive-line audit evidence conventions
provides:
  - consolidated non-fail-fast smoke orchestrator for phase 27/28/29/33 checks
  - stable `test:phase35:smoke` command for local and CI reruns
  - machine-first JSON artifact with per-check exit codes, channels, decisive lines, and linkage
affects: [35-03 audit refresh, 36 runtime-test-hardening, v0.2.1-milestone-audit]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - non-fail-fast smoke execution with one consolidated verdict
    - channelized failure diagnostics separating STALE_CONTRACT from SMOKE_FAILURE

key-files:
  created:
    - scripts/phase35-smoke.ts
    - .planning/phases/35-cross-phase-smoke-contract-refresh/35-smoke-evidence.json
  modified:
    - package.json

key-decisions:
  - "Run each target suite independently plus an integrated rollup command to preserve per-flow evidence while still validating bundle-level behavior"
  - "Classify stale smoke-contract signatures into STALE_CONTRACT with fixture-targeted remediation hints"

patterns-established:
  - "Cross-phase smoke evidence uses checks[] entries with command, exitCode, decisiveLines, and channel"

# Metrics
duration: 2 min
completed: 2026-02-15
---

# Phase 35 Plan 02: Cross-Phase Smoke Contract Refresh Summary

**Phase 35 now has a deterministic cross-phase smoke gate that always runs launch, streaming, TUI session, and CLI session checks, emits one consolidated verdict, and writes machine-first evidence with dedicated `STALE_CONTRACT` signaling.**

## Performance

- **Duration:** 2 min
- **Started:** 2026-02-15T06:37:32Z
- **Completed:** 2026-02-15T06:40:19Z
- **Tasks:** 3
- **Files modified:** 3

## Accomplishments
- Added `scripts/phase35-smoke.ts` to run six deterministic sub-flows (five suites + integrated rollup) in strict non-fail-fast order.
- Implemented per-check channelization (`OK`, `STALE_CONTRACT`, `SMOKE_FAILURE`) and concise decisive-line extraction for audit-friendly failure diagnosis.
- Wired `package.json` with `test:phase35:smoke` for one-command reruns in developer workflows and CI.
- Generated and committed `.planning/phases/35-cross-phase-smoke-contract-refresh/35-smoke-evidence.json` with linkage for phase27, phase28, phase29_tui (SESS-01..03), phase29_cli (SESS-04..07), and phase33.

## Task Commits

Each task was committed atomically:

1. **Task 1: Build non-fail-fast cross-phase smoke orchestrator** - `00ec8c3` (feat)
2. **Task 2: Wire reusable command entrypoint for the phase 35 smoke gate** - `26989e8` (chore)
3. **Task 3: Generate and persist machine-first smoke evidence artifact** - `9b8c39b` (docs)
4. **Task 3 follow-up: Refresh evidence with final verification run** - `f814836` (docs)

**Plan metadata:** pending

## Files Created/Modified
- `scripts/phase35-smoke.ts` - Consolidated phase 35 smoke runner with channelized diagnostics and JSON evidence emission.
- `package.json` - Adds `test:phase35:smoke` script alias for the consolidated gate.
- `.planning/phases/35-cross-phase-smoke-contract-refresh/35-smoke-evidence.json` - Machine-first smoke verdict artifact with linkage and per-check evidence.

## Decisions Made
- Prioritized explicit per-suite evidence alongside the integrated rollup to keep failure localization deterministic without sacrificing end-to-end coverage.
- Treated stale-contract drift as a dedicated diagnostic channel (`STALE_CONTRACT`) distinct from generic smoke failures to preserve actionable triage signals.

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 35-02 must-haves are satisfied with deterministic smoke orchestration and committed machine evidence.
- Ready for `35-03-PLAN.md` to refresh final audit references and publish cross-phase smoke proof links.

---
*Phase: 35-cross-phase-smoke-contract-refresh*
*Completed: 2026-02-15*
