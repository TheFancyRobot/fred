---
phase: 38-sidebar-redesign-toggle
plan: 02
subsystem: ui
tags: [tui, opentui, sidebar, cli]

# Dependency graph
requires:
  - phase: 38-01
    provides: Sidebar visibility state, key bindings, and focus behavior
provides:
  - Sidebar metadata rendered only in footer without duplication
  - Sidebar layout spans window edges with zero outer padding
  - Collapsed sidebar spacing normalized across sections
  - Session switching reloads transcripts when available
  - Composer input accepts uppercase keystrokes with cursor indicator
affects: [tui-ux]

# Tech tracking
tech-stack:
  added: []
  patterns: ["Sidebar content split into header/body/footer regions", "Renderables rebuilt without reordering siblings"]

key-files:
  created: []
  modified:
    - packages/cli/src/tui/app.ts
    - packages/cli/src/tui/layout.ts
    - packages/cli/src/tui/keymap.ts
    - tests/unit/cli/tui-layout.test.ts
    - tests/unit/cli/tui-keymap.test.ts

key-decisions:
  - "Render metadata in a footer region to keep it bottom-aligned regardless of session list length"

patterns-established:
  - "Use sidebar footer renderable to anchor metadata at the bottom"

# Metrics
duration: 32 min
completed: 2026-02-19
---

# Phase 38 Plan 02: Sidebar Redesign Toggle Summary

**Sidebar metadata renders once in the footer with edge-to-edge layout, clean collapse spacing, reliable session switching, and a visible input cursor.**

## Performance

- **Duration:** 32 min
- **Started:** 2026-02-19T03:07:44Z
- **Completed:** 2026-02-19T06:26:08Z
- **Tasks:** 10
- **Files modified:** 7

## Accomplishments
- Removed duplicate metadata rendering when sessions are collapsed.
- Eliminated outer padding to keep the sidebar flush with window edges.
- Kept metadata anchored to the sidebar footer while preserving header ordering.
- Normalized collapsed spacing for sessions and metadata to remove misaligned gaps.
- Ensured full-height sidebar layout keeps metadata pinned to the bottom.
- Resolved session titles from metadata/preview snippets before loading transcripts.
- Restored transcript loading on session navigation and aligned composer width to transcript column.
- Fixed uppercase keystrokes in the input composer.
- Added a minimal cursor indicator to the input composer.

## Task Commits

Each task was committed atomically:

1. **Task 1: Render collapsible sessions + metadata sections in sidebar** - `4cbff3c` (feat)
2. **Task 2: Wire sidebar visibility + /sidebar command into app flow** - `d1cc837` (feat)
3. **Task 3: Keep Sessions header above Metadata** - `2ce724f` (fix)
4. **Task 4: Launch TUI from dev-chat when CLI installed** - `f0e87a8` (fix)
5. **Task 5: Normalize collapsed spacing in sidebar** - `cb53ebe` (fix)
6. **Task 6: Anchor sidebar metadata footer** - `fc295d3` (fix)
7. **Task 7: Align collapsed spacing and resolve titles** - `d123793` (fix)
8. **Task 8: Remove metadata duplication and flush layout** - `475776a` (fix)
9. **Task 9: Restore session switching and layout sizing** - `104a037` (fix)
10. **Task 10: Fix input uppercase typing** - `6304a16` (fix)
11. **Task 11: Restore input cursor indicator** - `2525156` (fix)

**Plan metadata:** `80ffefc` (docs, prior execution)

## Files Created/Modified
- `packages/cli/src/tui/layout.ts` - Keep metadata out of session lines and remove outer padding.
- `packages/cli/src/tui/app.ts` - Avoid rendering footer metadata in the scrollbox.
- `tests/unit/cli/tui-layout.test.ts` - Assert footer metadata and session-only lines.
- `packages/cli/src/tui/keymap.ts` - Preserve shifted character input in the composer.
- `tests/unit/cli/tui-keymap.test.ts` - Cover uppercase input events.

## Decisions Made
- Render metadata in a footer region so it stays bottom-aligned.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Collapsed sessions left uneven vertical gaps**
- **Found during:** Task 6 (Normalize collapsed spacing in sidebar)
- **Issue:** Session rows inserted blank lines, causing odd spacing when sections collapsed.
- **Fix:** Remove per-session blank lines and rely on a single separator between sections.
- **Files modified:** packages/cli/src/tui/layout.ts, tests/unit/cli/tui-layout.test.ts
- **Verification:** bun test tests/unit/cli/tui-layout.test.ts
- **Commit:** cb53ebe

**2. [Rule 1 - Bug] Metadata section floated mid-column instead of footer**
- **Found during:** Task 7 (Anchor sidebar metadata footer)
- **Issue:** Metadata lines lived in the same scrollbox as sessions, so short lists left them mid-sidebar.
- **Fix:** Split sidebar into header/body/footer renderables and anchor metadata footer at bottom.
- **Files modified:** packages/cli/src/tui/app.ts
- **Verification:** bun test tests/unit/cli/tui-app.test.ts
- **Commit:** fc295d3

**3. [Rule 1 - Bug] Session titles defaulted to (untitled) before load**
- **Found during:** Task 7 (Align collapsed spacing and resolve titles)
- **Issue:** Sidebar session rows showed (untitled) until a transcript load populated titles.
- **Fix:** Resolve title from session preview or first transcript snippet when available.
- **Files modified:** packages/cli/src/tui/layout.ts, tests/unit/cli/tui-layout.test.ts
- **Verification:** bun test tests/unit/cli/tui-layout.test.ts
- **Commit:** d123793

**4. [Rule 1 - Bug] Metadata duplicated in collapsed Sessions view**
- **Found during:** Task 8 (Remove metadata duplication and flush layout)
- **Issue:** Metadata lines rendered both in the sessions list and footer when Sessions collapsed.
- **Fix:** Stop injecting metadata into sidebar line list and keep it footer-only; update tests.
- **Files modified:** packages/cli/src/tui/layout.ts, packages/cli/src/tui/app.ts, tests/unit/cli/tui-layout.test.ts
- **Verification:** bun test tests/unit/cli/tui-layout.test.ts
- **Commit:** 475776a

**5. [Rule 1 - Bug] Sidebar gutters remained at window edges**
- **Found during:** Task 8 (Remove metadata duplication and flush layout)
- **Issue:** Outer padding introduced gutters between the sidebar and window edges.
- **Fix:** Set layout outer padding to 0 so the sidebar spans edge-to-edge.
- **Files modified:** packages/cli/src/tui/layout.ts
- **Verification:** bun test tests/unit/cli/tui-layout.test.ts
- **Commit:** 475776a

**6. [Rule 1 - Bug] Session switching stopped loading transcript messages**
- **Found during:** Task 9 (Restore session switching and layout sizing)
- **Issue:** After first session load, navigating to another session did not fetch transcript messages, leaving the transcript empty.
- **Fix:** Load transcript on session navigation when message counts indicate stored content.
- **Files modified:** packages/cli/src/tui/app.ts
- **Verification:** bun test tests/unit/cli/tui-app.test.ts
- **Commit:** 104a037

**7. [Rule 1 - Bug] Uppercase typing dropped in input**
- **Found during:** Task 10 (Fix input uppercase typing)
- **Issue:** Shifted characters arrived as lowercase names, so uppercase input never rendered.
- **Fix:** Use key sequences to preserve shifted characters with a fallback to uppercasing when Shift is held.
- **Files modified:** packages/cli/src/tui/keymap.ts, tests/unit/cli/tui-keymap.test.ts
- **Verification:** bun test tests/unit/cli/tui-keymap.test.ts
- **Commit:** 6304a16

**8. [Rule 1 - Bug] Input cursor indicator missing**
- **Found during:** Task 11 (Restore input cursor indicator)
- **Issue:** Composer rendered without a cursor marker, making input position unclear.
- **Fix:** Inject a minimal inline cursor glyph in focused input rendering (including placeholder).
- **Files modified:** packages/cli/src/tui/layout.ts, tests/unit/cli/tui-layout.test.ts
- **Verification:** bun test tests/unit/cli/tui-layout.test.ts
- **Commit:** 2525156

---

**Total deviations:** 8 auto-fixed (8 bug)
**Impact on plan:** All fixes required for correct sidebar layout, session switching, spacing, and input behavior. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
Pending human verification of sidebar changes, uppercase input handling, and cursor visibility.

---
*Phase: 38-sidebar-redesign-toggle*
*Completed: 2026-02-19*
