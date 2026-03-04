/**
 * TUI layout content providers
 *
 * Provides content data for each pane. Actual layout and rendering
 * is handled by OpenTUI's Yoga flexbox engine in app.ts.
 */

import {
  BoxRenderable,
  TextRenderable,
  CodeRenderable,
  TextAttributes,
  RGBA,
  type CliRenderer,
  type SyntaxStyle,
} from '@opentui/core';
import type { TuiTheme } from './theme.js';
import type { TuiState, ToolBlockState } from './state.js';

const INPUT_CURSOR_INDICATOR = '█';
const INPUT_ACCENT_GLYPH = '▎';

const SUMMARY_CHAR_LIMIT = 60;
const DETAIL_CHAR_LIMIT = 200;
const MAX_SERIALIZE_DEPTH = 4;
const MAX_SERIALIZE_ITEMS = 20;
const MAX_SERIALIZE_NODES = 120;

/**
 * Strip terminal control sequences before rendering untrusted content.
 * Keeps newlines/tabs/carriage returns so layout remains readable.
 */
export function sanitizeForTerminalDisplay(text: string): string {
  return text
    // OSC (e.g. OSC52), DCS/PM/APC payloads, CSI, and simple ESC sequences.
    // eslint-disable-next-line no-control-regex
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b[P^_][\s\S]*?\x1b\\/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x9b[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    // Strip remaining C0/C1 controls except tab/newline/carriage-return.
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

function truncateText(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, Math.max(0, maxChars - 3))}...`;
}

function toBoundedSerializable(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
  nodeState: { count: number } = { count: 0 },
): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (typeof value === 'function') {
    return '[Function]';
  }

  if (typeof value !== 'object') {
    return String(value);
  }

  if (seen.has(value)) {
    return '[Circular]';
  }

  if (nodeState.count >= MAX_SERIALIZE_NODES) {
    return '[Truncated: node limit]';
  }
  nodeState.count += 1;

  if (depth >= MAX_SERIALIZE_DEPTH) {
    return '[Truncated: depth limit]';
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const preview = value
      .slice(0, MAX_SERIALIZE_ITEMS)
      .map((entry) => toBoundedSerializable(entry, depth + 1, seen, nodeState));
    if (value.length > MAX_SERIALIZE_ITEMS) {
      preview.push(`[+${value.length - MAX_SERIALIZE_ITEMS} more]`);
    }
    return preview;
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const limited = entries.slice(0, MAX_SERIALIZE_ITEMS);
  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of limited) {
    output[key] = toBoundedSerializable(entryValue, depth + 1, seen, nodeState);
  }
  if (entries.length > MAX_SERIALIZE_ITEMS) {
    output.__truncatedKeys = entries.length - MAX_SERIALIZE_ITEMS;
  }
  return output;
}

function stringifyOutputForDisplay(output: unknown, maxChars: number): string {
  try {
    const bounded = toBoundedSerializable(output);
    const json = JSON.stringify(bounded, null, 2);
    return truncateText(sanitizeForTerminalDisplay(json), maxChars);
  } catch {
    return '[output unavailable]';
  }
}

interface StatusRenderOptions {
  maxWidth?: number;
  /** When true, badges render with dimmed colors (overlay/modal is open) */
  dim?: boolean;
}

/**
 * Badge definition for status bar shortcut display
 */
interface StatusBadge {
  /** Display text (e.g., "? Help", "Esc Quit") */
  text: string;
  /** Priority: higher = kept longer during truncation. Core badges have priority 100 */
  priority: number;
}

/**
 * Build status bar badge content from TUI state.
 *
 * Core badges (always shown):
 * - ? Help
 * - Esc Quit
 * - Ctrl+B Sidebar
 *
 * Context badges (shown when relevant):
 * - Sidebar focused: j/k nav, Enter select, Del delete
 * - Transcript focused: PgUp/PgDn scroll, Ctrl+Y copy
 * - Input focused with slash search: Tab complete
 */
export function buildStatusBadges(state: TuiState): StatusBadge[] {
  const badges: StatusBadge[] = [];

  // Core badges - highest priority, always shown
  badges.push({ text: '? Help', priority: 100 });
  badges.push({ text: 'Esc Quit', priority: 100 });
  badges.push({ text: 'Ctrl+B Sidebar', priority: 100 });

  // Context-specific badges based on focused pane
  if (state.focusedPane === 'sidebar') {
    badges.push({ text: 'j/k nav', priority: 50 });
    badges.push({ text: 'Enter select', priority: 50 });
    if (state.sessions.selectedId) {
      badges.push({ text: 'Del delete', priority: 40 });
    }
  } else if (state.focusedPane === 'transcript') {
    badges.push({ text: 'PgUp/PgDn scroll', priority: 50 });
    // Show copy badge when there are messages to copy
    if (state.transcript.messages.length > 0) {
      badges.push({ text: 'Ctrl+Y copy', priority: 45 });
    }
  } else if (state.focusedPane === 'input') {
    // Show slash search hint when active
    if (state.input.slashSearch.isActive) {
      badges.push({ text: 'Tab complete', priority: 60 });
    }
    // Show palette shortcut when not in slash mode
    if (!state.input.slashSearch.isActive) {
      badges.push({ text: 'Ctrl+K palette', priority: 55 });
    }
  }

  return badges;
}

/**
 * Join badges with truncation that preserves high-priority badges.
 * Drops lowest-priority badges first until content fits maxWidth.
 */
function joinBadgesWithTruncation(badges: StatusBadge[], maxWidth: number): string {
  // Sort by priority (descending) for truncation decisions
  const sorted = [...badges].sort((a, b) => b.priority - a.priority);

  // Try including all badges first
  let active = [...badges];
  const fullText = active.map((b) => b.text).join('  ');

  if (fullText.length <= maxWidth) {
    return fullText;
  }

  // Need to truncate - drop lowest priority badges
  // Always keep priority 100 (core badges)
  const coreBadges = badges.filter((b) => b.priority === 100);
  const contextBadges = badges.filter((b) => b.priority < 100).sort((a, b) => a.priority - b.priority);

  // Start with core badges, add context badges from highest to lowest priority
  active = [...coreBadges];
  const sortedContext = [...contextBadges].sort((a, b) => b.priority - a.priority);

  for (const badge of sortedContext) {
    const candidate = [...active, badge];
    const candidateText = candidate.map((b) => b.text).join('  ');
    if (candidateText.length <= maxWidth) {
      active = candidate;
    } else {
      // Can't fit this badge, stop adding more
      break;
    }
  }

  let result = active.map((b) => b.text).join('  ');

  // Final truncation with ellipsis if still too long (shouldn't happen with core badges)
  if (result.length > maxWidth) {
    result = result.slice(0, Math.max(0, maxWidth - 3)).trimEnd() + '...';
  }

  return result;
}

/**
 * Default layout configuration
 */
export const DEFAULT_LAYOUT = {
  sidebarWidth: 30,
  inputHeight: 3,
  inputMaxHeight: 7,
  inputMaxVisibleLines: 5,
  statusHeight: 1,
  outerPadding: 0,
  regionGap: 0,
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

function formatComposerLines(text: string, maxVisibleLines: number, cursorPosition: number, focused: boolean, cursorVisible: boolean, availableWidth?: number): string[] {
  const logicalLines = text.split('\n');
  const cursorLocation = focused ? getCursorLocation(text, cursorPosition) : null;

  // Prefix is 2 chars ("▎ " or "  "), so content area is availableWidth - 2
  const wrapWidth = typeof availableWidth === 'number' && availableWidth > 4
    ? availableWidth - 2
    : 0; // 0 means no wrapping

  // Build visual lines with mapping back to logical coordinates.
  // Each visual line tracks: { logicalLine, logicalColStart, text }
  interface VisualLine {
    logicalLine: number;
    logicalColStart: number;
    text: string;
    isFirstLogical: boolean; // true for the first visual line of the first logical line
  }

  const visualLines: VisualLine[] = [];

  for (let li = 0; li < logicalLines.length; li++) {
    const line = logicalLines[li];
    const segments = wrapWidth > 0 ? wrapLine(line, wrapWidth) : [line];
    let colOffset = 0;
    for (let si = 0; si < segments.length; si++) {
      visualLines.push({
        logicalLine: li,
        logicalColStart: colOffset,
        text: segments[si],
        isFirstLogical: li === 0 && si === 0,
      });
      // +1 accounts for the space that was the word boundary (not perfectly accurate for
      // char-broken words, but close enough for cursor positioning since we re-derive below)
      colOffset += segments[si].length;
      // For word-wrapped segments the split consumed a space between words; however the
      // first segment starts at 0 and subsequent ones start right after the previous text.
      // We do NOT add +1 here because wordWrapLine preserves the exact characters.
    }
  }

  // Viewport: show the last maxVisibleLines visual lines
  const startIndex = Math.max(0, visualLines.length - maxVisibleLines);
  const visible = visualLines.slice(startIndex);

  // Map logical cursor to visual line + column
  let visualCursorLine: number | null = null;
  let visualCursorCol: number | null = null;

  if (cursorLocation) {
    // Find which visual line contains the cursor
    for (let vi = visualLines.length - 1; vi >= 0; vi--) {
      const vl = visualLines[vi];
      if (vl.logicalLine === cursorLocation.line
        && cursorLocation.column >= vl.logicalColStart
        && cursorLocation.column <= vl.logicalColStart + vl.text.length) {
        visualCursorLine = vi;
        visualCursorCol = cursorLocation.column - vl.logicalColStart;
        break;
      }
    }
    // Fallback: cursor at end of last visual line of its logical line
    if (visualCursorLine === null) {
      for (let vi = visualLines.length - 1; vi >= 0; vi--) {
        if (visualLines[vi].logicalLine === cursorLocation.line) {
          visualCursorLine = vi;
          visualCursorCol = visualLines[vi].text.length;
          break;
        }
      }
    }
  }

  return visible.map((vl, index) => {
    const absoluteIndex = startIndex + index;
    const finalPrefix = absoluteIndex === 0 || (startIndex > 0 && index === 0 && vl.isFirstLogical)
      ? `${INPUT_ACCENT_GLYPH} `
      : '  ';

    if (visualCursorLine === null || absoluteIndex !== visualCursorLine) {
      return `${finalPrefix}${vl.text}`;
    }

    const clampedCol = Math.max(0, Math.min(vl.text.length, visualCursorCol ?? 0));
    const cursorChar = cursorVisible ? INPUT_CURSOR_INDICATOR : ' ';
    const withCursor = `${vl.text.slice(0, clampedCol)}${cursorChar}${vl.text.slice(clampedCol)}`;
    return `${finalPrefix}${withCursor}`;
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
  cursorVisible: boolean = true,
  availableWidth?: number,
): InputPaneContent {
  const hasInput = state.input.text.length > 0;
  const showCursor = focused && cursorVisible;
  const composerLines = hasInput
    ? formatComposerLines(
        state.input.text,
        DEFAULT_LAYOUT.inputMaxVisibleLines,
        state.input.cursorPosition,
        focused,
        cursorVisible,
        availableWidth,
      )
    : [`${INPUT_ACCENT_GLYPH} ${focused ? `${showCursor ? INPUT_CURSOR_INDICATOR : ' '}${placeholder}` : placeholder}`];
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
    const safeContent = sanitizeForTerminalDisplay(msg.content);
    const contentLines = safeContent.split('\n').flatMap((line) => {
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
 * Status bar content with dimming metadata
 */
export interface StatusPaneContent extends PaneContent {
  /** Whether badges should render dimmed (overlay/modal is active) */
  dim: boolean;
}

/**
 * Generate status bar content
 */
export function renderStatusContent(state: TuiState, options: StatusRenderOptions = {}): StatusPaneContent {
  const maxWidth = options.maxWidth ?? 120;
  const dim = options.dim ?? false;

  // Build badge-based status line (no telemetry)
  const badges = buildStatusBadges(state);
  const statusText = joinBadgesWithTruncation(badges, maxWidth);

  return {
    lines: [statusText],
    dim,
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
  options?: { spinner?: boolean; nowMs?: number },
): BoxRenderable {
  const safeContent = sanitizeForTerminalDisplay(content);

  const container = new BoxRenderable(renderer, {
    id: `msg-user-${id}`,
    flexDirection: 'column',
    backgroundColor: theme.message.userBg,
    border: ['left'],
    borderStyle: 'single',
    borderColor: theme.message.userBorder,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    marginBottom: 1,
  });

  const text = new TextRenderable(renderer, {
    id: `msg-user-text-${id}`,
    content: safeContent,
    fg: theme.fg.primary,
  });
  text.selectable = true;
  container.add(text);

  // Thinking spinner — absolutely positioned at top-right of message container.
  // Uses a BoxRenderable wrapper because only BoxRenderable supports position: 'absolute'.
  if (options?.spinner) {
    const spinnerBox = new BoxRenderable(renderer, {
      id: `${THINKING_SPINNER_ID_PREFIX}box-${id}`,
      position: 'absolute',
      top: 1,
      right: 1,
    });
    const spinnerText = new TextRenderable(renderer, {
      id: `${THINKING_SPINNER_ID_PREFIX}${id}`,
      content: getSpinnerFrame(options.nowMs ?? Date.now()),
      fg: theme.accent.primary,
      attributes: TextAttributes.BOLD,
    });
    spinnerText.selectable = false;
    spinnerBox.add(spinnerText);
    container.add(spinnerBox);
  }

  return container;
}

/**
 * Build a renderable for a transient system notice (e.g. hot reload warning).
 */
export function buildSystemNoticeRenderable(
  renderer: CliRenderer,
  theme: TuiTheme,
  content: string,
  id: string,
): BoxRenderable {
  const safeContent = sanitizeForTerminalDisplay(content);

  const container = new BoxRenderable(renderer, {
    id: `msg-notice-${id}`,
    flexDirection: 'column',
    border: ['left'],
    borderStyle: 'single',
    borderColor: theme.status.warn,
    paddingLeft: 2,
    paddingRight: 2,
    paddingTop: 1,
    paddingBottom: 1,
    marginBottom: 1,
  });

  const text = new TextRenderable(renderer, {
    id: `msg-notice-text-${id}`,
    content: safeContent,
    fg: theme.status.warn,
  });
  text.selectable = true;
  container.add(text);

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
  const safeContent = sanitizeForTerminalDisplay(content);
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

  const md = new CodeRenderable(renderer, {
    id: `msg-assistant-md-${id}`,
    content: safeContent,
    filetype: 'markdown',
    syntaxStyle: options.syntaxStyle,
    streaming: options.streaming,
    conceal: true,
    drawUnstyledText: false,
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
  const safeContent = sanitizeForTerminalDisplay(content);
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
    content: safeContent,
    fg: theme.message.thinkingFg,
    attributes: TextAttributes.DIM | TextAttributes.ITALIC,
  });
  text.selectable = false;

  container.add(text);
  return container;
}

// ---------------------------------------------------------------------------
// Thinking indicator — braille spinner at top-right of user message
// ---------------------------------------------------------------------------

/** ID prefix for the thinking spinner TextRenderable */
export const THINKING_SPINNER_ID_PREFIX = 'thinking-spinner-';

/** Full-cell braille spinner frames — 8 frames using 7/8 dots with one gap rotating */
const SPINNER_FRAMES = ['\u28FE', '\u28FD', '\u28FB', '\u28BF', '\u287F', '\u28DF', '\u28EF', '\u28F7'];
// Visually: ⣾ ⣽ ⣻ ⢿ ⡿ ⣟ ⣯ ⣷

/**
 * Get the current spinner frame character for the given timestamp.
 * Cycles through 8 full-cell braille frames at 80ms per frame (640ms full cycle).
 */
export function getSpinnerFrame(nowMs: number): string {
  const frameIndex = Math.floor(nowMs / 80) % SPINNER_FRAMES.length;
  return SPINNER_FRAMES[frameIndex];
}

/**
 * Linearly interpolate between two RGBA colors.
 */
export function lerpColor(a: RGBA, b: RGBA, t: number): RGBA {
  return RGBA.fromValues(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t,
    a.a + (b.a - a.a) * t,
  );
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
    const safe = sanitizeForTerminalDisplay(output);
    if (safe.length === 0) return 'done';
    return truncateText(safe, SUMMARY_CHAR_LIMIT);
  }

  if (Array.isArray(output)) {
    return `${output.length} item${output.length === 1 ? '' : 's'}`;
  }

  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (typeof obj.length === 'number') return `${obj.length} items`;
    if (typeof obj.count === 'number') return `${obj.count} items`;
    const keyCount = Object.keys(obj).length;
    return keyCount === 0 ? 'object' : `${keyCount} field${keyCount === 1 ? '' : 's'}`;
  }

  return truncateText(sanitizeForTerminalDisplay(String(output)), SUMMARY_CHAR_LIMIT);
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
    summaryContent = `${block.toolName} — error`;
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
      ? 'An error occurred while executing this tool.'
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
    return truncateText(sanitizeForTerminalDisplay(output), DETAIL_CHAR_LIMIT);
  }

  return stringifyOutputForDisplay(output, DETAIL_CHAR_LIMIT);
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
