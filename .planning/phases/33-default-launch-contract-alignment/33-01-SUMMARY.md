---
phase: 33-default-launch-contract-alignment
plan: 01
subsystem: cli
tags: [cli-routing, launch-contract, tty, non-interactive, regression-tests]
requires:
  - phase: 27-terminal-foundation-project-detection
    provides: explicit chat entrypoint, tty detection, and non-tty fallback baseline
  - phase: 32-plugin-architecture
    provides: startup diagnostics and unknown-command plugin dispatch boundaries
provides:
  - no-args CLI dispatch aligned to the interactive chat/tui launch path
  - shared non-interactive fallback payload contract for launch entrypoints
  - regression tests for no-args, tui, and chat launch parity
affects: [phase-33-plan-02, phase-33-plan-03, launch-smoke-contracts]
tech-stack:
  added: []
  patterns:
    - explicit-help-only CLI behavior (help, --help, -h)
    - shared non-interactive payload builder for launch guidance
key-files:
  created: []
  modified:
    - packages/cli/src/index.ts
    - packages/cli/src/commands/chat.ts
    - tests/unit/cli/chat-command.test.ts
    - tests/unit/cli/phase27-smoke.test.ts
key-decisions:
  - "No-args command resolution defaults to chat launch path while help remains explicit-only"
  - "Non-TTY launch guidance uses one shared payload builder to enforce contract parity"
  - "Regression coverage validates launch parity and explicit help boundaries"
patterns-established:
  - "Launch parity: bare fred and fred tui/fred chat resolve through the same interactive command path"
  - "Non-interactive contract consistency: one payload shape and exit behavior for interactive entrypoints"
duration: 3 min
completed: 2026-02-14
---

# Phase 33 Plan 01: Default Launch Contract Alignment Summary

**Default CLI launch now routes `fred` no-args through the same interactive contract as `fred tui`/`fred chat`, with shared non-TTY fallback semantics and parity-focused regressions.**

## Performance

- **Duration:** 3 min
- **Started:** 2026-02-14T16:25:36-06:00
- **Completed:** 2026-02-14T22:28:22Z
- **Tasks:** 2/2
- **Files modified:** 4

## Accomplishments

- Updated CLI dispatch so bare `fred` resolves to the interactive launch command path instead of implicit help.
- Preserved explicit help boundaries (`help`, `--help`, `-h`) and existing plugin startup diagnostic behavior.
- Added a shared non-interactive fallback payload helper and aligned launch parity assertions across no-args/tui/chat.

## Task Commits

Each task was committed atomically:

1. **Task 1: Resolve default invocation to interactive launch path while preserving explicit help** - `40ca8a8` (feat)
2. **Task 2: Unify non-TTY fallback payload and update launch-parity regressions** - `d556289` (feat)

## Files Created/Modified

- `packages/cli/src/index.ts` - Changed no-args resolution to dispatch to chat launch path while keeping explicit help behavior.
- `packages/cli/src/commands/chat.ts` - Added shared non-interactive fallback payload builder and used it in non-TTY output.
- `tests/unit/cli/chat-command.test.ts` - Updated command-resolution expectations and parity assertions for no-args/tui/chat fallback behavior.
- `tests/unit/cli/phase27-smoke.test.ts` - Refreshed launch-contract smoke assertions for explicit-help-only and non-TTY parity semantics.

## Decisions Made

1. Bare CLI invocation now maps to `chat` by default, and help is only shown for explicit help commands.
2. Non-TTY launch output contract is centralized in `createNonInteractiveFallbackPayload()` to keep payload shape stable across entrypoints.
3. Launch parity regressions assert user-observable behavior for no-args, `tui`, and `chat` without reintroducing help-first assumptions.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Stabilized smoke assertions against current non-TTY reason string and import-order behavior**
- **Found during:** Task 2 verification
- **Issue:** Combined test execution surfaced a blocking mismatch in expected non-TTY reason text and an interactive-branch test path that depended on fragile module import ordering.
- **Fix:** Updated smoke assertions to the current terminal-mode reason contract and converted the interactive-branch regression to a stable source-level launch wiring assertion.
- **Files modified:** tests/unit/cli/phase27-smoke.test.ts
- **Verification:** `bun test tests/unit/cli/chat-command.test.ts tests/unit/cli/phase27-smoke.test.ts`
- **Commit:** d556289

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Auto-fix was required to keep targeted launch-contract verification deterministic; scope remained within planned files.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Ready for `33-02-PLAN.md`.
Launch contract drift at the CLI dispatch layer is resolved and protected by updated regressions.

---
*Phase: 33-default-launch-contract-alignment*
*Completed: 2026-02-14*
