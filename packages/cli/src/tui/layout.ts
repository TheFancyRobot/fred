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
} from '@opentui/core';
import type { TuiTheme } from './theme.js';
import type { TuiState } from './state.js';

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
    'Ctrl+Shift+C copy',
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
    conceal: false,
  });
  md.selectable = true;

  if (options.streaming) {
    md.fg = theme.message.streamingFg;
  }

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
