---
phase: 39-transcript-message-rendering
plan: 01
subsystem: ui
tags: [opentui, markdown, tui, streaming, theme, renderable]

# Dependency graph
requires:
  - phase: 37-tui-visual-theming
    provides: centralized TuiTheme with fg/bg/accent/status tokens
  - phase: 38-sidebar-input-polish
    provides: borderless contrast layout, sidebar footer, focus cycle helpers
provides:
  - message-specific theme tokens (userBorder, assistantBg, codeBg, thinkingFg, streamingFg)
  - per-message renderable builder functions (buildUserMessageRenderable, buildAssistantMessageRenderable, buildThinkingRenderable)
  - renderable-based transcript rendering replacing string lines
  - incremental streaming MarkdownRenderable updates without tree rebuild
  - stickyScroll auto-scroll behavior for streaming content
affects: [39-02-PLAN, transcript-rendering, streaming-ui]

# Tech tracking
tech-stack:
  added: [MarkdownRenderable, SyntaxStyle]
  patterns: [per-message-renderable-builder, incremental-streaming-update, single-syntax-style-lifecycle]

key-files:
  created: []
  modified:
    - packages/cli/src/tui/theme.ts
    - packages/cli/src/tui/layout.ts
    - packages/cli/src/tui/app.ts

key-decisions:
  - "User messages get left-border teal accent on base bg, assistant messages get surface bg with MarkdownRenderable"
  - "Streaming content uses warm amber accent with block cursor, instant transition on completion"
  - "SyntaxStyle created once in constructor and destroyed in stop() to avoid FFI resource leaks"
  - "Incremental content update during streaming batches avoids full tree rebuild"
  - "Legacy renderTranscriptContent preserved for startup chooser and empty state"

patterns-established:
  - "Per-message renderable builder: layout.ts exports buildXxxRenderable functions that return BoxRenderable containers"
  - "Incremental streaming update: track activeStreamingMdId and update MarkdownRenderable.content in place"
  - "Message theme tokens: theme.message group provides semantic colors for transcript rendering"

requirements-completed: [VISUAL-12, VISUAL-14]

# Metrics
duration: 4min
completed: 2026-02-19
---

# Phase 39 Plan 01: Transcript Message Rendering Summary

**Per-message renderable transcript with user/assistant visual distinction, MarkdownRenderable for rich text, warm amber streaming accent, and stickyScroll auto-scroll**

## Performance

- **Duration:** 4 min
- **Started:** 2026-02-19T16:01:43Z
- **Completed:** 2026-02-19T16:06:08Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Extended TuiTheme with 9 message-specific semantic color tokens
- Built per-message renderable builder functions for user, assistant, and thinking messages
- Replaced flat string-line transcript rendering with per-message BoxRenderable containers
- Assistant messages rendered with MarkdownRenderable for rich text (bold, italic, headers, code blocks)
- Streaming content uses warm amber accent with block cursor, instant transition to normal on completion
- Incremental MarkdownRenderable content updates during streaming (no tree rebuild per batch)
- StickyScroll auto-scroll follows streaming content to bottom

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend theme with message tokens and create per-message renderable builders** - `4c6e2a7` (feat)
2. **Task 2: Wire renderable-based transcript in app.ts with streaming accent and auto-scroll** - `de21c83` (feat)

**Plan metadata:** (pending) (docs: complete plan)

## Files Created/Modified
- `packages/cli/src/tui/theme.ts` - Added message token group with 9 semantic colors (userBorder, userBg, assistantBg, codeBg, thinkingFg, streamingFg, toolConnector, taskAccent, errorAccent)
- `packages/cli/src/tui/layout.ts` - Added buildUserMessageRenderable, buildAssistantMessageRenderable, buildThinkingRenderable, buildStreamingCursorText, getTranscriptMessages
- `packages/cli/src/tui/app.ts` - Replaced string-line transcript with renderable builders, added SyntaxStyle lifecycle, stickyScroll, incremental streaming updates

## Decisions Made
- User messages use teal (#5ec2c7) left border matching accent.primary for visual anchoring
- Assistant messages use surface background with MarkdownRenderable for rich text rendering
- SyntaxStyle.create() called once in constructor, destroy() in stop() to manage FFI resources
- Thinking blocks detected by `<thinking>` tag prefix and rendered with heavy dimming (DIM | ITALIC)
- Legacy renderTranscriptContent kept for startup chooser and empty state paths
- Block cursor character (unicode full block) appended during streaming, removed on completion

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Transcript renders per-message renderables with distinct user/assistant styling
- MarkdownRenderable provides rich text for assistant messages
- Ready for Plan 02 (tool blocks, task blocks, tree connectors)
- Theme message tokens include toolConnector, taskAccent, errorAccent ready for Plan 02

## Self-Check: PASSED

All files exist, all commits verified.

---
*Phase: 39-transcript-message-rendering*
*Completed: 2026-02-19*
