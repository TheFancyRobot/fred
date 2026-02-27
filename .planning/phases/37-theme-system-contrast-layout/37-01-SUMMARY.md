---
phase: 37-theme-system-contrast-layout
plan: 01
subsystem: ui
tags: [tui, theme, opentui, color-tokens, borderless-layout]

# Dependency graph
requires: []
provides:
  - TuiTheme interface with semantic fg/bg/accent/status token groups
  - DEFAULT_TUI_THEME constant with muted cool palette
  - Borderless contrast-based region separation in TUI layout
  - All app.ts color references wired to theme tokens (zero inline hex)
affects: [38-sidebar-redesign, 39-transcript-rendering, 40-input-status-bar]

# Tech tracking
tech-stack:
  added: []
  patterns: [centralized-theme-tokens, contrast-based-regions, semantic-color-groups]

key-files:
  created:
    - packages/cli/src/tui/theme.ts
  modified:
    - packages/cli/src/tui/app.ts
    - packages/cli/src/tui/layout.ts

key-decisions:
  - "Muted cool palette with 3-step background contrast: base (#121417) → surface (#181c21) → elevated (#1f252b)"
  - "Teal primary accent (#5ec2c7) for selected items, focused titles, and role labels"
  - "Selected sidebar items use accent.primary + bold to distinguish from unselected"

patterns-established:
  - "Theme token consumption: all color values in app.ts reference DEFAULT_TUI_THEME.<group>.<token>"
  - "Region separation: backgroundColor on BoxRenderable + padding + gap replaces borderStyle"
  - "Selection highlighting: ▸ marker lines get accent.primary fg + TextAttributes.BOLD"

# Metrics
duration: ~25min
completed: 2026-02-17
---

# Phase 37-01: Theme System & Contrast Layout Summary

**Centralized TuiTheme with semantic color tokens and borderless contrast-based region separation using 3-step background shading**

## Performance

- **Duration:** ~25 min (across sessions)
- **Tasks:** 3 (2 auto + 1 human checkpoint with fix)
- **Files modified:** 3

## Accomplishments
- Created `TuiTheme` interface with 4 semantic groups (fg, bg, accent, status) and `DEFAULT_TUI_THEME` constant
- Removed all box-drawing borders and inline hex colors from `app.ts`; wired every color to theme tokens
- Added `outerPadding` and `regionGap` layout constants for borderless spacing
- Fixed selected sidebar items to use accent color (checkpoint feedback fix)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add centralized TUI theme module** - `433fed5` (feat)
2. **Task 2: Apply theme + borderless contrast layout** - `b9904eb` (feat)
3. **Task 3: Fix accent on selected items** - `0c28ae9` (fix — checkpoint feedback)

## Files Created/Modified
- `packages/cli/src/tui/theme.ts` - New: TuiTheme interface + DEFAULT_TUI_THEME palette definition
- `packages/cli/src/tui/app.ts` - Modified: all colors wired to theme tokens, borders removed, selected items use accent
- `packages/cli/src/tui/layout.ts` - Modified: added outerPadding and regionGap constants

## Decisions Made
- Used suggested palette from plan with no adjustments — contrast steps visually confirmed adequate
- Selected items (▸ marker) and command palette selections get accent.primary + bold treatment
- Transcript role labels ("user:", "assistant:") always use accent.primary regardless of focus state

## Deviations from Plan

### Auto-fixed Issues

**1. [Checkpoint Feedback] Selected sidebar items not using accent color**
- **Found during:** Task 3 (human checkpoint)
- **Issue:** User reported "selected text does not use accent" — sidebar items used fg.primary for all items when focused
- **Fix:** Added selection detection (▸ and > markers) to sidebar item rendering; selected items now get accent.primary + bold
- **Files modified:** packages/cli/src/tui/app.ts
- **Verification:** Visual confirmation pending; tests pass (15/15)
- **Committed in:** 0c28ae9

---

**Total deviations:** 1 checkpoint fix
**Impact on plan:** Minor fix to meet the "selection/emphasis uses accent" design decision from 37-CONTEXT.md. No scope creep.

## Issues Encountered
None beyond the checkpoint feedback.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Theme system is in place; all future phases (38, 39, 40) can import from `./theme.ts`
- Pattern established: consume `DEFAULT_TUI_THEME` tokens, never use inline hex in app.ts
- Phase 38 (Sidebar Redesign) can build on the existing sidebar styling patterns

---
*Phase: 37-theme-system-contrast-layout*
*Completed: 2026-02-17*
