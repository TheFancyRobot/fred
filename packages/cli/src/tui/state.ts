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

export interface SessionListItem {
  id: string;
  title: string | null;
  updatedAt: Date;
  agent?: {
    id?: string;
    name?: string;
  };
  messageCount: number;
  preview: string | null;
  unread: boolean;
}

export interface SessionTranscript {
  viewport: TranscriptViewport;
  messages: Array<{ role: string; content: string }>;
}

export interface StreamingState {
  isStreaming: boolean;
  streamStartMs: number | null;
  firstTokenLatencyMs: number | null;
  outputTokenCount: number;
  tokensPerSecond: number;
  lastError: string | null;
  sessionId: string | null;
}

export interface SessionTelemetry {
  model: string;
  provider: string;
  sessionCostUsd: number;
  inputTokenCount: number;
  outputTokenCount: number;
}

export interface SessionTranscript {
  viewport: TranscriptViewport;
  messages: Array<{ role: string; content: string }>;
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
  transcript: SessionTranscript;
  streaming: StreamingState;
  telemetry: SessionTelemetry;
  commandPalette: CommandPaletteState;
  input: {
    text: string;
    cursorPosition: number;
    history: InputHistory;
  };
  sessions: {
    items: SessionListItem[];
    selectedId: string | null;
    drafts: Record<string, string>;
    transcripts: Record<string, SessionTranscript>;
  };
  sidebar: {
    selectedIndex: number;
    hasNewSessionAction: boolean;
  };
}

/**
 * Create initial TUI state with input pane focused
 */
export function createInitialTuiState(): TuiState {
  const commandPaletteActions = createCommandPaletteActions();
  const transcript = createTranscriptState([], 20, true);

  return {
    focusedPane: 'input',
    transcript,
    streaming: {
      isStreaming: false,
      streamStartMs: null,
      firstTokenLatencyMs: null,
      outputTokenCount: 0,
      tokensPerSecond: 0,
      lastError: null,
      sessionId: null,
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
    sessions: {
      items: [],
      selectedId: null,
      drafts: {},
      transcripts: {},
    },
    sidebar: {
      selectedIndex: 0,
      hasNewSessionAction: true,
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
    id: 'create-session',
    label: 'New Session',
    group: 'sidebar',
    scopes: ['sidebar', 'transcript', 'input'],
    keywords: ['session', 'new', 'create'],
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

  const nextState: TuiState = {
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

  if (pinnedToBottom && state.sessions.selectedId) {
    return updateSessionUnread(nextState, state.sessions.selectedId, false);
  }

  return nextState;
}

function countMessageLines(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, message) => {
    const roleLines = 1;
    const contentLines = Math.max(1, message.content.split('\n').length);
    const spacerLines = 1;
    return total + roleLines + contentLines + spacerLines;
  }, 0);
}

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const deriveSessionTitleFromMessages = (
  messages: Array<{ role: string; content: string }>
): string | null => {
  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser) return null;
  const normalized = normalizeWhitespace(firstUser.content);
  if (!normalized) return null;
  return truncateText(normalized, 60);
};

const deriveSessionPreviewFromMessages = (
  messages: Array<{ role: string; content: string }>
): string | null => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const normalized = normalizeWhitespace(message.content);
    if (!normalized) continue;
    return truncateText(normalized, 120);
  }
  return null;
};

export function createTranscriptState(
  messages: Array<{ role: string; content: string }>,
  visibleLines: number,
  pinnedToBottom = true
): SessionTranscript {
  const totalLines = countMessageLines(messages);
  const clampedVisible = Math.max(1, visibleLines);
  const maxOffset = Math.max(0, totalLines - clampedVisible);
  const scrollOffset = pinnedToBottom ? maxOffset : 0;

  return {
    messages,
    viewport: {
      scrollOffset,
      totalLines,
      visibleLines: clampedVisible,
      pinnedToBottom,
    },
  };
}

function updateTranscriptViewport(
  transcript: SessionTranscript,
  options: { pinnedToBottom?: boolean } = {}
): SessionTranscript {
  const totalLines = countMessageLines(transcript.messages);
  const visibleLines = Math.max(1, transcript.viewport.visibleLines);
  const maxOffset = Math.max(0, totalLines - visibleLines);
  const pinnedToBottom = options.pinnedToBottom ?? transcript.viewport.pinnedToBottom;
  const scrollOffset = pinnedToBottom
    ? maxOffset
    : Math.max(0, Math.min(transcript.viewport.scrollOffset, maxOffset));

  return {
    ...transcript,
    viewport: {
      ...transcript.viewport,
      totalLines,
      scrollOffset,
      pinnedToBottom,
    },
  };
}

function sortSessions(items: SessionListItem[]): SessionListItem[] {
  return [...items].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

function getSelectedSessionIndex(items: SessionListItem[], selectedId: string | null): number {
  if (!selectedId) return 0;
  const index = items.findIndex((item) => item.id === selectedId);
  return index >= 0 ? index : 0;
}

function getSidebarSelectedIndex(
  items: SessionListItem[],
  selectedId: string | null,
  hasNewSessionAction: boolean,
): number {
  if (hasNewSessionAction) {
    if (!selectedId) return 0;
    const index = items.findIndex((item) => item.id === selectedId);
    return index >= 0 ? index + 1 : 0;
  }
  return getSelectedSessionIndex(items, selectedId);
}

function updateSessionItem(
  state: TuiState,
  sessionId: string,
  updater: (item: SessionListItem) => SessionListItem
): TuiState {
  const items = state.sessions.items;
  const index = items.findIndex((item) => item.id === sessionId);
  if (index < 0) return state;

  const updated = updater(items[index]);
  const nextItems = sortSessions([
    ...items.filter((item) => item.id !== sessionId),
    updated,
  ]);
  const selectedIndex = getSidebarSelectedIndex(
    nextItems,
    state.sessions.selectedId,
    state.sidebar.hasNewSessionAction,
  );

  return {
    ...state,
    sessions: {
      ...state.sessions,
      items: nextItems,
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex,
    },
  };
}

function updateSessionUnread(state: TuiState, sessionId: string, unread: boolean): TuiState {
  return updateSessionItem(state, sessionId, (item) => ({
    ...item,
    unread,
  }));
}

function updateSessionFromTranscript(
  state: TuiState,
  sessionId: string,
  transcript: SessionTranscript,
  nowMs: number,
  unread: boolean
): TuiState {
  return updateSessionItem(state, sessionId, (item) => {
    const derivedTitle = item.title ?? deriveSessionTitleFromMessages(transcript.messages);
    return {
      ...item,
      title: derivedTitle ?? item.title,
      updatedAt: new Date(nowMs),
      messageCount: transcript.messages.length,
      preview: deriveSessionPreviewFromMessages(transcript.messages) ?? item.preview,
      unread,
    };
  });
}

function getStreamRate(streamStartMs: number | null, outputTokenCount: number, nowMs: number): number {
  if (streamStartMs === null || outputTokenCount <= 0) {
    return 0;
  }

  const elapsedMs = Math.max(1, nowMs - streamStartMs);
  return (outputTokenCount * 1000) / elapsedMs;
}

export function startStreaming(state: TuiState, nowMs = Date.now()): TuiState {
  const sessionId = state.sessions.selectedId;
  return {
    ...state,
    streaming: {
      isStreaming: true,
      streamStartMs: nowMs,
      firstTokenLatencyMs: null,
      outputTokenCount: 0,
      tokensPerSecond: 0,
      lastError: null,
      sessionId,
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

  const sessionId = state.streaming.sessionId ?? state.sessions.selectedId;
  if (!sessionId) {
    return state;
  }

  const currentTranscript = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const messages = [...currentTranscript.messages];
  const lastMessage = messages[messages.length - 1];

  if (lastMessage?.role === 'assistant') {
    messages[messages.length - 1] = {
      ...lastMessage,
      content: lastMessage.content + tokenText,
    };
  } else {
    messages.push({ role: 'assistant', content: tokenText });
  }

  const nextTranscript = updateTranscriptViewport({
    ...currentTranscript,
    messages,
  });

  const updatedTranscripts = {
    ...state.sessions.transcripts,
    [sessionId]: nextTranscript,
  };

  const transcript = sessionId === state.sessions.selectedId
    ? nextTranscript
    : state.transcript;

  const nextOutputTokenCount = state.streaming.outputTokenCount + Math.max(0, tokenCount);
  const firstTokenLatencyMs = state.streaming.firstTokenLatencyMs ?? (
    state.streaming.streamStartMs !== null
      ? Math.max(0, nowMs - state.streaming.streamStartMs)
      : null
  );

  const unread = sessionId !== state.sessions.selectedId || !nextTranscript.viewport.pinnedToBottom;
  const nextState = updateSessionFromTranscript(
    {
      ...state,
      transcript,
      sessions: {
        ...state.sessions,
        transcripts: updatedTranscripts,
      },
      streaming: {
        ...state.streaming,
        isStreaming: state.streaming.isStreaming,
        firstTokenLatencyMs,
        outputTokenCount: nextOutputTokenCount,
        tokensPerSecond: getStreamRate(state.streaming.streamStartMs, nextOutputTokenCount, nowMs),
        sessionId,
      },
    },
    sessionId,
    nextTranscript,
    nowMs,
    unread,
  );

  if (sessionId === nextState.sessions.selectedId && nextTranscript.viewport.pinnedToBottom) {
    return updateSessionUnread(nextState, sessionId, false);
  }

  return nextState;
}

export function finishStreaming(state: TuiState, nowMs = Date.now()): TuiState {
  return {
    ...state,
    streaming: {
      ...state.streaming,
      isStreaming: false,
      tokensPerSecond: getStreamRate(state.streaming.streamStartMs, state.streaming.outputTokenCount, nowMs),
      sessionId: state.streaming.sessionId,
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
      sessionId: state.streaming.sessionId,
    },
  };
}

export function appendUserMessage(state: TuiState, content: string, nowMs = Date.now()): TuiState {
  if (!content.trim()) {
    return state;
  }

  const sessionId = state.sessions.selectedId;
  if (!sessionId) {
    return state;
  }

  const currentTranscript = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const nextTranscript = updateTranscriptViewport({
    ...currentTranscript,
    messages: [...currentTranscript.messages, { role: 'user', content }],
  }, { pinnedToBottom: true });

  const updatedTranscripts = {
    ...state.sessions.transcripts,
    [sessionId]: nextTranscript,
  };

  const nextState = updateSessionFromTranscript(
    {
      ...state,
      transcript: nextTranscript,
      sessions: {
        ...state.sessions,
        transcripts: updatedTranscripts,
      },
    },
    sessionId,
    nextTranscript,
    nowMs,
    false,
  );

  return updateSessionUnread(nextState, sessionId, false);
}

/**
 * Update input text and cursor position
 */
export function updateInputText(state: TuiState, text: string, cursorPosition?: number): TuiState {
  if (state.sessions.selectedId) {
    return {
      ...state,
      input: {
        ...state.input,
        text,
        cursorPosition: cursorPosition ?? text.length,
      },
      sessions: {
        ...state.sessions,
        drafts: {
          ...state.sessions.drafts,
          [state.sessions.selectedId]: text,
        },
      },
    };
  }

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
    sessions: state.sessions.selectedId
      ? {
          ...state.sessions,
          drafts: {
            ...state.sessions.drafts,
            [state.sessions.selectedId]: '',
          },
        }
      : state.sessions,
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

export function applySessionList(
  state: TuiState,
  items: SessionListItem[],
  selectedId?: string | null
): TuiState {
  const sorted = sortSessions(items);
  const resolvedSelected = selectedId ?? state.sessions.selectedId ?? sorted[0]?.id ?? null;
  const selectedIndex = getSidebarSelectedIndex(sorted, resolvedSelected, state.sidebar.hasNewSessionAction);

  const nextTranscripts = { ...state.sessions.transcripts };
  for (const item of sorted) {
    if (!nextTranscripts[item.id]) {
      nextTranscripts[item.id] = createTranscriptState([], state.transcript.viewport.visibleLines, true);
    }
  }

  const transcript = resolvedSelected && nextTranscripts[resolvedSelected]
    ? nextTranscripts[resolvedSelected]
    : state.transcript;

  const nextDrafts = resolvedSelected && state.sessions.selectedId && state.sessions.selectedId !== resolvedSelected
    ? {
        ...state.sessions.drafts,
        [state.sessions.selectedId]: state.input.text,
      }
    : state.sessions.drafts;
  const nextInputText = resolvedSelected
    ? (nextDrafts[resolvedSelected] ?? '')
    : (state.sessions.selectedId ? state.sessions.drafts[state.sessions.selectedId] ?? '' : state.input.text);
  const nextCursor = nextInputText.length;

  return {
    ...state,
    transcript,
    input: {
      ...state.input,
      text: nextInputText,
      cursorPosition: nextCursor,
      history: {
        ...state.input.history,
        currentIndex: -1,
      },
    },
    sessions: {
      ...state.sessions,
      items: sorted,
      selectedId: resolvedSelected,
      drafts: nextDrafts,
      transcripts: nextTranscripts,
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex,
    },
  };
}

export function addSession(state: TuiState, item: SessionListItem, options: { select?: boolean } = {}): TuiState {
  const nextItems = sortSessions([
    ...state.sessions.items.filter((existing) => existing.id !== item.id),
    item,
  ]);
  const shouldSelect = options.select ?? true;
  const nextSelected = shouldSelect ? item.id : state.sessions.selectedId;
  const selectedIndex = getSidebarSelectedIndex(nextItems, nextSelected, state.sidebar.hasNewSessionAction);

  const nextTranscripts = state.sessions.transcripts[item.id]
    ? state.sessions.transcripts
    : {
        ...state.sessions.transcripts,
        [item.id]: createTranscriptState([], state.transcript.viewport.visibleLines, true),
      };

  const transcript = nextSelected && nextTranscripts[nextSelected]
    ? nextTranscripts[nextSelected]
    : state.transcript;

  const nextDrafts = shouldSelect && state.sessions.selectedId
    ? {
        ...state.sessions.drafts,
        [state.sessions.selectedId]: state.input.text,
      }
    : state.sessions.drafts;
  const nextInputText = shouldSelect ? (nextDrafts[nextSelected ?? ''] ?? '') : state.input.text;
  const nextCursor = shouldSelect ? nextInputText.length : state.input.cursorPosition;

  return {
    ...state,
    transcript,
    input: {
      ...state.input,
      text: nextInputText,
      cursorPosition: nextCursor,
      history: shouldSelect
        ? {
            ...state.input.history,
            currentIndex: -1,
          }
        : state.input.history,
    },
    sessions: {
      ...state.sessions,
      items: nextItems,
      selectedId: nextSelected,
      drafts: nextDrafts,
      transcripts: nextTranscripts,
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex,
    },
  };
}

export function selectNextSession(state: TuiState): TuiState {
  if (state.sessions.items.length === 0) return state;
  const maxIndex = state.sessions.items.length - 1;
  if (state.sidebar.hasNewSessionAction) {
    const baseIndex = Math.min(maxIndex + 1, state.sidebar.selectedIndex + 1);
    if (baseIndex === 0) {
      return state;
    }
    const nextIndex = baseIndex - 1;
    const nextId = state.sessions.items[nextIndex]?.id ?? null;
    return switchSession(state, nextId);
  }
  const nextIndex = Math.min(maxIndex, state.sidebar.selectedIndex + 1);
  const nextId = state.sessions.items[nextIndex]?.id ?? null;
  return switchSession(state, nextId);
}

export function selectPreviousSession(state: TuiState): TuiState {
  if (state.sessions.items.length === 0) return state;
  if (state.sidebar.hasNewSessionAction) {
    const baseIndex = Math.max(0, state.sidebar.selectedIndex - 1);
    if (baseIndex === 0) {
      return state;
    }
    const nextIndex = baseIndex - 1;
    const nextId = state.sessions.items[nextIndex]?.id ?? null;
    return switchSession(state, nextId);
  }
  const nextIndex = Math.max(0, state.sidebar.selectedIndex - 1);
  const nextId = state.sessions.items[nextIndex]?.id ?? null;
  return switchSession(state, nextId);
}

export function selectSidebarSelection(state: TuiState): TuiState {
  const items = state.sessions.items;
  if (items.length === 0) return state;
  if (state.sidebar.hasNewSessionAction && state.sidebar.selectedIndex === 0) {
    return state;
  }

  const index = state.sidebar.hasNewSessionAction
    ? Math.max(0, state.sidebar.selectedIndex - 1)
    : state.sidebar.selectedIndex;
  const nextId = items[index]?.id ?? null;
  return switchSession(state, nextId);
}

export function switchSession(state: TuiState, sessionId: string | null): TuiState {
  if (!sessionId || sessionId === state.sessions.selectedId) {
    return state;
  }

  const nextDrafts = {
    ...state.sessions.drafts,
    ...(state.sessions.selectedId ? { [state.sessions.selectedId]: state.input.text } : {}),
  };

  const nextTranscript = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const normalizedTranscript = updateTranscriptViewport(nextTranscript, { pinnedToBottom: true });

  const nextState: TuiState = {
    ...state,
    transcript: normalizedTranscript,
    sessions: {
      ...state.sessions,
      selectedId: sessionId,
      drafts: nextDrafts,
      transcripts: {
        ...state.sessions.transcripts,
        [sessionId]: normalizedTranscript,
      },
    },
    input: {
      ...state.input,
      text: nextDrafts[sessionId] ?? '',
      cursorPosition: (nextDrafts[sessionId] ?? '').length,
      history: {
        ...state.input.history,
        currentIndex: -1,
      },
    },
    sidebar: {
      ...state.sidebar,
      selectedIndex: getSidebarSelectedIndex(state.sessions.items, sessionId, state.sidebar.hasNewSessionAction),
    },
  };

  return updateSessionUnread(nextState, sessionId, false);
}

export function markSessionReadIfPinned(state: TuiState): TuiState {
  const sessionId = state.sessions.selectedId;
  if (!sessionId) return state;
  if (!state.transcript.viewport.pinnedToBottom) return state;
  return updateSessionUnread(state, sessionId, false);
}

export function upsertSessionTranscript(
  state: TuiState,
  sessionId: string,
  messages: Array<{ role: string; content: string }>,
  options: { pinnedToBottom?: boolean } = {}
): TuiState {
  const existing = state.sessions.transcripts[sessionId]
    ?? createTranscriptState([], state.transcript.viewport.visibleLines, true);
  const nextTranscript = updateTranscriptViewport({
    ...existing,
    messages,
  }, { pinnedToBottom: options.pinnedToBottom });

  const nextTranscripts = {
    ...state.sessions.transcripts,
    [sessionId]: nextTranscript,
  };

  const nextState: TuiState = {
    ...state,
    transcript: sessionId === state.sessions.selectedId ? nextTranscript : state.transcript,
    sessions: {
      ...state.sessions,
      transcripts: nextTranscripts,
    },
  };

  return updateSessionFromTranscript(
    nextState,
    sessionId,
    nextTranscript,
    Date.now(),
    sessionId !== state.sessions.selectedId,
  );
}

export function setSessionDraft(state: TuiState, sessionId: string, draft: string): TuiState {
  return {
    ...state,
    sessions: {
      ...state.sessions,
      drafts: {
        ...state.sessions.drafts,
        [sessionId]: draft,
      },
    },
  };
}
