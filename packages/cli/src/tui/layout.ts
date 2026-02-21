/**
 * TUI layout content providers
 *
 * Provides content data for each pane. Actual layout and rendering
 * is handled by OpenTUI's Yoga flexbox engine in app.ts.
 */

import {
  BoxRenderable,
  TextRenderable,
  MarkdownRenderable,
  TextAttributes,
  type CliRenderer,
  type SyntaxStyle,
  type RenderNodeContext,
} from '@opentui/core';
import type { Token } from 'marked';
import type { TuiTheme } from './theme.js';
import type { TuiState, ToolBlockState } from './state.js';

const STREAM_SPINNER_FRAMES = ['-', '\\', '/', '*'] as const;
const INPUT_CURSOR_INDICATOR = '▍';

interface StatusRenderOptions {
  maxWidth?: number;
  nowMs?: number;
}

function formatUsd(value: number): string {
  return `$${value.toFixed(4)}`;
}

function formatLatency(latencyMs: number | null): string {
  if (latencyMs === null) {
    return 'lat n/a';
  }
  return `lat ${Math.round(latencyMs)}ms`;
}

function formatRate(tokensPerSecond: number): string {
  if (!Number.isFinite(tokensPerSecond) || tokensPerSecond <= 0) {
    return '0 tok/s';
  }
  return `${tokensPerSecond.toFixed(1)} tok/s`;
}

function trimStatusSegments(segments: string[], maxWidth: number): string {
  let active = [...segments];
  while (active.length > 1 && active.join(' | ').length > maxWidth) {
    active.splice(active.length - 2, 1);
  }
  const joined = active.join(' | ');
  if (joined.length <= maxWidth) {
    return joined;
  }
  return joined.slice(0, Math.max(0, maxWidth - 3)).trimEnd() + '...';
}

/**
 * Default layout configuration
 */
export const DEFAULT_LAYOUT = {
  sidebarWidth: 30,
  inputHeight: 3,
  inputMaxHeight: 6,
  inputMaxVisibleLines: 4,
  statusHeight: 1,
  outerPadding: 0,
  regionGap: 1,
};

export const INPUT_PLACEHOLDERS = [
  'Type a message...',
  'Say something...',
  'Ask anything...',
  "What's on your mind?",
  'How can I help?',
] as const;

export type InputPlaceholder = (typeof INPUT_PLACEHOLDERS)[number];

export function selectInputPlaceholder(random = Math.random): InputPlaceholder {
  const index = Math.floor(random() * INPUT_PLACEHOLDERS.length) % INPUT_PLACEHOLDERS.length;
  return INPUT_PLACEHOLDERS[index];
}

/**
 * Render content for a pane (framework-agnostic content model)
 */
export interface PaneContent {
  lines: string[];
  focusIndicator?: string;
}

export interface SidebarContent extends PaneContent {
  sessionsHeader: string;
  sessionsLines: string[];
  metadataHeader: string;
  metadataLines: string[];
}

export interface TranscriptPaneContent extends PaneContent {
  totalLines: number;
  scrollOffset: number;
  pinnedToBottom: boolean;
}

export interface InputPaneContent extends PaneContent {
  height: number;
}

function formatComposerLines(text: string, maxVisibleLines: number, cursorPosition: number, focused: boolean): string[] {
  const lines = text.split('\n');
  const startIndex = Math.max(0, lines.length - maxVisibleLines);
  const visible = lines.slice(startIndex);
  const cursorLocation = focused ? getCursorLocation(text, cursorPosition) : null;

  return visible.map((line, index) => {
    const prefix = index === 0 ? '> ' : '  ';
    const lineIndex = startIndex + index;
    if (!cursorLocation || cursorLocation.line !== lineIndex) {
      return `${prefix}${line}`;
    }

    const clampedCol = Math.max(0, Math.min(line.length, cursorLocation.column));
    const withCursor = `${line.slice(0, clampedCol)}${INPUT_CURSOR_INDICATOR}${line.slice(clampedCol)}`;
    return `${prefix}${withCursor}`;
  });
}

function getCursorLocation(text: string, cursorPosition: number): { line: number; column: number } {
  const bounded = Math.max(0, Math.min(text.length, cursorPosition));
  const beforeCursor = text.slice(0, bounded).split('\n');
  const line = Math.max(0, beforeCursor.length - 1);
  const column = beforeCursor[beforeCursor.length - 1]?.length ?? 0;
  return { line, column };
}

export function renderInputContent(
  state: TuiState,
  focused: boolean,
  placeholder: InputPlaceholder,
): InputPaneContent {
  const hasInput = state.input.text.length > 0;
  const composerLines = hasInput
    ? formatComposerLines(
        state.input.text,
        DEFAULT_LAYOUT.inputMaxVisibleLines,
        state.input.cursorPosition,
        focused,
      )
    : [`> ${focused ? `${INPUT_CURSOR_INDICATOR}${placeholder}` : placeholder}`];
  const slashHint = state.input.slashSearch.isActive
    ? state.input.slashSearch.filteredActions[state.input.slashSearch.selectedIndex]?.plugin
    : null;
  const slashHintLine = slashHint
    ? `  hint: ${slashHint.usageHint}${slashHint.hasCollision ? ` [collision with ${slashHint.collisionWith.join(', ')}]` : ''}`
    : state.input.slashSearch.isActive
      ? '  hint: no matching slash commands'
      : null;
  const lines = slashHintLine ? [...composerLines, slashHintLine] : composerLines;

  const desiredHeight = Math.max(
    DEFAULT_LAYOUT.inputHeight,
    Math.min(DEFAULT_LAYOUT.inputMaxHeight, lines.length + 2),
  );

  return {
    lines,
    height: desiredHeight,
    focusIndicator: focused ? '>' : undefined,
  };
}

/**
 * Generate sidebar content
 */
export function renderSidebarContent(state: TuiState, focused: boolean): SidebarContent {
  if (state.deleteConfirm.isOpen) {
    const title = state.deleteConfirm.title ?? '(untitled)';
    const lines = [
      '[Delete Session]',
      '',
      'Are you sure you want to delete:',
      `"${title}"`,
      '',
      'Enter/Y: delete',
      'Esc/N: cancel',
    ];
    return {
      lines,
      sessionsHeader: lines[0] ?? '[Delete Session]',
      sessionsLines: lines.slice(1),
      metadataHeader: '',
      metadataLines: [],
      focusIndicator: focused ? '>' : undefined,
    };
  }

  if (state.commandPalette.isOpen) {
    const paletteLines = state.commandPalette.filteredActions.length > 0
      ? state.commandPalette.filteredActions.map((action, index) => {
        const marker = index === state.commandPalette.selectedIndex ? '>' : ' ';
        const group = action.group === 'global' ? 'global' : action.group;
        return `${marker} ${action.label} [${group}]`;
      })
      : ['(no matching actions)'];

    const lines = [
      '[Command Palette]',
      `Search: ${state.commandPalette.query || '(type to filter)'}`,
      '',
      ...paletteLines,
    ];
    return {
      lines,
      sessionsHeader: lines[0] ?? '[Command Palette]',
      sessionsLines: lines.slice(1),
      metadataHeader: '',
      metadataLines: [],
      focusIndicator: focused ? '>' : undefined,
    };
  }

  const sidebarWidth = DEFAULT_LAYOUT.sidebarWidth;
  const maxLineLength = Math.max(10, sidebarWidth - 4);
  const newSessionLine = '+ New Session (Enter)';
  const newSessionSelected = state.sidebar.hasNewSessionAction && state.sidebar.selectedIndex === 0;
  const newSessionLineDisplay = newSessionSelected
    ? `▸ ${newSessionLine}`
    : `  ${newSessionLine}`;
  const sessionsCollapsed = state.sidebar.sections.sessionsCollapsed;
  const metadataCollapsed = state.sidebar.sections.metadataCollapsed;
  const sessionsHeader = `${sessionsCollapsed ? '▶' : '▼'} Sessions`;
  const metadataHeader = `${metadataCollapsed ? '▶' : '▼'} Metadata`;

  const items = state.sessions.items;
  const selectedSessionIndex = state.sidebar.hasNewSessionAction
    ? state.sidebar.selectedIndex - 1
    : state.sidebar.selectedIndex;

  const formatUpdatedTime = (date: Date): string => date.toISOString().slice(11, 16);
  const truncate = (value: string): string => value.length > maxLineLength
    ? `${value.slice(0, Math.max(0, maxLineLength - 1)).trimEnd()}…`
    : value;
  const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();
  const resolveSessionTitle = (item: (typeof items)[number]): string => {
    const directTitle = item.title ? normalizeWhitespace(item.title) : '';
    if (directTitle) {
      return directTitle;
    }

    const previewTitle = item.preview ? normalizeWhitespace(item.preview) : '';
    if (previewTitle) {
      return previewTitle;
    }

    const transcript = state.sessions.transcripts[item.id];
    if (transcript?.messages?.length) {
      const firstUser = transcript.messages.find((message) => message.role === 'user');
      const firstMessage = firstUser ?? transcript.messages[0];
      if (firstMessage) {
        const snippet = normalizeWhitespace(firstMessage.content);
        if (snippet) {
          return snippet;
        }
      }
    }

    return '(untitled)';
  };

  const renderEmptySessionsLine = (): string => {
    return sessionsCollapsed || metadataCollapsed ? '(empty)' : '  (empty)';
  };

  const sessionLines = items.length > 0
    ? items.flatMap((item, index) => {
        const isSelected = index === selectedSessionIndex;
        const marker = isSelected ? '▸' : ' ';
        const title = resolveSessionTitle(item);
        const updated = formatUpdatedTime(item.updatedAt);

        return [
          truncate(`${marker} ${title}`),
          truncate(`  ${updated}`),
        ];
      })
    : [truncate(renderEmptySessionsLine())];

  const outputTokenCount = state.telemetry.outputTokenCount + state.streaming.outputTokenCount;
  const metadataLinesRaw = [
    `Sessions: ${items.length}`,
    `Model: ${state.telemetry.model || '--'}`,
    `Tokens: in ${state.telemetry.inputTokenCount} / out ${outputTokenCount}`,
  ].map(truncate);

  const sessionsLines = sessionsCollapsed ? [] : [newSessionLineDisplay, ...sessionLines];
  const metadataLines = metadataCollapsed ? [] : metadataLinesRaw;

  const lines = [sessionsHeader];
  if (!sessionsCollapsed) {
    lines.push(...sessionsLines);
  }

  return {
    lines,
    sessionsHeader,
    sessionsLines,
    metadataHeader,
    metadataLines,
    focusIndicator: focused ? '>' : undefined,
  };
}

/**
 * Generate transcript content
 */
interface TranscriptRenderOptions {
  maxWidth?: number;
}

function wrapLine(line: string, maxWidth: number): string[] {
  if (maxWidth <= 0) {
    return [line];
  }

  if (line.length <= maxWidth) {
    return [line];
  }

  const wrapped: string[] = [];
  let remaining = line;
  while (remaining.length > maxWidth) {
    wrapped.push(remaining.slice(0, maxWidth));
    remaining = remaining.slice(maxWidth);
  }
  wrapped.push(remaining);
  return wrapped;
}

export function renderTranscriptContent(
  state: TuiState,
  focused: boolean,
  options: TranscriptRenderOptions = {},
): TranscriptPaneContent {
  const { messages, viewport } = state.transcript;
  const maxWidth = options.maxWidth;

  if (state.startup.chooser.isOpen) {
    const resumeMarker = state.startup.chooser.selected === 'resume-last-session' ? '>>' : '  ';
    const startNewMarker = state.startup.chooser.selected === 'start-new-session' ? '>>' : '  ';
    const lines = [
      '[Startup: selection required]',
      ...(state.startup.warning ? [`warning: ${state.startup.warning}`] : []),
      '',
      `${resumeMarker} Resume previous session`,
      `${startNewMarker} Start new session`,
      '',
      'Use Up/Down to choose, Enter to continue',
    ];

    return {
      lines,
      focusIndicator: focused ? '>' : undefined,
      totalLines: lines.length,
      scrollOffset: 0,
      pinnedToBottom: true,
    };
  }

  if (messages.length === 0) {
    const lines = [
      '',
      'Fred AI Framework',
      '',
      ...(state.startup.warning ? [`Startup warning: ${state.startup.warning}`] : []),
      'Type a message to begin...',
    ];

    return {
      lines,
      focusIndicator: focused ? '>' : undefined,
      totalLines: lines.length,
      scrollOffset: 0,
      pinnedToBottom: true,
    };
  }

  // Build line model with explicit wrapping so viewport math matches rendered content.
  const lines = messages.flatMap((msg) => {
    const contentLines = msg.content.split('\n').flatMap((line) => {
      if (typeof maxWidth === 'number' && maxWidth > 0) {
        return wrapLine(line, maxWidth);
      }
      return [line];
    });

    return [
      `${msg.role}:`,
      ...contentLines,
      '',
    ];
  });

  const totalLines = lines.length;
  const visibleLinesCount = Math.max(1, viewport.visibleLines);
  const maxOffset = Math.max(0, totalLines - visibleLinesCount);
  const normalizedOffset = viewport.pinnedToBottom
    ? maxOffset
    : Math.max(0, Math.min(viewport.scrollOffset, maxOffset));
  const pinnedToBottom = normalizedOffset >= maxOffset;

  const visibleLines = lines.slice(
    normalizedOffset,
    normalizedOffset + visibleLinesCount,
  );

  return {
    lines: visibleLines,
    focusIndicator: focused ? '>' : undefined,
    totalLines,
    scrollOffset: normalizedOffset,
    pinnedToBottom,
  };
}

/**
 * Generate status bar content
 */
export function renderStatusContent(state: TuiState, options: StatusRenderOptions = {}): PaneContent {
  const nowMs = options.nowMs ?? Date.now();
  const maxWidth = options.maxWidth ?? 120;
  const spinner = STREAM_SPINNER_FRAMES[Math.floor(nowMs / 100) % STREAM_SPINNER_FRAMES.length];

  const streamSegment = state.streaming.isStreaming
    ? `${spinner} streaming`
    : state.streaming.lastError
      ? `error: ${state.streaming.lastError}`
      : null;

  const totalOutput = state.telemetry.outputTokenCount + state.streaming.outputTokenCount;
  const totalTokens = state.telemetry.inputTokenCount + totalOutput;
  const telemetrySegments = [`Focus: ${state.focusedPane}`];
  if (streamSegment) {
    telemetrySegments.push(streamSegment);
  }

  telemetrySegments.push(
    `tok total:${totalTokens}`,
    formatRate(state.streaming.tokensPerSecond),
    formatLatency(state.streaming.firstTokenLatencyMs),
    `in:${state.telemetry.inputTokenCount} out:${totalOutput}`,
    `mdl ${state.telemetry.model}`,
    `cost ${formatUsd(state.telemetry.sessionCostUsd)}`,
    'Mouse wheel scroll',
    'PgUp/PgDn scroll',
    'Tab: cycle focus',
    'Ctrl+Shift+C copy all',
    'Ctrl+Y copy msg',
    'Ctrl/Cmd+K palette',
    'Esc: quit',
  );

  const statusText = trimStatusSegments(telemetrySegments, maxWidth);

  return {
    lines: [statusText],
  };
}

/**
 * Block cursor character appended to streaming content
 */
export function buildStreamingCursorText(): string {
  return '\u2588';
}

/**
 * Get transcript messages for the current session
 */
export function getTranscriptMessages(state: TuiState): Array<{ role: string; content: string }> {
  return state.transcript.messages;
}

/**
 * Build a renderable for a user message
 */
export function buildUserMessageRenderable(
  renderer: CliRenderer,
  theme: TuiTheme,
  content: string,
  id: string,
): BoxRenderable {
  const container = new BoxRenderable(renderer, {
    id: `msg-user-${id}`,
    flexDirection: 'column',
    backgroundColor: theme.message.userBg,
    border: ['left'],
    borderStyle: 'single',
    borderColor: theme.message.userBorder,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 0,
    paddingBottom: 0,
    marginBottom: 1,
  });

  const text = new TextRenderable(renderer, {
    id: `msg-user-text-${id}`,
    content,
    fg: theme.fg.primary,
  });
  text.selectable = true;

  container.add(text);
  return container;
}

/**
 * Build a renderable for a heading token with structural treatment.
 * Background band + UPPERCASE + teal color + bold for visual hierarchy.
 */
function buildHeadingRenderable(
  renderer: CliRenderer,
  theme: TuiTheme,
  token: Token & { type: 'heading'; text: string; depth: number },
  id: string,
): BoxRenderable {
  const container = new BoxRenderable(renderer, {
    id: `heading-${id}`,
    flexDirection: 'column',
    backgroundColor: theme.message.headingBg,
    paddingLeft: 1,
    paddingRight: 1,
    paddingTop: 0,
    paddingBottom: 0,
    marginTop: 1,
    marginBottom: 1,
  });

  const headingText = new TextRenderable(renderer, {
    id: `heading-text-${id}`,
    content: token.text.toUpperCase(),
    fg: theme.message.headingFg,
    attributes: TextAttributes.BOLD,
  });
  headingText.selectable = true;

  container.add(headingText);
  return container;
}

/**
 * Build a renderable for an assistant message with markdown rendering
 */
export function buildAssistantMessageRenderable(
  renderer: CliRenderer,
  theme: TuiTheme,
  content: string,
  id: string,
  options: { streaming: boolean; syntaxStyle: SyntaxStyle },
): BoxRenderable {
  const container = new BoxRenderable(renderer, {
    id: `msg-assistant-${id}`,
    flexDirection: 'column',
    backgroundColor: theme.message.assistantBg,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 0,
    paddingBottom: 0,
    marginBottom: 1,
  });

  const md = new MarkdownRenderable(renderer, {
    id: `msg-assistant-md-${id}`,
    content,
    syntaxStyle: options.syntaxStyle,
    streaming: options.streaming,
    conceal: true,
    renderNode: (token: Token, _context: RenderNodeContext) => {
      if (token.type === 'heading') {
        return buildHeadingRenderable(
          renderer,
          theme,
          token as Token & { type: 'heading'; text: string; depth: number },
          `${id}-h-${(token as any).depth}`,
        );
      }
      return undefined;
    },
  });
  md.selectable = true;

  container.add(md);
  return container;
}

/**
 * Build a renderable for a thinking/reasoning block
 */
export function buildThinkingRenderable(
  renderer: CliRenderer,
  theme: TuiTheme,
  content: string,
  id: string,
): BoxRenderable {
  const container = new BoxRenderable(renderer, {
    id: `msg-thinking-${id}`,
    flexDirection: 'column',
    backgroundColor: theme.message.assistantBg,
    paddingLeft: 2,
    paddingRight: 2,
    marginBottom: 1,
  });

  const text = new TextRenderable(renderer, {
    id: `msg-thinking-text-${id}`,
    content,
    fg: theme.message.thinkingFg,
    attributes: TextAttributes.DIM | TextAttributes.ITALIC,
  });
  text.selectable = false;

  container.add(text);
  return container;
}

// ---------------------------------------------------------------------------
// Tool block rendering with tree connectors
// ---------------------------------------------------------------------------

const TREE_INTERMEDIATE = '\u2502'; // | vertical line
const TREE_LAST = '\u2514';        // corner
const TREE_HORIZONTAL = '\u2500';   // horizontal

const BRAILLE_SPINNER_FRAMES = [
  '\u2807', '\u280B', '\u2819', '\u2838',
  '\u2830', '\u2834', '\u281C', '\u280E',
] as const;

/**
 * Generate a brief summary string from tool output.
 * Truncates to ~60 chars for collapsed display.
 */
export function getToolBlockSummary(output: unknown): string {
  if (output === undefined || output === null) {
    return 'done';
  }

  if (typeof output === 'string') {
    if (output.length === 0) return 'done';
    return output.length <= 60 ? output : `${output.slice(0, 57)}...`;
  }

  if (Array.isArray(output)) {
    return `${output.length} item${output.length === 1 ? '' : 's'}`;
  }

  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (typeof obj.length === 'number') return `${obj.length} items`;
    if (typeof obj.count === 'number') return `${obj.count} items`;
  }

  const str = JSON.stringify(output);
  return str.length <= 60 ? str : `${str.slice(0, 57)}...`;
}

/**
 * Build a renderable for a single tool block with tree connector.
 *
 * @param renderer - CLI renderer
 * @param theme - TUI theme
 * @param block - Tool block state
 * @param isLast - Whether this is the last block in the group
 * @param id - Unique id suffix for renderables
 * @param nowMs - Current time for spinner frame calculation
 */
export function buildToolBlockRenderable(
  renderer: CliRenderer,
  theme: TuiTheme,
  block: ToolBlockState,
  isLast: boolean,
  id: string,
  nowMs: number,
): BoxRenderable {
  // Determine connector color based on kind and status
  let connectorColor: string;
  if (block.status === 'errored') {
    connectorColor = theme.message.errorAccent;
  } else if (block.kind === 'task') {
    connectorColor = theme.message.taskAccent;
  } else {
    connectorColor = theme.message.toolConnector;
  }

  const connectorChar = isLast
    ? `${TREE_LAST}${TREE_HORIZONTAL} `
    : `${TREE_INTERMEDIATE}${TREE_HORIZONTAL} `;

  const container = new BoxRenderable(renderer, {
    id: `tool-block-${id}`,
    flexDirection: 'column',
    paddingLeft: 2,
    paddingRight: 2,
  });

  // Row: connector + summary
  const row = new BoxRenderable(renderer, {
    id: `tool-block-row-${id}`,
    flexDirection: 'row',
  });

  const connector = new TextRenderable(renderer, {
    id: `tool-connector-${id}`,
    content: connectorChar,
    fg: connectorColor,
  });
  connector.selectable = false;
  row.add(connector);

  // Build summary text based on status
  let summaryContent: string;
  let summaryFg: string;
  let summaryAttributes = 0;

  if (block.status === 'in-progress') {
    const frameIndex = Math.floor(nowMs / 80) % BRAILLE_SPINNER_FRAMES.length;
    const spinner = BRAILLE_SPINNER_FRAMES[frameIndex];
    summaryContent = `${spinner} ${block.toolName}...`;
    summaryFg = theme.fg.secondary;
  } else if (block.status === 'errored') {
    const errorMsg = block.error?.message ?? 'unknown error';
    summaryContent = `${block.toolName} \u2014 error: ${errorMsg}`;
    summaryFg = theme.message.errorAccent;
  } else {
    // Completed
    const brief = getToolBlockSummary(block.output);
    summaryContent = `${block.toolName} \u2014 ${brief}`;
    summaryFg = theme.fg.dim;
  }

  const summary = new TextRenderable(renderer, {
    id: `tool-summary-${id}`,
    content: summaryContent,
    fg: summaryFg,
    attributes: summaryAttributes,
  });
  summary.selectable = false;
  row.add(summary);
  container.add(row);

  // Expanded detail: show full output for non-in-progress blocks
  if (block.expanded && block.status !== 'in-progress') {
    const detailContent = block.status === 'errored'
      ? (block.error?.message ?? 'unknown error')
      : formatExpandedOutput(block.output);

    if (detailContent) {
      // Indentation to align with content after connector
      const detailRow = new BoxRenderable(renderer, {
        id: `tool-detail-row-${id}`,
        flexDirection: 'row',
        paddingLeft: 2,
      });

      // Spacing to align under the summary text (connector width)
      const indent = new TextRenderable(renderer, {
        id: `tool-detail-indent-${id}`,
        content: isLast ? '   ' : `${TREE_INTERMEDIATE}  `,
        fg: connectorColor,
      });
      indent.selectable = false;
      detailRow.add(indent);

      const detail = new TextRenderable(renderer, {
        id: `tool-detail-${id}`,
        content: detailContent,
        fg: theme.fg.dim,
        attributes: TextAttributes.DIM,
      });
      detail.selectable = false;
      detailRow.add(detail);
      container.add(detailRow);
    }
  }

  return container;
}

/**
 * Format expanded output for display (truncated JSON).
 */
function formatExpandedOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') {
    return output.length <= 200 ? output : `${output.slice(0, 197)}...`;
  }
  const str = JSON.stringify(output, null, 2);
  return str.length <= 200 ? str : `${str.slice(0, 197)}...`;
}

/**
 * Build a renderable for a group of tool blocks from the same message turn.
 *
 * If all blocks are completed and collapsed, shows a summary count line.
 * Otherwise renders each block individually with tree connectors.
 *
 * @param renderer - CLI renderer
 * @param theme - TUI theme
 * @param blocks - Array of tool block states
 * @param id - Unique id suffix
 * @param nowMs - Current time for spinner frame calculation
 * @returns BoxRenderable or null if no blocks
 */
export function buildToolGroupRenderable(
  renderer: CliRenderer,
  theme: TuiTheme,
  blocks: ToolBlockState[],
  id: string,
  nowMs: number,
): BoxRenderable | null {
  if (blocks.length === 0) return null;

  const container = new BoxRenderable(renderer, {
    id: `tool-group-${id}`,
    flexDirection: 'column',
    marginBottom: 1,
  });

  // Parallel tool calls from same turn: if all collapsed and completed, show summary
  const allCollapsed = blocks.every((b) => !b.expanded && b.status === 'completed');
  if (blocks.length > 1 && allCollapsed) {
    const countText = new TextRenderable(renderer, {
      id: `tool-group-count-${id}`,
      content: `  ${blocks.length} tools`,
      fg: theme.fg.dim,
    });
    countText.selectable = false;
    container.add(countText);
    return container;
  }

  // Render each block individually
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const isLast = i === blocks.length - 1;
    const blockRenderable = buildToolBlockRenderable(
      renderer,
      theme,
      block,
      isLast,
      `${id}-${i}`,
      nowMs,
    );
    container.add(blockRenderable);
  }

  return container;
}
