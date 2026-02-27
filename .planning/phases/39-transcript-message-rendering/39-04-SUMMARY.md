---
phase: 39-transcript-message-rendering
plan: 04
subsystem: ui
tags: [tui, paste, scroll, clipboard, opentui, keymap]

# Dependency graph
requires:
  - phase: 39-transcript-message-rendering
    provides: "Message rendering, tool blocks, SyntaxStyle configuration (plans 01-03)"
provides:
  - "Paste event handler for TUI input field"
  - "Auto-scroll to bottom on message send (resets manual scroll)"
  - "MacOS-style scroll acceleration for transcript mouse scroll"
  - "Per-message clipboard copy via Ctrl+Y keybinding"
affects: [40-input-status-bar-polish]

# Tech tracking
tech-stack:
  added: []
  patterns: ["OpenTUI PasteEvent handler for bracketed paste", "MacOSScrollAccel for mouse scroll", "OSC52 clipboard write for per-message copy"]

key-files:
  created: []
  modified:
    - "packages/cli/src/tui/app.ts"
    - "packages/cli/src/tui/keymap.ts"
    - "packages/cli/src/tui/layout.ts"

key-decisions:
  - "Ctrl+Y chosen for per-message copy (avoids conflict with Ctrl+C quit and Ctrl+Shift+C full transcript copy)"
  - "Copy targets last assistant message rather than focused message (simpler, covers primary use case)"
  - "Brief 'Copied to clipboard' status bar override with 2s auto-clear for copy feedback"

patterns-established:
  - "Keyboard-driven copy as alternative to native text selection when useMouse:true captures mouse events"
  - "Status bar temporary override pattern for transient feedback (copyFeedbackActive flag + timeout)"

requirements-completed: [VISUAL-12]

# Metrics
duration: 6min
completed: 2026-02-20
---

# Phase 39 Plan 04: Input/Scroll/Copy UX Fixes Summary

**Paste handler, scroll-to-bottom on send, MacOS scroll acceleration, and Ctrl+Y per-message clipboard copy for TUI**

## Performance

- **Duration:** 6 min
- **Started:** 2026-02-20T06:26:13Z
- **Completed:** 2026-02-20T06:32:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Bracketed paste (Ctrl+V) inserts text into the TUI input field via OpenTUI PasteEvent handler
- Sending a message resets transcript scroll to bottom via scrollTo(Infinity), re-engaging stickyScroll
- Mouse scroll in transcript uses MacOSScrollAccel for velocity-aware acceleration
- Ctrl+Y copies the last assistant message to clipboard via OSC52, with status bar feedback
- Status bar shows both "Ctrl+Shift+C copy all" and "Ctrl+Y copy msg" shortcuts

## Task Commits

Each task was committed atomically:

1. **Task 1+2: Paste, scroll, acceleration, per-message copy** - `68adb59` (feat)
   - Note: The app.ts and layout.ts changes were pre-applied by the 39-03 executor. This commit adds the missing keymap.ts wiring (action type, Ctrl+Y keybinding, applyKeyAction case) that makes the copy-last-message feature functional.

**Plan metadata:** (pending)

## Files Created/Modified
- `packages/cli/src/tui/app.ts` - Paste handler, scrollTo(Infinity) on send, MacOSScrollAccel, copyLastAssistantMessage(), copy feedback
- `packages/cli/src/tui/keymap.ts` - copy-last-message action type, Ctrl+Y keybinding, applyKeyAction case
- `packages/cli/src/tui/layout.ts` - Status bar hints: "Ctrl+Shift+C copy all", "Ctrl+Y copy msg"

## Decisions Made
- Ctrl+Y chosen for per-message copy to avoid conflicts with existing Ctrl+C (quit), Ctrl+Shift+C (copy all transcript)
- Copy targets last assistant message (reverse search) rather than requiring message focus tracking
- Brief "Copied to clipboard" feedback via status bar override with 2-second auto-clear timeout
- Newlines in pasted text are flattened to spaces for single-line input compatibility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added keymap wiring for copy-last-message action**
- **Found during:** Task 2 (Per-message copy)
- **Issue:** The plan specified adding the keybinding directly in app.ts handleKeypress, but the existing architecture uses a separate keymap module (keymap.ts) for all key-to-action mapping. The app.ts copyLastAssistantMessage method was already present (from 39-03) but unreachable without the keymap entry.
- **Fix:** Added copy-last-message to KeyAction type union, Ctrl+Y mapping in mapKeyToAction, and case in applyKeyAction
- **Files modified:** packages/cli/src/tui/keymap.ts
- **Verification:** Build succeeds, CLI tests pass (130/130)
- **Committed in:** 68adb59

**2. [Rule 3 - Blocking] Recognized pre-applied changes from 39-03 executor**
- **Found during:** Task 1 (Paste, scroll, acceleration)
- **Issue:** All Task 1 and most Task 2 changes were already committed by the 39-03 executor (commits d0ee19a and 034b530). Only the keymap.ts changes were missing.
- **Fix:** Verified existing code, committed only the missing keymap wiring
- **Files modified:** packages/cli/src/tui/keymap.ts
- **Verification:** git show confirmed all app.ts/layout.ts changes present in HEAD

---

**Total deviations:** 2 auto-fixed (2 blocking)
**Impact on plan:** Keymap wiring was essential for the feature to work. No scope creep. Pre-applied changes were verified rather than duplicated.

## Issues Encountered
- The 39-03 executor had pre-applied most of 39-04's changes alongside its own SyntaxStyle fixes. Only the keymap module updates were missed. This was detected by comparing git HEAD against planned changes.
- One pre-existing test failure (Phase 28 streaming smoke test) unrelated to these changes -- out of scope per deviation rules.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All four UAT-identified UX issues (paste, scroll-to-bottom, scroll speed, copy) are resolved
- Ready for Phase 40 (Input & Status Bar Polish)
- No blockers

## Self-Check: PASSED

- All created/modified files exist on disk
- Commit 68adb59 verified in git log
- Build succeeds, CLI tests 130/130 pass

---
*Phase: 39-transcript-message-rendering*
*Completed: 2026-02-20*
