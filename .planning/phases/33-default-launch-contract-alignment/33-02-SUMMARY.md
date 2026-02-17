---
phase: 33-default-launch-contract-alignment
plan: 02
subsystem: ui
tags: [tui, cli, startup-chooser, session-management, opentui]

# Dependency graph
requires:
  - phase: 33-01
    provides: Shared launch routing parity for `fred`, `fred chat`, and `fred tui`
  - phase: 29-03
    provides: Session list ordering and sidebar session navigation model
provides:
  - Startup chooser with resume/start-new selection before interactive session load
  - Deterministic key-driven chooser behavior with default Enter action on start-new
  - Immediate composer focus handoff and concise, dismissible startup guidance
affects: [33-03-launch-smoke, launch-parity-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Chooser-first startup state machine in TUI state/keymap/app layers
    - In-TUI startup warning fallback when config initialization fails

key-files:
  created: []
  modified:
    - packages/cli/src/tui/state.ts
    - packages/cli/src/tui/keymap.ts
    - packages/cli/src/tui/layout.ts
    - packages/cli/src/tui/app.ts
    - packages/cli/src/commands/chat.ts
    - tests/unit/cli/tui/session-state.test.ts
    - tests/unit/cli/tui-keymap.test.ts
    - tests/unit/cli/tui-layout.test.ts
    - tests/unit/cli/tui-app.test.ts

key-decisions:
  - "Default chooser selection is start-new-session; Enter executes highlighted choice immediately"
  - "Config initialization failures in interactive launch are surfaced in TUI startup content instead of immediate fail-fast"

patterns-established:
  - "Startup chooser keys preempt normal pane routing while chooser is open"
  - "Composer input focus is explicitly restored after startup decision paths"

# Metrics
duration: 4 min
completed: 2026-02-14
---

# Phase 33 Plan 02: Startup Chooser UX Summary

**Interactive startup now presents a compact resume-or-new chooser with start-new default, immediate Enter execution, and guaranteed composer focus after selection.**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-14T22:33:32Z
- **Completed:** 2026-02-14T22:38:30Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Added startup chooser state machine primitives and chooser-specific key routing before pane-level handling.
- Wired app bootstrap to open chooser when existing sessions are present (without forced initial session) and execute resume/new paths correctly.
- Implemented concise, dismissible startup guidance and added an in-TUI startup warning path for config-init fallback conditions.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add startup chooser state transitions and key handling** - `7b00b15` (feat)
2. **Task 2: Wire chooser UI, launch hints, and post-selection focus behavior** - `8d51582` (feat)

**Plan metadata:** pending

## Files Created/Modified
- `packages/cli/src/tui/state.ts` - Added startup chooser state, open/close/select transitions, hint visibility, and startup warning state.
- `packages/cli/src/tui/keymap.ts` - Added chooser-priority key mapping/actions for up/down/tab/enter while chooser is open.
- `packages/cli/src/tui/app.ts` - Added chooser-aware session bootstrap, startup decision execution, and focus handoff to input.
- `packages/cli/src/tui/layout.ts` - Rendered compact chooser and concise startup hint/warning content in transcript pane.
- `packages/cli/src/commands/chat.ts` - Passed config-init fallback warning into TUI startup state instead of warning-only terminal output.
- `tests/unit/cli/tui/session-state.test.ts` - Added chooser state transition and open-condition coverage.
- `tests/unit/cli/tui-keymap.test.ts` - Added chooser key-consumption and selection behavior coverage.
- `tests/unit/cli/tui-layout.test.ts` - Added chooser/hint rendering assertions and concise hint checks.
- `tests/unit/cli/tui-app.test.ts` - Added integration coverage for default chooser selection, start-new/resume outcomes, and input focus post-selection.

## Decisions Made
- Chose a two-option startup chooser model (`resume-last-session`, `start-new-session`) with deterministic default selection on `start-new-session` to match launch parity requirements.
- Chose to surface config-load failures as concise startup warnings inside the TUI instead of immediate interactive-mode abort, preserving choice-driven startup flow.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `33-03-PLAN.md` launch parity smoke coverage and human checkpoint validation.
No blockers identified from this plan.

---
*Phase: 33-default-launch-contract-alignment*
*Completed: 2026-02-14*
