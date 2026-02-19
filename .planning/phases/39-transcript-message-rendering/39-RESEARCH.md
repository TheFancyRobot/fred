# Phase 39: Transcript & Message Rendering - Research

**Researched:** 2026-02-19
**Domain:** OpenTUI transcript rendering, markdown, streaming accents, and tree connectors
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Message styling
- Assistant messages use a different background shade (surface level) to visually distinguish from user messages on base background
- User messages get an accent-colored left border to anchor them as "yours"
- No role labels (no "You" / "Assistant" text) -- rely on visual styling alone to distinguish speakers
- Assistant messages have NO left border -- background shade alone provides distinction
- Markdown in assistant responses is rendered (bold, italic, headers, bullet lists, code blocks)
- Code blocks inside assistant messages get a slightly elevated background (one step beyond assistant bg)
- Long messages always wrap to fill transcript width -- no truncation

#### Tool/task blocks
- Smart collapse default: collapsed when completed successfully, expanded when errored or still running
- Collapsed line shows: tool name + brief result summary (e.g., "search_web -- 3 results found")
- Full tree connectors: vertical `|` lines connect multiple tool blocks, `\` for the last one (file-tree style)
- Tool calls and task/subagent blocks use different visual styling to distinguish type (different border color or accent)
- Failed tool blocks use red/error accent color on tree connector or background
- In-progress tool calls show a spinning braille character animation
- Parallel tool calls from the same turn are grouped with count (e.g., "3 tools") -- expand to see each individually

#### Streaming treatment
- Streaming accent color: Claude's discretion (pick what works with the muted cool palette)
- Streaming cursor/indicator: Claude's discretion (pick what works in the TUI rendering context)
- Transition from streaming to complete: instant switch -- accent immediately changes to normal styling
- Auto-scroll always follows streaming content to the bottom

#### Message chrome
- No timestamps on messages
- Vertical gap only between consecutive messages (no horizontal rules or dividers)
- Thinking/reasoning blocks shown inline with heavy dimming/muting to de-emphasize
- Comfortable horizontal padding (2 characters) from transcript edges

### Claude's Discretion
- Accent color for user message left border (teal, warm, or other -- integrate with theme)
- Streaming accent color choice (orange/amber suggested in success criteria, but flexible)
- Streaming cursor/indicator style (blinking block, static, or none)
- Expanded tool block detail level (input + output vs output only)
- Task block visual differentiation from tool blocks (color, icon, or border approach)

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| VISUAL-12 | Assistant messages render with muted styling distinct from user messages | Theme tokens `bg.surface` for assistant vs `bg.base` for user; BoxRenderable background per message; user left-border via `border: ['left']` with accent color |
| VISUAL-13 | Tool calls and task results render as inline expandable blocks with tree connectors | TextRenderable tree connector glyphs; BoxRenderable with collapsible children; state-driven expand/collapse in `state.ts`; braille spinner for in-progress |
| VISUAL-14 | Active/streaming content uses a distinct accent color to indicate liveness | Theme `accent.streaming` token (`#d4a259` warm amber); MarkdownRenderable `streaming: true` mode; instant color swap on `finishStreaming` |
</phase_requirements>

## Summary

This phase transforms the transcript pane from plain text lines into a rich, styled message view. The current implementation in `layout.ts` renders transcript messages as flat `role:` + `content` strings, which are then mapped to `TextRenderable` children in `app.ts`. The new rendering needs per-message boxes with distinct backgrounds, markdown rendering for assistant content, collapsible tool/task blocks with tree connectors, and streaming accent coloring.

OpenTUI v0.1.77 (the version installed) provides all necessary primitives. The critical discovery is that `MarkdownRenderable` exists with built-in `streaming: true` mode, incremental parsing via `parseMarkdownIncremental`, and `SyntaxStyle` for code highlighting. `BoxRenderable` supports `border: ['left']` for single-side borders with `borderColor`, `backgroundColor`, and all Yoga layout properties. `TextRenderable` accepts `fg`, `bg`, and `attributes` (BOLD, DIM, ITALIC, etc.). The `ScrollBoxRenderable` has `stickyScroll` and `stickyStart: 'bottom'` for auto-scroll behavior.

The major architectural shift is moving from string-based rendering (`renderTranscriptContent` returning `lines[]`) to renderable-based rendering (building a tree of `BoxRenderable`/`MarkdownRenderable`/`TextRenderable` per message). This requires changes to `layout.ts` (new message renderable builders), `state.ts` (tool block expand/collapse state, streaming message tracking), and `app.ts` (replacing the `repopulateScrollBox` approach with a renderable tree synced to message state).

**Primary recommendation:** Replace the string-line transcript renderer with a per-message renderable builder that constructs `BoxRenderable` wrappers (with role-specific styling) containing `MarkdownRenderable` (for assistant content with streaming mode) or `TextRenderable` (for user messages), with collapsible tool block children using `TextRenderable` for tree connectors.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @opentui/core | v0.1.77 | TUI rendering, layout, markdown, keyboard | Project-standard TUI runtime |
| Bun | (repo standard) | Runtime | Monorepo standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @opentui/core MarkdownRenderable | v0.1.77 | Markdown rendering with streaming | Assistant message content |
| @opentui/core SyntaxStyle | v0.1.77 | Code block syntax highlighting | Code blocks inside assistant messages |
| @opentui/core BoxRenderable | v0.1.77 | Per-message container with bg/border | Message wrapper boxes |
| @opentui/core TextRenderable | v0.1.77 | Styled text for user messages, tool blocks, tree connectors | Non-markdown content |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| MarkdownRenderable | Manual markdown-to-ANSI parsing | MarkdownRenderable is built-in, handles streaming, code highlighting, and incremental updates |
| BoxRenderable left border | Unicode left-bar character | Border is cleaner, respects layout padding, and borderColor integrates with theme |

**Installation:**
```bash
# No new dependencies needed -- all capabilities already in @opentui/core v0.1.77
bun install
```

## Architecture Patterns

### Recommended Project Structure
```
packages/cli/src/tui/
  app.ts              # Renderable tree wiring, syncStateToUI changes
  layout.ts           # Message renderable builders (new), pane content
  state.ts            # Tool block expand/collapse state, streaming message tracking
  theme.ts            # Theme tokens (extend with message-specific tokens)
  streaming.ts        # No changes needed (already handles token batching)
  keymap.ts           # Toggle tool block expand/collapse action
```

### Pattern 1: Per-Message Renderable Builder
**What:** Replace flat `lines[]` transcript rendering with a function that builds a tree of renderables per message. Each message gets a `BoxRenderable` container with role-specific styling, containing either `MarkdownRenderable` (assistant) or `TextRenderable` (user).
**When to use:** All transcript content rendering.
**Example:**
```typescript
// Source: Codebase pattern + OpenTUI API (verified from .d.ts files)
function buildUserMessageRenderable(
  r: CliRenderer,
  theme: TuiTheme,
  content: string,
): BoxRenderable {
  const box = new BoxRenderable(r, {
    id: `msg-user-${id}`,
    flexDirection: 'column',
    backgroundColor: theme.bg.base,       // user messages on base background
    border: ['left'],                      // left border only
    borderColor: theme.accent.primary,     // teal accent for "yours"
    borderStyle: 'single',
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 0,
    paddingBottom: 0,
  });

  const text = new TextRenderable(r, {
    id: `msg-user-text-${id}`,
    content,
    fg: theme.fg.primary,
  });
  text.selectable = true;
  box.add(text);
  return box;
}
```

### Pattern 2: MarkdownRenderable for Assistant Content
**What:** Use OpenTUI's built-in `MarkdownRenderable` with `streaming: true` for assistant messages during streaming, switching to `streaming: false` on completion.
**When to use:** All assistant message content.
**Example:**
```typescript
// Source: @opentui/core MarkdownRenderable API (verified from Markdown.d.ts)
function buildAssistantMessageRenderable(
  r: CliRenderer,
  theme: TuiTheme,
  content: string,
  isStreaming: boolean,
): BoxRenderable {
  const box = new BoxRenderable(r, {
    id: `msg-assistant-${id}`,
    flexDirection: 'column',
    backgroundColor: theme.bg.surface,    // assistant on surface background
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 0,
    paddingBottom: 0,
    // NO border -- background shade alone provides distinction
  });

  const syntaxStyle = SyntaxStyle.create();
  const md = new MarkdownRenderable(r, {
    id: `msg-assistant-md-${id}`,
    content,
    syntaxStyle,
    streaming: isStreaming,
    conceal: false,
  });
  box.add(md);
  return box;
}
```

### Pattern 3: Tree Connector Text for Tool Blocks
**What:** Tool blocks within an assistant turn are rendered as `TextRenderable` lines with Unicode tree connector characters. Multiple tool blocks use vertical line `\u2502` for intermediate and corner `\u2514` for last.
**When to use:** Tool call and task result rendering.
**Example:**
```typescript
// Tree connector glyphs
const TREE_INTERMEDIATE = '\u2502';  // vertical line for intermediate items
const TREE_LAST = '\u2514';          // corner for last item
const TREE_HORIZONTAL = '\u2500';    // horizontal connector

// Collapsed tool line:  "  \u2502 search_web \u2014 3 results found"
// Last collapsed line:  "  \u2514 format_output \u2014 done"
```

### Pattern 4: Braille Spinner for In-Progress Tools
**What:** Use braille characters that rotate to indicate an in-progress tool call. Braille dot patterns cycle smoothly in monospace terminals.
**When to use:** Tool calls that have started but not yet completed.
**Example:**
```typescript
const BRAILLE_SPINNER_FRAMES = [
  '\u2807', '\u280B', '\u2819', '\u2838',
  '\u2830', '\u2834', '\u281C', '\u280E',
] as const;

// In-progress line: "  \u2502 \u2819 search_web..."
const frame = BRAILLE_SPINNER_FRAMES[
  Math.floor(nowMs / 80) % BRAILLE_SPINNER_FRAMES.length
];
```

### Pattern 5: Renderable Update vs Rebuild
**What:** For streaming, update the existing `MarkdownRenderable.content` property in place rather than rebuilding the entire renderable tree. MarkdownRenderable uses `parseMarkdownIncremental` internally, which reuses unchanged tokens.
**When to use:** During active streaming to minimize render cost.
**Example:**
```typescript
// On streaming batch:
// Find existing assistant message renderable and update content
const mdRenderable = existingAssistantBox.findDescendantById(`msg-assistant-md-${id}`);
if (mdRenderable instanceof MarkdownRenderable) {
  mdRenderable.content = newAccumulatedContent;
  // MarkdownRenderable handles incremental re-parse internally
}
```

### Anti-Patterns to Avoid
- **Rebuilding the entire transcript renderable tree on every streaming batch:** This will cause flicker and high CPU. Instead, update only the active streaming message's content in place.
- **Mixing string-line rendering with renderable-based rendering:** The transcript should fully migrate to renderable-based rendering. A hybrid approach creates two rendering paths that are hard to maintain.
- **Creating a new SyntaxStyle per render cycle:** `SyntaxStyle.create()` allocates native resources. Create one per theme and reuse it across all MarkdownRenderable instances.
- **Attempting to use `border: ['left']` on TextRenderable:** Only `BoxRenderable` supports borders. Wrap text in a BoxRenderable for border support.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Markdown rendering | Custom regex-based markdown parser | `MarkdownRenderable` from @opentui/core | Handles streaming, incremental parsing, code blocks, nested lists, tables |
| Syntax highlighting in code blocks | Custom syntax coloring | `SyntaxStyle` + tree-sitter integration in MarkdownRenderable | Already built into OpenTUI, handles dozens of languages |
| Auto-scroll to bottom | Manual scroll offset management | `ScrollBoxRenderable` with `stickyScroll: true` + `stickyStart: 'bottom'` | Built into OpenTUI, handles edge cases around manual scroll vs auto-scroll |
| Text wrapping | Custom line-break algorithm | OpenTUI Yoga flexbox engine | Layout engine handles wrapping natively with width constraints |
| Styled text composition | Manual ANSI escape sequences | `StyledText`, `vstyles`, `TextNodeRenderable` utilities | Type-safe text styling with composable helpers |

**Key insight:** OpenTUI already provides markdown rendering with streaming support, making the most complex part of this phase (streaming markdown with accent color) achievable through configuration rather than custom code.

## Common Pitfalls

### Pitfall 1: ScrollBox Content Height with Dynamic Renderables
**What goes wrong:** When replacing string lines with variable-height renderables (markdown with lists, code blocks), the scroll calculations can break because the total content height is no longer predictable from line count.
**Why it happens:** The current viewport math in `state.ts` (`countMessageLines`) counts `\n`-separated lines, which won't match the actual rendered height of MarkdownRenderable content.
**How to avoid:** Use `ScrollBoxRenderable` with `stickyScroll: true` and `stickyStart: 'bottom'` instead of manual scroll offset math. Let OpenTUI's Yoga layout engine compute actual heights. Remove or simplify the manual viewport state from `state.ts`.
**Warning signs:** Scroll position jumps when markdown content renders taller than expected; auto-scroll stops working.

### Pitfall 2: SyntaxStyle Resource Leak
**What goes wrong:** Creating `SyntaxStyle.create()` on every render cycle leaks native FFI resources (it allocates a Zig pointer).
**Why it happens:** SyntaxStyle uses native bindings via `bun:ffi` and the `destroy()` method must be called.
**How to avoid:** Create a single `SyntaxStyle` instance during TUI initialization (or per-theme) and pass it to all `MarkdownRenderable` constructors. Call `destroy()` when the TUI stops.
**Warning signs:** Memory growth during long sessions; eventual crash from FFI resource exhaustion.

### Pitfall 3: Renderable Tree Rebuild Thrash During Streaming
**What goes wrong:** If the entire transcript renderable tree is rebuilt on each streaming batch (every ~16ms), it causes visible flicker and high CPU.
**Why it happens:** The current pattern in `app.ts` calls `repopulateScrollBox` which destroys all children and re-creates them. This is fine for string lines but expensive for renderable trees with markdown parsing.
**How to avoid:** Track the "active streaming message" renderable by ID. On streaming batches, only update `MarkdownRenderable.content` on the active message. Only rebuild the full tree when messages are added or removed.
**Warning signs:** Flicker during streaming; high CPU; scroll position resets.

### Pitfall 4: Left Border Eating a Column of Content
**What goes wrong:** `BoxRenderable` with `border: ['left']` consumes 1 character width for the border, reducing inner content width by 1.
**Why it happens:** Yoga layout accounts for border in box sizing.
**How to avoid:** Account for the 1-character border in width calculations. User messages with left border will have slightly less content width than assistant messages without border. This is acceptable and even desirable (visually indents user messages slightly).
**Warning signs:** Content wrapping at different widths between user and assistant messages without clear reason.

### Pitfall 5: Streaming Accent Color Not Propagating to Markdown
**What goes wrong:** Setting `fg` on the parent `BoxRenderable` doesn't automatically change the `MarkdownRenderable` text color, because markdown rendering uses its own style stack.
**Why it happens:** MarkdownRenderable has internal style resolution via SyntaxStyle, which overrides parent fg.
**How to avoid:** For streaming accent, apply the accent color by setting a custom SyntaxStyle that uses the streaming accent for default text, then swap the SyntaxStyle on completion. Alternatively, use the parent box's `fg` and ensure the MarkdownRenderable respects inherited color (test this).
**Warning signs:** Streaming text appears in default color rather than accent color.

## Code Examples

Verified patterns from OpenTUI API types:

### Creating a BoxRenderable with Left Border Only
```typescript
// Source: @opentui/core BoxRenderable.d.ts + border.d.ts
const userBox = new BoxRenderable(renderer, {
  id: 'user-msg-0',
  flexDirection: 'column',
  backgroundColor: theme.bg.base,
  border: ['left'],           // BorderSides = 'left'
  borderStyle: 'single',      // thin line
  borderColor: theme.accent.primary,
  paddingLeft: 2,
  paddingRight: 2,
  marginBottom: 1,            // vertical gap between messages
});
```

### Creating a MarkdownRenderable with Streaming
```typescript
// Source: @opentui/core MarkdownRenderable.d.ts
import {
  MarkdownRenderable,
  SyntaxStyle,
  type CliRenderer,
} from '@opentui/core';

const syntaxStyle = SyntaxStyle.create();

const md = new MarkdownRenderable(renderer, {
  id: 'assistant-md-0',
  content: 'Hello **world**',
  syntaxStyle,
  streaming: true,    // keeps trailing tokens unstable for incomplete content
  conceal: false,     // don't hide markdown syntax
});

// Update content during streaming (incremental re-parse):
md.content = 'Hello **world**\n\nMore content...';

// Finalize:
md.streaming = false;
```

### Styled Text with TextNodeRenderable
```typescript
// Source: @opentui/core constructs.d.ts + styled-text.d.ts
import { vstyles, TextNodeRenderable } from '@opentui/core';

// Bold text node
const boldNode = vstyles.bold('Tool name');

// Colored text node
const dimNode = vstyles.dim('(3 results found)');

// Custom color
const errorNode = vstyles.color('#d97b7b', 'Error: timeout');

// Compose in a TextRenderable
const text = new TextRenderable(renderer, {
  id: 'tool-summary',
  content: '',
});
text.add(boldNode);
text.add(' \u2014 ');
text.add(dimNode);
```

### ScrollBox with Sticky Bottom Scroll
```typescript
// Source: @opentui/core ScrollBox.d.ts
const transcriptScroll = new ScrollBoxRenderable(renderer, {
  id: 'transcript-scroll',
  flexGrow: 1,
  stickyScroll: true,
  stickyStart: 'bottom',
  verticalScrollbarOptions: { visible: false },
  horizontalScrollbarOptions: { visible: false },
});
```

### Theme Extension for Message Tokens
```typescript
// Source: packages/cli/src/tui/theme.ts (extend existing)
export interface TuiTheme {
  // ... existing tokens ...
  message: {
    /** User message left border color */
    userBorder: string;
    /** Assistant message background (alias for bg.surface) */
    assistantBg: string;
    /** User message background (alias for bg.base) */
    userBg: string;
    /** Code block background (elevated above assistant bg) */
    codeBg: string;
    /** Tool block connector color */
    toolConnector: string;
    /** Task block accent (differentiated from tool) */
    taskAccent: string;
    /** Error accent for failed tools */
    errorAccent: string;
    /** Thinking block text color (heavily dimmed) */
    thinkingFg: string;
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| String-line transcript (`lines[]`) | Renderable-tree transcript | This phase | Per-message styling, markdown, collapsible blocks |
| Role labels (`user:` / `assistant:`) | Visual-only distinction (bg + border) | This phase | Cleaner, more modern chat UI aesthetic |
| No markdown rendering | MarkdownRenderable with streaming | This phase | Rich text in assistant responses |
| Flat tool call display | Collapsible tree-connected tool blocks | This phase | Space-efficient, progressive disclosure |

**Deprecated/outdated after this phase:**
- `renderTranscriptContent` returning `PaneContent` with `lines[]` for message display (replaced by renderable builder)
- `countMessageLines` in state.ts for scroll math (replaced by ScrollBox stickyScroll)
- `repopulateScrollBox` for transcript content (replaced by incremental renderable tree updates)
- Role label text like `user:` / `assistant:` in transcript output

## Discretion Recommendations

### User Message Left Border Color
**Recommendation:** Use `theme.accent.primary` (teal, `#5ec2c7`). This maintains visual consistency with the existing accent system. The teal left border on base background creates clear ownership without introducing a new color.

### Streaming Accent Color
**Recommendation:** Use the existing `theme.accent.streaming` token (`#d4a259`, warm amber/gold). This is already defined in the theme and provides excellent contrast against the cool-toned surface background. The warm-cool contrast makes it immediately obvious which content is "live."

### Streaming Cursor/Indicator
**Recommendation:** Use a pulsing block cursor character (`\u2588` full block) in the streaming accent color, appended to the end of the streaming content. This is the simplest approach that works within MarkdownRenderable's content model -- just append the character to the markdown content string during streaming and remove it on completion. No blinking needed (the content is changing rapidly enough to indicate liveness).

### Expanded Tool Block Detail Level
**Recommendation:** Show output only in expanded view. Tool inputs are often verbose JSON that adds noise without value for most users. The collapsed summary line already shows the tool name and result summary. If the user expands, they want to see what happened (the output), not what was requested (the input).

### Task Block Visual Differentiation
**Recommendation:** Use `theme.status.info` (blue, `#6fa6d9`) for task/subagent block tree connectors, versus `theme.fg.dim` (gray) for regular tool blocks. This provides subtle but clear visual distinction without introducing new accent colors. Task blocks represent a different abstraction level (an entire agent invocation vs a single function call).

## Open Questions

1. **How does MarkdownRenderable handle streaming accent color?**
   - What we know: MarkdownRenderable takes a `SyntaxStyle` and `fg` is inherited from parent. Setting `fg` on the parent BoxRenderable should propagate.
   - What's unclear: Whether MarkdownRenderable's internal style resolution overrides inherited fg for all text, or only for syntax-highlighted spans.
   - Recommendation: Test during implementation. If parent fg doesn't propagate, create two SyntaxStyle instances (one with streaming fg, one with normal fg) and swap on completion.

2. **Tool/task block data availability in TUI state**
   - What we know: The TUI currently receives only `token` events in the chat command wiring (line 256 of chat.ts). Tool call events (`tool-call`, `tool-result`, `tool-error`) exist in the streaming pipeline but are NOT forwarded to the TUI.
   - What's unclear: Whether to forward these events through the existing `pushAssistantToken` path or create a new event channel.
   - Recommendation: Add new methods to `FredTuiApp` (`pushToolCall`, `pushToolResult`, `pushToolError`) and wire them in `chat.ts` alongside `pushAssistantToken`. Store tool state in `TuiState` alongside messages.

3. **Thinking/reasoning block detection**
   - What we know: Some providers (Anthropic, OpenAI) include thinking/reasoning content in their responses, but the format varies by provider.
   - What's unclear: How thinking blocks appear in the current `token` event stream -- are they separate events, wrapped in tags, or mixed into regular content?
   - Recommendation: For initial implementation, detect `<thinking>` tags in content and render with heavy dimming. Refine detection per-provider as needed.

## Sources

### Primary (HIGH confidence)
- @opentui/core v0.1.77 type definitions -- MarkdownRenderable, BoxRenderable, TextRenderable, ScrollBoxRenderable, SyntaxStyle, TextAttributes, BorderSides (all verified from .d.ts files in node_modules)
- packages/cli/src/tui/app.ts -- Current transcript rendering architecture (read in full)
- packages/cli/src/tui/layout.ts -- Current `renderTranscriptContent` implementation (read in full)
- packages/cli/src/tui/state.ts -- Current TUI state model, SessionTranscript, viewport math (read in full)
- packages/cli/src/tui/theme.ts -- TuiTheme interface and DEFAULT_TUI_THEME tokens (read in full)
- packages/cli/src/tui/streaming.ts -- StreamingController architecture (read in full)
- packages/cli/src/commands/chat.ts -- TUI wiring to Fred streaming pipeline (read in full)
- packages/core/src/stream/events.ts -- StreamEvent types including tool-call, tool-result, tool-error (read in full)

### Secondary (MEDIUM confidence)
- Phase 38 research -- OpenTUI capabilities for sidebar (verified patterns still apply)
- Phase 37 context -- Theme system decisions (verified in theme.ts)

### Tertiary (LOW confidence)
- MarkdownRenderable streaming accent color propagation -- needs runtime verification during implementation

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- All capabilities verified from installed package type definitions
- Architecture: HIGH -- Current codebase thoroughly analyzed, migration path clear
- Pitfalls: HIGH -- Based on direct analysis of current code patterns and OpenTUI API constraints
- Discretion recommendations: MEDIUM -- Based on design judgment + theme token analysis, not runtime testing

**Research date:** 2026-02-19
**Valid until:** 2026-03-19 (stable -- @opentui/core version pinned, codebase patterns established)
