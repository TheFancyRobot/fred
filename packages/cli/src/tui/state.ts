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
  return {
    ...state,
    focusedPane: pane,
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
  const { history, text } = state.input;

  if (history.entries.length === 0) {
    return state;
  }

  // Allow history navigation if:
  // 1. Input is empty, OR
  // 2. We're already navigating history (currentIndex !== -1)
  const isNavigatingHistory = history.currentIndex !== -1;
  const textIsEmpty = text.length === 0;

  if (!textIsEmpty && !isNavigatingHistory) {
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
  const newState: TuiState = {
    ...state,
    input: {
      ...state.input,
      text: '',
      cursorPosition: 0,
      history: text.trim()
        ? {
            entries: [...state.input.history.entries, text],
            currentIndex: -1,
          }
        : {
            ...state.input.history,
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
