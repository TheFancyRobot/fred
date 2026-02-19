---
phase: 39-transcript-message-rendering
plan: 02
subsystem: ui
tags: [opentui, tui, tool-blocks, tree-connectors, spinner, renderable, streaming]

# Dependency graph
requires:
  - phase: 39-transcript-message-rendering
    plan: 01
    provides: per-message renderable builders, message theme tokens (toolConnector, taskAccent, errorAccent), MarkdownRenderable for assistant messages
provides:
  - ToolBlockState interface and tool block tracking in TuiState
  - Tool block renderable builders with tree connectors (buildToolBlockRenderable, buildToolGroupRenderable)
  - Tool event methods on FredTuiApp (pushToolCall, pushToolResult, pushToolError)
  - Tool event forwarding from chat.ts stream loop to TUI state
  - Braille spinner animation for in-progress tools
  - Smart collapse behavior (completed -> collapsed, errored -> expanded)
affects: [transcript-rendering, streaming-ui, tool-visualization]

# Tech tracking
tech-stack:
  added: []
  patterns: [tool-block-state-model, tree-connector-rendering, spinner-interval-animation, tool-event-forwarding]

key-files:
  created: []
  modified:
    - packages/cli/src/tui/state.ts
    - packages/cli/src/tui/layout.ts
    - packages/cli/src/tui/app.ts
    - packages/cli/src/commands/chat.ts

key-decisions:
  - "Tool blocks indexed by group position, correlated with assistant message index in transcript"
  - "Braille spinner driven by 80ms setInterval that auto-stops when no in-progress blocks remain"
  - "Parallel completed tools collapse to 'N tools' summary instead of individual lines"
  - "Tool kind inferred from name prefix: task_, subagent_, handoff_ -> task kind, otherwise tool kind"
  - "Expanded detail for errored blocks shows error message; for completed shows truncated JSON output"

patterns-established:
  - "Tool event forwarding: chat.ts stream loop dispatches tool-call/result/error events to TUI app methods"
  - "Tool block state: pure functions (addToolCall, completeToolCall, failToolCall) produce immutable state updates"
  - "Tree connector rendering: buildToolBlockRenderable produces BoxRenderable rows with connector + summary text"
  - "Spinner lifecycle: interval started on first pushToolCall, stopped when no in-progress blocks remain or stream ends"

requirements-completed: [VISUAL-13]

# Metrics
duration: 5min
completed: 2026-02-19
---

# Phase 39 Plan 02: Tool Block Rendering Summary

**Inline tool call blocks with tree connectors, braille spinner for in-progress, smart collapse/expand, and tool/task kind distinction via connector color**

## Performance

- **Duration:** 5 min
- **Started:** 2026-02-19T16:09:20Z
- **Completed:** 2026-02-19T16:14:01Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Added ToolBlockState/ToolBlockGroup state model with in-progress/completed/errored status tracking
- Built pure state functions for tool block lifecycle (add, complete, fail, toggle, clear)
- Created tree connector rendering with vertical pipe for intermediate and corner for last tool
- Braille spinner animation (8 frames, 80ms interval) for in-progress tool blocks
- Smart collapse: completed tools auto-collapse to single line, errored tools stay expanded
- Parallel tool calls from same turn grouped with "N tools" summary when all collapsed
- Tool vs task blocks distinguished by connector color (gray vs blue)
- Errored blocks use red accent for both connector and summary text
- Full tool event forwarding pipeline from Fred stream through chat.ts to TUI state to renderables

## Task Commits

Each task was committed atomically:

1. **Task 1: Add tool block state model and event forwarding** - `2cb9794` (feat)
2. **Task 2: Render tool blocks with tree connectors and expand/collapse** - `93d5eef` (feat)

## Files Created/Modified
- `packages/cli/src/tui/state.ts` - Added ToolBlockState, ToolBlockGroup types, toolBlocks field on TuiState, pure state functions (addToolCall, completeToolCall, failToolCall, toggleToolBlockExpand, getToolBlocksForMessage, hasInProgressToolBlocks, clearToolBlocks)
- `packages/cli/src/tui/layout.ts` - Added tree connector constants, braille spinner frames, buildToolBlockRenderable, buildToolGroupRenderable, getToolBlockSummary, formatExpandedOutput
- `packages/cli/src/tui/app.ts` - Added pushToolCall/pushToolResult/pushToolError public methods, spinner interval start/stop, tool group rendering in syncTranscriptToUI after assistant messages
- `packages/cli/src/commands/chat.ts` - Added tool-call, tool-result, tool-error event handlers in streaming loop forwarding to TUI app

## Decisions Made
- Tool blocks indexed by group position and correlated with assistant message index during transcript rendering
- Braille spinner uses 80ms interval (matching plan spec) with auto-stop when no in-progress blocks
- Parallel completed tools show "N tools" count summary to reduce visual noise
- Tool kind inferred from name prefix heuristic (task_/subagent_/handoff_ -> task, otherwise tool)
- Manual expand/toggle deferred to future enhancement -- smart defaults handle common cases

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tool blocks render inline after assistant messages with tree connectors
- Full tool event pipeline operational from Fred streaming through to visual display
- Phase 39 (transcript message rendering) is now complete
- Ready for phase 40 or any future tool visualization enhancements

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 39-transcript-message-rendering*
*Completed: 2026-02-19*
