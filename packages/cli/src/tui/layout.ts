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
  const affordance = ' [Enter send | Shift+Enter newline | Ctrl+U clear]';
  const lines = [
    `${composerLines[0]}${affordance}`,
    ...composerLines.slice(1),
  ];

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

  const lines = ['[Sessions]', '', ...(state.sidebar.items.length > 0 ? state.sidebar.items : ['(empty)'])];

  return {
    lines,
    focusIndicator: focused ? '>' : undefined,
  };
}

/**
 * Generate transcript content
 */
export function renderTranscriptContent(state: TuiState, focused: boolean): PaneContent {
  const { messages, viewport } = state.transcript;

  if (messages.length === 0) {
    return {
      lines: ['', 'Fred AI Framework', '', 'Type a message to begin...'],
      focusIndicator: focused ? '>' : undefined,
    };
  }

  // Apply viewport scrolling
  const lines = messages.flatMap((msg) => [
    `${msg.role}:`,
    msg.content,
    '',
  ]);

  const visibleLines = lines.slice(
    viewport.scrollOffset,
    viewport.scrollOffset + viewport.visibleLines
  );

  return {
    lines: visibleLines,
    focusIndicator: focused ? '>' : undefined,
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
  const telemetrySegments = [`Focus: ${state.focusedPane}`];
  if (streamSegment) {
    telemetrySegments.push(streamSegment);
  }

  telemetrySegments.push(
    `mdl ${state.telemetry.model}`,
    `cost ${formatUsd(state.telemetry.sessionCostUsd)}`,
    `tok in:${state.telemetry.inputTokenCount} out:${totalOutput}`,
    formatRate(state.streaming.tokensPerSecond),
    formatLatency(state.streaming.firstTokenLatencyMs),
    'Tab: cycle focus',
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
