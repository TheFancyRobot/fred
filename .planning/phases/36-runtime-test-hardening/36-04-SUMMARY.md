---
phase: 36-runtime-test-hardening
plan: 04
subsystem: testing
tags: [tui, opentui, keymap, regression, startup-chooser]

# Dependency graph
requires:
  - phase: 33-default-launch-contract-alignment
    provides: startup chooser flow and chooser-first launch behavior
  - phase: 36-runtime-test-hardening
    provides: production app quit path (`action.type === 'quit'`) wired in TUI processKey handling
provides:
  - Chooser-open Ctrl+C and Escape now map to `quit` instead of `noop`
  - Regression tests for chooser-time quit behavior at keymap and app integration layers
affects:
  - Phase 36 UAT closure for interactive quit behavior
  - Future TUI keymap changes touching startup chooser routing

# Tech tracking
tech-stack:
  added: []
  patterns: ["Chooser-first key routing with explicit global interrupt passthrough", "Startup chooser quit behavior validated at both unit and integration test layers"]

key-files:
  created:
    - .planning/phases/36-runtime-test-hardening/36-04-SUMMARY.md
  modified:
    - packages/cli/src/tui/keymap.ts
    - tests/unit/cli/tui-keymap.test.ts
    - tests/unit/cli/tui-app.test.ts

key-decisions:
  - "Keep startup chooser navigation intact while handling Ctrl+C and Escape as immediate quit interrupts"
  - "Assert chooser-open quit behavior in both keymap unit tests and FredTuiApp integration tests"

patterns-established:
  - "Chooser branch handles global interrupts before chooser-specific fallback noop"
  - "Gap-closure regressions pair direct keymap assertions with app-level lifecycle assertions"

# Metrics
duration: 1 min
completed: 2026-02-16
---

# Phase 36 Plan 04: Startup Chooser Quit Gap Closure Summary

**Startup chooser now honors immediate Ctrl+C/Escape quit interrupts through the same deterministic app quit path, with regression coverage preventing reintroduction of chooser-time exit deadlocks.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-02-16T19:37:37Z
- **Completed:** 2026-02-16T19:39:25Z
- **Tasks:** 3/3
- **Files modified:** 3

## Accomplishments

- Restored global interruption behavior during startup chooser by mapping `Ctrl+C` and `Escape` to `quit` before chooser fallback `noop`
- Added keymap regression coverage locking chooser-open quit mappings plus chooser navigation parity
- Added app-level integration regression proving chooser-open `Ctrl+C` stops the app immediately without requiring any startup session selection action

## Task Commits

Each task was committed atomically:

1. **Task 1: Restore global quit mapping while startup chooser is open** - `98e7752` (fix)
2. **Task 2: Add keymap regression coverage for chooser-time quit keys** - `a7c915c` (test)
3. **Task 3: Add app-level startup chooser exit regression test** - `31ba84d` (test)

## Files Created/Modified

- `packages/cli/src/tui/keymap.ts` - Startup chooser mapping now emits `quit` for `Ctrl+C`/`Escape` while preserving chooser navigation and confirm keys
- `tests/unit/cli/tui-keymap.test.ts` - Added chooser-open quit assertions and chooser navigation mapping regression checks
- `tests/unit/cli/tui-app.test.ts` - Added integration test proving immediate chooser-open `Ctrl+C` exits app and fires `onQuit`

## Decisions Made

- Prioritized deterministic app shutdown by routing chooser-open interruption keys to the existing `action.type === 'quit'` path used by `FredTuiApp.processKey`
- Enforced regression depth at two levels (keymap + app integration) so mapping regressions and lifecycle regressions are both caught quickly

## Deviations from Plan

None - plan executed exactly as written.

## Authentication Gates

None.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Gap closure complete; UAT truth for chooser-time immediate exit is now covered by deterministic automated tests
- No blockers introduced for follow-on maintenance

---
*Phase: 36-runtime-test-hardening*
*Completed: 2026-02-16*
