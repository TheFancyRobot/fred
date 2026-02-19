# Phase 39: Transcript & Message Rendering - Context

**Gathered:** 2026-02-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Polish transcript rendering with distinct user/assistant styling, inline expandable tool/task blocks with tree connectors, and streaming accent color. This phase covers how messages appear visually in the transcript pane. Creating new message types, changing message data structures, or adding new interaction capabilities are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Message styling
- Assistant messages use a different background shade (surface level) to visually distinguish from user messages on base background
- User messages get an accent-colored left border to anchor them as "yours"
- No role labels (no "You" / "Assistant" text) — rely on visual styling alone to distinguish speakers
- Assistant messages have NO left border — background shade alone provides distinction
- Markdown in assistant responses is rendered (bold, italic, headers, bullet lists, code blocks)
- Code blocks inside assistant messages get a slightly elevated background (one step beyond assistant bg)
- Long messages always wrap to fill transcript width — no truncation

### Tool/task blocks
- Smart collapse default: collapsed when completed successfully, expanded when errored or still running
- Collapsed line shows: tool name + brief result summary (e.g., "search_web — 3 results found")
- Full tree connectors: vertical `│` lines connect multiple tool blocks, `└` for the last one (file-tree style)
- Tool calls and task/subagent blocks use different visual styling to distinguish type (different border color or accent)
- Failed tool blocks use red/error accent color on tree connector or background
- In-progress tool calls show a spinning braille character animation
- Parallel tool calls from the same turn are grouped with count (e.g., "3 tools") — expand to see each individually

### Streaming treatment
- Streaming accent color: Claude's discretion (pick what works with the muted cool palette)
- Streaming cursor/indicator: Claude's discretion (pick what works in the TUI rendering context)
- Transition from streaming to complete: instant switch — accent immediately changes to normal styling
- Auto-scroll always follows streaming content to the bottom

### Message chrome
- No timestamps on messages
- Vertical gap only between consecutive messages (no horizontal rules or dividers)
- Thinking/reasoning blocks shown inline with heavy dimming/muting to de-emphasize
- Comfortable horizontal padding (2 characters) from transcript edges

### Claude's Discretion
- Accent color for user message left border (teal, warm, or other — integrate with theme)
- Streaming accent color choice (orange/amber suggested in success criteria, but flexible)
- Streaming cursor/indicator style (blinking block, static, or none)
- Expanded tool block detail level (input + output vs output only)
- Task block visual differentiation from tool blocks (color, icon, or border approach)

</decisions>

<specifics>
## Specific Ideas

- Tree connectors should look like a proper file tree: `│` for intermediate items, `└` for last item
- Grouped parallel tool calls collapse into a count for vertical space efficiency
- Thinking blocks are inline (not collapsed) but heavily muted — always visible but never distracting
- The borderless aesthetic continues from Phase 37 — contrast and spacing, no box-drawing borders on messages

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 39-transcript-message-rendering*
*Context gathered: 2026-02-19*
