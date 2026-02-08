/**
 * TUI layout content providers
 *
 * Provides content data for each pane. Actual layout and rendering
 * is handled by OpenTUI's Yoga flexbox engine in app.ts.
 */

import type { TuiState } from './state.js';

const STREAM_SPINNER_FRAMES = ['-', '\\', '/', '*'] as const;

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

export interface TranscriptPaneContent extends PaneContent {
  totalLines: number;
  scrollOffset: number;
  pinnedToBottom: boolean;
}

export interface InputPaneContent extends PaneContent {
  height: number;
}

function formatComposerLines(text: string, maxVisibleLines: number): string[] {
  const lines = text.split('\n');
  const visible = lines.slice(Math.max(0, lines.length - maxVisibleLines));
  return visible.map((line, index) => `${index === 0 ? '> ' : '  '}${line}`);
}

export function renderInputContent(
  state: TuiState,
  focused: boolean,
  placeholder: InputPlaceholder,
): InputPaneContent {
  const hasInput = state.input.text.length > 0;
  const composerLines = hasInput
    ? formatComposerLines(state.input.text, DEFAULT_LAYOUT.inputMaxVisibleLines)
    : [`> ${placeholder}`];
  const lines = composerLines;

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
export function renderSidebarContent(state: TuiState, focused: boolean): PaneContent {
  if (state.commandPalette.isOpen) {
    const paletteLines = state.commandPalette.filteredActions.length > 0
      ? state.commandPalette.filteredActions.map((action, index) => {
        const marker = index === state.commandPalette.selectedIndex ? '>' : ' ';
        const group = action.group === 'global' ? 'global' : action.group;
        return `${marker} ${action.label} [${group}]`;
      })
      : ['(no matching actions)'];

    return {
      lines: [
        '[Command Palette]',
        `Search: ${state.commandPalette.query || '(type to filter)'}`,
        '',
        ...paletteLines,
      ],
      focusIndicator: focused ? '>' : undefined,
    };
  }

  const sidebarWidth = DEFAULT_LAYOUT.sidebarWidth;
  const maxLineLength = Math.max(10, sidebarWidth - 4);
  const newSessionLine = '+ New Session';

  const items = state.sessions.items;
  const selectedId = state.sessions.selectedId;
  const selectedItem = selectedId ? items.find((item) => item.id === selectedId) : null;
  const rest = items.filter((item) => item.id !== selectedId);
  const ordered = selectedItem ? [selectedItem, ...rest] : rest;

  const formatUpdatedTime = (date: Date): string => date.toISOString().slice(11, 16);
  const truncate = (value: string): string => value.length > maxLineLength
    ? `${value.slice(0, Math.max(0, maxLineLength - 1)).trimEnd()}…`
    : value;

  const sessionLines = ordered.length > 0
    ? ordered.flatMap((item) => {
        const isSelected = item.id === selectedId;
        const marker = isSelected ? '▸' : ' ';
        const unread = item.unread ? ' •' : '';
        const title = item.title ?? '(untitled)';
        const agentName = item.agent?.name ?? item.agent?.id ?? 'default';
        const updated = formatUpdatedTime(item.updatedAt);
        const meta = `${updated} · ${agentName} · ${item.messageCount} msg`;
        const preview = item.preview ?? '(no messages)';

        return [
          truncate(`${marker} ${title}${unread}`),
          truncate(`  ${meta}`),
          truncate(`  ${preview}`),
          '',
        ];
      })
    : ['(empty)'];

  const lines = ['[Sessions]', newSessionLine, '', ...sessionLines];

  return {
    lines,
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

  if (messages.length === 0) {
    return {
      lines: ['', 'Fred AI Framework', '', 'Type a message to begin...'],
      focusIndicator: focused ? '>' : undefined,
      totalLines: 4,
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
 * Startup hint displayed before entering full shell
 */
export const STARTUP_HINT = 'Starting Fred chat... Press Tab to cycle focus, Esc to quit.';
