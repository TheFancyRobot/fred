---
phase: 33-default-launch-contract-alignment
plan: 03
subsystem: ui
tags: [cli, tui, sessions, startup-chooser, testing]

# Dependency graph
requires:
  - phase: 33-01
    provides: no-args and tui/chat launch parity contract
  - phase: 33-02
    provides: startup chooser flow and startup warning integration
provides:
  - launch parity smoke harness coverage for phase 33
  - startup chooser resilience when persisted timestamps are serialized
  - chooser-first interactive startup even when no prior sessions exist
  - sqlite-backed persistence for no-config CLI chat relaunch continuity
  - stable startup chooser affordance without dismissible hint copy
  - resume-previous chooser handoff to sidebar before transcript restore
  - human-verified launch parity contract approval for startup chooser and resume flow
affects: [phase-33-acceptance, cli-launch-contract, tui-session-bootstrap]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - defensive timestamp normalization at session boundary before UI sorting
    - launch-contract regression coverage in dedicated smoke suite

key-files:
  created:
    - .planning/phases/33-default-launch-contract-alignment/33-03-SUMMARY.md
  modified:
    - packages/cli/src/tui/session.ts
    - packages/cli/src/tui/state.ts
    - packages/cli/src/tui/app.ts
    - packages/cli/src/tui/layout.ts
    - packages/cli/src/commands/chat.ts
    - tests/unit/cli/phase33-launch-contract-smoke.test.ts
    - tests/unit/cli/tui-app.test.ts
    - tests/unit/cli/tui-layout.test.ts
    - tests/unit/cli/tui/session-state.test.ts

key-decisions:
  - "Normalize updatedAt values from persisted session records before startup chooser sorting"
  - "Always open startup chooser for interactive launch unless initialSessionId is explicitly forced"
  - "Use sqlite context storage in no-config chat fallback so sessions persist across relaunches"
  - "Startup chooser should use persistent visual affordances, not dismissible hint copy"
  - "Resume-previous chooser path should hand off to sidebar selection before restoring transcript"

patterns-established:
  - "Startup chooser session ordering must tolerate runtime Date/string drift from persisted stores"

# Metrics
duration: 51 min
completed: 2026-02-15
---

# Phase 33 Plan 03: Default Launch Contract Alignment Summary

**Launch chooser bootstrap now survives serialized session timestamps so existing-session starts still show chooser and resume-last restores transcript state.**

## Performance

- **Duration:** 51 min
- **Started:** 2026-02-14T23:12:39Z
- **Completed:** 2026-02-15T00:04:02Z
- **Tasks:** 3/3 complete (2 automated tasks + blocking human verification approved)
- **Files modified:** 6

## Accomplishments
- Added dedicated Phase 33 launch-contract smoke coverage and executed the launch matrix from prior checkpointed work.
- Fixed continuation parity defect where persisted session timestamps could skip chooser bootstrap in real TTY flow.
- Added regression coverage proving chooser/open/resume behavior remains correct with serialized timestamp payloads.
- Fixed chooser gating so interactive startup shows chooser even when session list is initially empty.
- Added no-config sqlite persistence wiring so start-new sessions survive relaunch and can be resumed.
- Replaced disappearing startup hint line with stable chooser affordances (persistent instruction line, stronger marker, header/selection emphasis).
- Updated resume chooser flow to hand off to sidebar selection before transcript load, then focus input after sidebar confirmation.
- Completed blocking manual parity verification with approval of final chooser UX behavior.

## Task Commits

Each completed task was committed atomically:

1. **Task 1: Add dedicated Phase 33 launch-contract smoke suite** - `ec85ba1` (test)
2. **Task 2: Run launch smoke matrix and fix integration drift** - `3f50134` (test)
3. **Task 3 continuation: Fix human-verification parity defects from checkpoint feedback** - `b08eef7` (fix)
4. **Task 3 continuation (round 2): Resolve repeated manual parity failures** - `1002a6d` (fix)
5. **Task 3 continuation (round 3): Remove dismissible chooser hint and harden startup affordance** - `0e064ee` (fix)
6. **Task 3 continuation (round 4): Route resume chooser through sidebar confirmation flow** - `07a402d` (fix)

Plan metadata completion commit captured after approval.

## Files Created/Modified
- `.planning/phases/33-default-launch-contract-alignment/33-03-SUMMARY.md` - Plan execution summary with continuation checkpoint status.
- `packages/cli/src/tui/session.ts` - Normalizes `updatedAt` values from persisted session summaries.
- `packages/cli/src/tui/state.ts` - Enforces chooser-first startup gating for interactive launches without forced session id.
- `packages/cli/src/tui/app.ts` - Adds resume-path fallback to create/select a new session when chooser resume has no selected session.
- `packages/cli/src/tui/layout.ts` - Renders startup chooser with stable instruction copy and updated "Resume previous session" label.
- `packages/cli/src/commands/chat.ts` - Configures sqlite persistence in no-config fallback so relaunches can resume sessions.
- `tests/unit/cli/phase33-launch-contract-smoke.test.ts` - Adds persistence contract checks and empty-session chooser startup regression.
- `tests/unit/cli/tui-app.test.ts` - Adds chooser-first coverage for empty session startup and resume handoff through sidebar confirmation.
- `tests/unit/cli/tui-layout.test.ts` - Locks no-hint chooser UX and persistent instruction affordance rendering.
- `tests/unit/cli/tui/session-state.test.ts` - Locks chooser-open contract for empty interactive session lists.

## Decisions Made
- Normalized session timestamps at the TUI session mapping boundary to prevent startup chooser bootstrap failures caused by runtime Date/string drift.
- Always open startup chooser for interactive launch unless an explicit `initialSessionId` forces direct restore.
- Default no-config `fred chat` persistence to sqlite (`FRED_SQLITE_PATH` or `./fred.db`) so launch chooser can resume prior sessions after restart.
- Removed startup hint dismissal behavior and switched chooser guidance to persistent, terminal-safe emphasis so required selection remains clear during arrow-key navigation.
- Resume chooser selection now transfers focus to sidebar with most-recent session selected and only restores transcript after sidebar confirmation.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Startup chooser silently skipped when session timestamps were serialized strings**
- **Found during:** Task 3 (Human verification of launch parity contract)
- **Issue:** Session sorting relied on `Date#getTime()` and could throw when persisted records surfaced non-Date values, causing chooser/session bootstrap to be bypassed.
- **Fix:** Added timestamp normalization in session mapping plus defensive sort-time coercion and regression smoke coverage.
- **Files modified:** `packages/cli/src/tui/session.ts`, `packages/cli/src/tui/state.ts`, `tests/unit/cli/phase33-launch-contract-smoke.test.ts`
- **Verification:** `bun test tests/unit/cli/phase33-launch-contract-smoke.test.ts tests/unit/cli/phase27-smoke.test.ts tests/unit/cli/tui-app.test.ts`; `bunx tsc --noEmit`
- **Committed in:** `b08eef7`

---

**2. [Rule 1 - Bug] Chooser-first contract failed when no existing sessions were present**
- **Found during:** Task 3 re-verification after checkpoint feedback
- **Issue:** Startup chooser opened only when session list was non-empty, so first-run launches skipped chooser and focused input immediately.
- **Fix:** Changed chooser gate to open on interactive startup whenever no explicit `initialSessionId` is forced.
- **Files modified:** `packages/cli/src/tui/state.ts`, `tests/unit/cli/tui/session-state.test.ts`, `tests/unit/cli/tui-app.test.ts`, `tests/unit/cli/phase33-launch-contract-smoke.test.ts`
- **Verification:** `bun test tests/unit/cli/phase33-launch-contract-smoke.test.ts tests/unit/cli/phase27-smoke.test.ts tests/unit/cli/tui-app.test.ts tests/unit/cli/tui/session-state.test.ts tests/unit/cli/chat-command.test.ts`; `bunx tsc --noEmit`
- **Committed in:** `1002a6d`

**3. [Rule 2 - Missing Critical] No-config chat used in-memory context storage, preventing relaunch resume**
- **Found during:** Task 3 re-verification after checkpoint feedback
- **Issue:** Fallback `fred chat` path did not configure persistent storage, so sessions created from startup chooser could not reappear after restart.
- **Fix:** Added sqlite fallback persistence configuration (`FRED_SQLITE_PATH` or `./fred.db`) and covered startup contract behavior in smoke tests.
- **Files modified:** `packages/cli/src/commands/chat.ts`, `tests/unit/cli/phase33-launch-contract-smoke.test.ts`
- **Verification:** `bun test tests/unit/cli/phase33-launch-contract-smoke.test.ts tests/unit/cli/phase27-smoke.test.ts tests/unit/cli/tui-app.test.ts tests/unit/cli/tui/session-state.test.ts tests/unit/cli/chat-command.test.ts`; `bunx tsc --noEmit`
- **Committed in:** `1002a6d`

---

**4. [Rule 1 - Bug] Startup chooser hint line disappeared after arrow-key navigation**
- **Found during:** Task 3 re-verification after checkpoint feedback
- **Issue:** Dismissible hint behavior removed the only guidance line while navigating chooser options, creating inconsistent startup affordance.
- **Fix:** Removed startup hint state/rendering entirely and replaced it with stable chooser cues: persistent instruction line, stronger selected marker, and emphasized header/selection styling.
- **Files modified:** `packages/cli/src/tui/app.ts`, `packages/cli/src/tui/layout.ts`, `tests/unit/cli/tui-app.test.ts`, `tests/unit/cli/tui-layout.test.ts`
- **Verification:** `bun test tests/unit/cli/phase33-launch-contract-smoke.test.ts tests/unit/cli/phase27-smoke.test.ts tests/unit/cli/tui-app.test.ts tests/unit/cli/tui-layout.test.ts tests/unit/cli/tui/session-state.test.ts tests/unit/cli/chat-command.test.ts`; `bunx tsc --noEmit`
- **Committed in:** `0e064ee`

---

**5. [Rule 1 - Bug] Resume chooser auto-opened transcript instead of handing off through sidebar**
- **Found during:** Task 3 final checkpoint feedback
- **Issue:** Selecting resume at startup immediately loaded the latest transcript and moved focus to input, preventing sidebar confirmation flow.
- **Fix:** Changed chooser confirmation to close chooser + focus sidebar, then load transcript and move focus to input only after sidebar session confirmation.
- **Files modified:** `packages/cli/src/tui/app.ts`, `packages/cli/src/tui/layout.ts`, `tests/unit/cli/tui-app.test.ts`, `tests/unit/cli/tui-layout.test.ts`, `tests/unit/cli/phase33-launch-contract-smoke.test.ts`
- **Verification:** `bun test tests/unit/cli/phase33-launch-contract-smoke.test.ts tests/unit/cli/phase27-smoke.test.ts tests/unit/cli/tui-app.test.ts tests/unit/cli/tui-layout.test.ts tests/unit/cli/tui/session-state.test.ts tests/unit/cli/chat-command.test.ts`; `bunx tsc --noEmit`
- **Committed in:** `07a402d`

---

**Total deviations:** 5 auto-fixed (4 Rule 1 bugs, 1 Rule 2 missing critical)
**Impact on plan:** Continuation fixes restore chooser-first startup, relaunch persistence, stable startup affordance parity, and the required resume-via-sidebar flow for manual acceptance.

## Authentication Gates

None.

## Issues Encountered
- Manual parity checkpoint feedback exposed runtime data-shape drift not covered by original fixture dates.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Automated parity matrix and typecheck are green after continuation fixes.
- Human checkpoint approved: launch contract parity validated for no-args and `tui` in TTY and non-TTY modes.
- Accepted UX contract: startup chooser defaults to Start new, Enter starts focused chat, Resume path restores via sidebar confirmation then returns focus to input.

---
*Phase: 33-default-launch-contract-alignment*
*Completed: 2026-02-15*
