/**
 * TUI state model for pane focus and navigation
 *
 * Framework-agnostic state representation that can be tested independently
 * of rendering implementation.
 */

/**
 * Pane identifiers for the TUI layout
 */
export type PaneId = 'sidebar' | 'transcript' | 'input' | 'status';

/**
 * Focusable panes (status is display-only)
 */
export type FocusablePaneId = Exclude<PaneId, 'status'>;

/**
 * Transcript viewport state for scrolling
 */
export interface TranscriptViewport {
  scrollOffset: number;
  totalLines: number;
  visibleLines: number;
  pinnedToBottom: boolean;
}

export interface StreamingState {
  isStreaming: boolean;
  streamStartMs: number | null;
  firstTokenLatencyMs: number | null;
  outputTokenCount: number;
  tokensPerSecond: number;
  lastError: string | null;
}

export interface SessionTelemetry {
  model: string;
  provider: string;
  sessionCostUsd: number;
  inputTokenCount: number;
  outputTokenCount: number;
}

export type CommandPaletteScope = FocusablePaneId;

export interface CommandPaletteAction {
  id: string;
  label: string;
  group: 'global' | FocusablePaneId;
  scopes: ReadonlyArray<CommandPaletteScope>;
  keywords?: ReadonlyArray<string>;
}

export interface CommandPaletteState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  scope: CommandPaletteScope;
  actions: ReadonlyArray<CommandPaletteAction>;
  filteredActions: ReadonlyArray<CommandPaletteAction>;
}

/**
 * Input history state for Up/Down navigation
 */
export interface InputHistory {
  entries: string[];
  currentIndex: number;
}

/**
 * Complete TUI application state
 */
export interface TuiState {
  focusedPane: FocusablePaneId;
  transcript: {
    viewport: TranscriptViewport;
    messages: Array<{ role: string; content: string }>;
  };
  streaming: StreamingState;
  telemetry: SessionTelemetry;
  commandPalette: CommandPaletteState;
  input: {
    text: string;
    cursorPosition: number;
    history: InputHistory;
  };
  sidebar: {
    selectedIndex: number;
    items: string[];
  };
}

/**
 * Create initial TUI state with input pane focused
 */
export function createInitialTuiState(): TuiState {
  const commandPaletteActions = createCommandPaletteActions();

  return {
    focusedPane: 'input',
    transcript: {
      viewport: {
        scrollOffset: 0,
        totalLines: 0,
        visibleLines: 20,
        pinnedToBottom: true,
      },
      messages: [],
    },
    streaming: {
      isStreaming: false,
      streamStartMs: null,
      firstTokenLatencyMs: null,
      outputTokenCount: 0,
      tokensPerSecond: 0,
      lastError: null,
    },
    telemetry: {
      model: '--',
      provider: '--',
      sessionCostUsd: 0,
      inputTokenCount: 0,
      outputTokenCount: 0,
    },
    commandPalette: {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      scope: 'input',
      actions: commandPaletteActions,
      filteredActions: getFilteredPaletteActions(commandPaletteActions, '', 'input'),
    },
    input: {
      text: '',
      cursorPosition: 0,
      history: {
        entries: [],
        currentIndex: -1,
      },
    },
    sidebar: {
      selectedIndex: 0,
      items: [],
    },
  };
}

const DEFAULT_COMMAND_PALETTE_ACTIONS: ReadonlyArray<CommandPaletteAction> = [
  {
    id: 'focus-next-pane',
    label: 'Focus Next Pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['tab', 'focus', 'pane', 'next'],
  },
  {
    id: 'focus-previous-pane',
    label: 'Focus Previous Pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['shift', 'tab', 'focus', 'pane', 'prev'],
  },
  {
    id: 'jump-input-pane',
    label: 'Jump to Input Pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['input', 'composer', 'focus'],
  },
  {
    id: 'jump-sidebar-pane',
    label: 'Jump to Sidebar Pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['sidebar', 'sessions', 'focus'],
  },
  {
    id: 'jump-transcript-pane',
    label: 'Jump to Transcript Pane',
    group: 'global',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['transcript', 'chat', 'focus'],
  },
  {
    id: 'clear-input',
    label: 'Clear Input',
    group: 'input',
    scopes: ['input'],
    keywords: ['clear', 'reset', 'composer'],
  },
  {
    id: 'scroll-transcript-down',
    label: 'Scroll Transcript Down',
    group: 'transcript',
    scopes: ['transcript'],
    keywords: ['scroll', 'down', 'transcript'],
  },
  {
    id: 'scroll-transcript-up',
    label: 'Scroll Transcript Up',
    group: 'transcript',
    scopes: ['transcript'],
    keywords: ['scroll', 'up', 'transcript'],
  },
  {
    id: 'select-next-session',
    label: 'Select Next Session',
    group: 'sidebar',
    scopes: ['sidebar'],
    keywords: ['session', 'next', 'sidebar'],
  },
  {
    id: 'select-previous-session',
    label: 'Select Previous Session',
    group: 'sidebar',
    scopes: ['sidebar'],
    keywords: ['session', 'previous', 'sidebar'],
  },
  {
    id: 'submit-input',
    label: 'Submit Input',
    group: 'input',
    scopes: ['input'],
    keywords: ['submit', 'send', 'input'],
  },
];

function createCommandPaletteActions(): ReadonlyArray<CommandPaletteAction> {
  return [...DEFAULT_COMMAND_PALETTE_ACTIONS];
}

export function getFilteredPaletteActions(
  actions: ReadonlyArray<CommandPaletteAction>,
  query: string,
  scope: CommandPaletteScope,
): ReadonlyArray<CommandPaletteAction> {
  const normalizedQuery = query.trim().toLowerCase();

  const scoped = actions.filter((action) => action.scopes.includes(scope));
  const ranked = scoped.map((action, index) => {
    const haystack = [action.label, action.id, ...(action.keywords ?? [])].join(' ').toLowerCase();
    const startsWithScore = normalizedQuery.length > 0 && action.label.toLowerCase().startsWith(normalizedQuery) ? 2 : 0;
    const containsScore = normalizedQuery.length > 0 && haystack.includes(normalizedQuery) ? 1 : 0;
    const score = normalizedQuery.length === 0 ? 0 : startsWithScore + containsScore;
    return { action, index, score, matches: normalizedQuery.length === 0 || containsScore > 0 || startsWithScore > 0 };
  });

  return ranked
    .filter((entry) => entry.matches)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      const nameOrder = left.action.label.localeCompare(right.action.label);
      if (nameOrder !== 0) {
        return nameOrder;
      }

      return left.index - right.index;
    })
    .map((entry) => entry.action);
}

function withCommandPaletteState(
  state: TuiState,
  updates: Partial<CommandPaletteState>,
): CommandPaletteState {
  return {
    ...state.commandPalette,
    ...updates,
  };
}

export function openCommandPalette(state: TuiState): TuiState {
  const scope = state.focusedPane;
  const filteredActions = getFilteredPaletteActions(state.commandPalette.actions, '', scope);

  return {
    ...state,
    commandPalette: withCommandPaletteState(state, {
      isOpen: true,
      query: '',
      selectedIndex: 0,
      scope,
      filteredActions,
    }),
  };
}

export function closeCommandPalette(state: TuiState): TuiState {
  const scope = state.focusedPane;

  return {
    ...state,
    commandPalette: withCommandPaletteState(state, {
      isOpen: false,
      query: '',
      selectedIndex: 0,
      scope,
      filteredActions: getFilteredPaletteActions(state.commandPalette.actions, '', scope),
    }),
  };
}

export function toggleCommandPalette(state: TuiState): TuiState {
  return state.commandPalette.isOpen ? closeCommandPalette(state) : openCommandPalette(state);
}

export function updateCommandPaletteQuery(state: TuiState, query: string): TuiState {
  const filteredActions = getFilteredPaletteActions(
    state.commandPalette.actions,
    query,
    state.commandPalette.scope,
  );

  return {
    ...state,
    commandPalette: withCommandPaletteState(state, {
      query,
      selectedIndex: Math.max(0, Math.min(state.commandPalette.selectedIndex, Math.max(0, filteredActions.length - 1))),
      filteredActions,
    }),
  };
}

export function moveCommandPaletteSelection(state: TuiState, delta: number): TuiState {
  const count = state.commandPalette.filteredActions.length;
  if (count === 0) {
    return {
      ...state,
      commandPalette: withCommandPaletteState(state, { selectedIndex: 0 }),
    };
  }

  const normalized = ((state.commandPalette.selectedIndex + delta) % count + count) % count;
  return {
    ...state,
    commandPalette: withCommandPaletteState(state, { selectedIndex: normalized }),
  };
}

export function getSelectedCommandPaletteAction(state: TuiState): CommandPaletteAction | null {
  const selected = state.commandPalette.filteredActions[state.commandPalette.selectedIndex];
  return selected ?? null;
}

/**
 * Focus navigation helpers
 */
const FOCUSABLE_PANES: FocusablePaneId[] = ['sidebar', 'transcript', 'input'];

/**
 * Get next focusable pane with wraparound
 */
export function nextFocusablePane(current: FocusablePaneId): FocusablePaneId {
  const currentIndex = FOCUSABLE_PANES.indexOf(current);
  const nextIndex = (currentIndex + 1) % FOCUSABLE_PANES.length;
  return FOCUSABLE_PANES[nextIndex];
}

/**
 * Get previous focusable pane with wraparound
 */
export function prevFocusablePane(current: FocusablePaneId): FocusablePaneId {
  const currentIndex = FOCUSABLE_PANES.indexOf(current);
  const prevIndex = currentIndex === 0 ? FOCUSABLE_PANES.length - 1 : currentIndex - 1;
  return FOCUSABLE_PANES[prevIndex];
}

/**
 * Apply focus change to state
 */
export function setFocusedPane(state: TuiState, pane: FocusablePaneId): TuiState {
  const nextScope = state.commandPalette.isOpen ? pane : state.commandPalette.scope;
  const filteredActions = state.commandPalette.isOpen
    ? getFilteredPaletteActions(state.commandPalette.actions, state.commandPalette.query, pane)
    : state.commandPalette.filteredActions;

  return {
    ...state,
    focusedPane: pane,
    commandPalette: withCommandPaletteState(state, {
      scope: nextScope,
      filteredActions,
      selectedIndex: 0,
    }),
  };
}

/**
 * Scroll transcript viewport
 */
export function scrollTranscript(state: TuiState, delta: number): TuiState {
  const { scrollOffset, totalLines, visibleLines } = state.transcript.viewport;
  const maxOffset = Math.max(0, totalLines - visibleLines);

  const newOffset = Math.max(0, Math.min(maxOffset, scrollOffset + delta));
  const pinnedToBottom = newOffset >= maxOffset;

  return {
    ...state,
    transcript: {
      ...state.transcript,
      viewport: {
        ...state.transcript.viewport,
        scrollOffset: newOffset,
        pinnedToBottom,
      },
    },
  };
}

function countMessageLines(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, message) => {
    const roleLines = 1;
    const contentLines = Math.max(1, message.content.split('\n').length);
    const spacerLines = 1;
    return total + roleLines + contentLines + spacerLines;
  }, 0);
}

function withViewportUpdated(state: TuiState): TuiState {
  const totalLines = countMessageLines(state.transcript.messages);
  const { visibleLines, pinnedToBottom } = state.transcript.viewport;
  const maxOffset = Math.max(0, totalLines - visibleLines);
  const scrollOffset = pinnedToBottom
    ? maxOffset
    : Math.max(0, Math.min(state.transcript.viewport.scrollOffset, maxOffset));

  return {
    ...state,
    transcript: {
      ...state.transcript,
      viewport: {
        ...state.transcript.viewport,
        totalLines,
        scrollOffset,
      },
    },
  };
}

function getStreamRate(streamStartMs: number | null, outputTokenCount: number, nowMs: number): number {
  if (streamStartMs === null || outputTokenCount <= 0) {
    return 0;
  }

  const elapsedMs = Math.max(1, nowMs - streamStartMs);
  return (outputTokenCount * 1000) / elapsedMs;
}

export function startStreaming(state: TuiState, nowMs = Date.now()): TuiState {
  return {
    ...state,
    streaming: {
      isStreaming: true,
      streamStartMs: nowMs,
      firstTokenLatencyMs: null,
      outputTokenCount: 0,
      tokensPerSecond: 0,
      lastError: null,
    },
  };
}

export function appendAssistant(
  state: TuiState,
  tokenText: string,
  tokenCount = 1,
  nowMs = Date.now(),
): TuiState {
  if (!tokenText) {
    return state;
  }

  const messages = [...state.transcript.messages];
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === 'assistant') {
    messages[messages.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + tokenText,
    };
  } else {
    messages.push({ role: 'assistant', content: tokenText });
  }

  const nextOutputTokenCount = state.streaming.outputTokenCount + Math.max(0, tokenCount);
  const firstTokenLatencyMs = state.streaming.firstTokenLatencyMs ?? (
    state.streaming.streamStartMs !== null
      ? Math.max(0, nowMs - state.streaming.streamStartMs)
      : null
  );

  return withViewportUpdated({
    ...state,
    transcript: {
      ...state.transcript,
      messages,
    },
    streaming: {
      ...state.streaming,
      isStreaming: state.streaming.isStreaming,
      firstTokenLatencyMs,
      outputTokenCount: nextOutputTokenCount,
      tokensPerSecond: getStreamRate(state.streaming.streamStartMs, nextOutputTokenCount, nowMs),
    },
  });
}

export function finishStreaming(state: TuiState, nowMs = Date.now()): TuiState {
  return {
    ...state,
    streaming: {
      ...state.streaming,
      isStreaming: false,
      tokensPerSecond: getStreamRate(state.streaming.streamStartMs, state.streaming.outputTokenCount, nowMs),
    },
  };
}

export function recordStreamingError(state: TuiState, error: string, nowMs = Date.now()): TuiState {
  return {
    ...state,
    streaming: {
      ...state.streaming,
      isStreaming: false,
      lastError: error,
      tokensPerSecond: getStreamRate(state.streaming.streamStartMs, state.streaming.outputTokenCount, nowMs),
    },
  };
}

export function appendUserMessage(state: TuiState, content: string): TuiState {
  if (!content.trim()) {
    return state;
  }

  return withViewportUpdated({
    ...state,
    transcript: {
      ...state.transcript,
      messages: [...state.transcript.messages, { role: 'user', content }],
    },
  });
}

/**
 * Update input text and cursor position
 */
export function updateInputText(state: TuiState, text: string, cursorPosition?: number): TuiState {
  return {
    ...state,
    input: {
      ...state.input,
      text,
      cursorPosition: cursorPosition ?? text.length,
    },
  };
}

/**
 * Navigate input history (Up/Down when input is empty or already navigating history)
 */
export function navigateInputHistory(state: TuiState, direction: 'up' | 'down'): TuiState {
  const { history, text, cursorPosition } = state.input;

  if (history.entries.length === 0) {
    return state;
  }

  // Allow history navigation if:
  // 1. Input is empty, OR
  // 2. We're already navigating history (currentIndex !== -1)
  const isNavigatingHistory = history.currentIndex !== -1;
  const textIsEmpty = text.length === 0;
  const cursorAtStart = cursorPosition === 0;

  if (!isNavigatingHistory && (!textIsEmpty || !cursorAtStart)) {
    return state;
  }

  let newIndex: number;
  if (direction === 'up') {
    // Go back in history (older)
    newIndex = history.currentIndex === -1
      ? history.entries.length - 1
      : Math.max(0, history.currentIndex - 1);
  } else {
    // Go forward in history (newer)
    if (history.currentIndex === -1) {
      return state;
    }
    newIndex = history.currentIndex + 1;
    if (newIndex >= history.entries.length) {
      // Return to empty input
      return {
        ...state,
        input: {
          ...state.input,
          text: '',
          cursorPosition: 0,
          history: {
            ...history,
            currentIndex: -1,
          },
        },
      };
    }
  }

  const historyText = history.entries[newIndex];
  return {
    ...state,
    input: {
      ...state.input,
      text: historyText,
      cursorPosition: historyText.length,
      history: {
        ...history,
        currentIndex: newIndex,
      },
    },
  };
}

/**
 * Submit the current input: clears input, resets cursor, adds to history
 * Returns both the new state and the submitted text
 */
export function submitInput(state: TuiState): { state: TuiState; submittedText: string } {
  const text = state.input.text;
  if (!text.trim()) {
    return { state, submittedText: '' };
  }

  const newState: TuiState = {
    ...state,
    input: {
      ...state.input,
      text: '',
      cursorPosition: 0,
      history: {
        entries: [...state.input.history.entries, text],
        currentIndex: -1,
      },
    },
  };
  return { state: newState, submittedText: text };
}

/**
 * Remove character before cursor (backspace behavior)
 */
export function backspaceAtCursor(state: TuiState): TuiState {
  const { text, cursorPosition } = state.input;
  if (cursorPosition === 0) {
    return state;
  }
  const newText = text.slice(0, cursorPosition - 1) + text.slice(cursorPosition);
  return {
    ...state,
    input: {
      ...state.input,
      text: newText,
      cursorPosition: cursorPosition - 1,
    },
  };
}

/**
 * Remove character at cursor position (delete key behavior)
 */
export function deleteAtCursor(state: TuiState): TuiState {
  const { text, cursorPosition } = state.input;
  if (cursorPosition >= text.length) {
    return state;
  }
  const newText = text.slice(0, cursorPosition) + text.slice(cursorPosition + 1);
  return {
    ...state,
    input: {
      ...state.input,
      text: newText,
    },
  };
}

/**
 * Add entry to input history
 */
export function addToInputHistory(state: TuiState, entry: string): TuiState {
  if (!entry.trim()) {
    return state;
  }

  return {
    ...state,
    input: {
      ...state.input,
      history: {
        entries: [...state.input.history.entries, entry],
        currentIndex: -1,
      },
    },
  };
}
