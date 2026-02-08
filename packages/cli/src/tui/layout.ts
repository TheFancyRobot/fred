/**
 * TUI layout content providers
 *
 * Provides content data for each pane. Actual layout and rendering
 * is handled by OpenTUI's Yoga flexbox engine in app.ts.
 */

import type { TuiState } from './state.js';

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
export function renderStatusContent(state: TuiState): PaneContent {
  const focusedPane = state.focusedPane;
  const statusText = `Focus: ${focusedPane} | Tab: cycle focus | Esc: quit`;

  return {
    lines: [statusText],
  };
}

/**
 * Startup hint displayed before entering full shell
 */
export const STARTUP_HINT = 'Starting Fred chat... Press Tab to cycle focus, Esc to quit.';
