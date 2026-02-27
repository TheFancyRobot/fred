/**
 * Keyboard event handling and key bindings
 *
 * Uses OpenTUI KeyEvent for structured key parsing.
 *
 * Implements focus cycle and navigation rules:
 * - Tab: cycle focus forward with wraparound
 * - Shift+Tab: cycle focus backward with wraparound
 * - Status bar excluded from focus order
 * - Transcript: Up/Down and PgUp/PgDn for scrolling
 * - Input: Up/Down for history when empty, cursor movement otherwise
 * - Enter: submit input
 * - Backspace/Delete: character removal
 */

import type { KeyEvent } from '@opentui/core';
import type { TuiState } from './state.js';
import {
  nextFocusablePane,
  prevFocusablePane,
  setFocusedPane,
  scrollTranscript,
  navigateInputHistory,
  updateInputText,
  submitInput,
  backspaceAtCursor,
  deleteAtCursor,
  toggleCommandPalette,
  closeCommandPalette,
  updateCommandPaletteQuery,
  moveCommandPaletteSelection,
  moveStartupChooserSelection,
  moveSlashSearchSelection,
  selectNextSession,
  selectPreviousSession,
  selectSidebarSelection,
  toggleSidebarVisibility,
  toggleSidebarSection,
  toggleHelpModal,
} from './state.js';

/**
 * Key action types
 */
export type KeyAction =
  | { type: 'focus-next' }
  | { type: 'focus-prev' }
  | { type: 'toggle-sidebar' }
  | { type: 'toggle-sessions-section' }
  | { type: 'toggle-metadata-section' }
  | { type: 'scroll-up'; lines: number }
  | { type: 'scroll-down'; lines: number }
  | { type: 'history-up' }
  | { type: 'history-down' }
  | { type: 'input-text'; text: string }
  | { type: 'cursor-left' }
  | { type: 'cursor-right' }
  | { type: 'backspace' }
  | { type: 'delete' }
  | { type: 'insert-newline' }
  | { type: 'submit' }
  | { type: 'toggle-command-palette' }
  | { type: 'close-command-palette' }
  | { type: 'palette-next' }
  | { type: 'palette-prev' }
  | { type: 'palette-backspace' }
  | { type: 'palette-query'; text: string }
  | { type: 'palette-submit' }
  | { type: 'startup-chooser-next' }
  | { type: 'startup-chooser-prev' }
  | { type: 'startup-chooser-confirm' }
  | { type: 'slash-next' }
  | { type: 'slash-prev' }
  | { type: 'session-next' }
  | { type: 'session-prev' }
  | { type: 'session-select' }
  | { type: 'delete-session' }
  | { type: 'confirm-delete-session' }
  | { type: 'cancel-delete-session' }
  | { type: 'copy-transcript' }
  | { type: 'copy-last-message' }
  | { type: 'toggle-help' }
  | { type: 'quit' }
  | { type: 'noop' };

/**
 * Map key events to actions based on current state
 */
export function mapKeyToAction(event: KeyEvent, state: TuiState): KeyAction {
  const { name, shift, ctrl, meta } = event;

  const printableChar = getPrintableChar(event);

  const isPaletteToggle = (ctrl || meta) && name === 'k';
  if (isPaletteToggle) {
    return { type: 'toggle-command-palette' };
  }

  if (state.deleteConfirm.isOpen) {
    if (name === 'escape' || name === 'n') {
      return { type: 'cancel-delete-session' };
    }
    if (name === 'enter' || name === 'return' || name === 'y') {
      return { type: 'confirm-delete-session' };
    }
    return { type: 'noop' };
  }

  if (state.commandPalette.isOpen) {
    if (name === 'escape') {
      return { type: 'close-command-palette' };
    }

    if (name === 'up') {
      return { type: 'palette-prev' };
    }

    if (name === 'down') {
      return { type: 'palette-next' };
    }

    if (name === 'backspace' || name === 'delete') {
      return { type: 'palette-backspace' };
    }

    if (name === 'enter' || name === 'return') {
      return { type: 'palette-submit' };
    }

    if (name === 'space') {
      return { type: 'palette-query', text: ' ' };
    }

    if (name.length === 1 && !ctrl && !meta) {
      return { type: 'palette-query', text: name };
    }

    return { type: 'noop' };
  }

  if (state.startup.chooser.isOpen) {
    if (name === 'escape') {
      return { type: 'quit' };
    }
    if (ctrl && !shift && name === 'c') {
      return { type: 'quit' };
    }
    if (name === 'up' || name === 'left') {
      return { type: 'startup-chooser-prev' };
    }
    if (name === 'down' || name === 'right' || name === 'tab') {
      return { type: 'startup-chooser-next' };
    }
    if (name === 'enter' || name === 'return') {
      return { type: 'startup-chooser-confirm' };
    }

    return { type: 'noop' };
  }

  // Help modal: Escape closes, other keys are noop
  if (state.helpModal.isOpen) {
    if (name === 'escape') {
      return { type: 'toggle-help' };
    }
    return { type: 'noop' };
  }

  // Global keybindings (work regardless of focus)
  if (name === 'f1') {
    return { type: 'toggle-help' };
  }

  if (name === 'tab') {
    return shift ? { type: 'focus-prev' } : { type: 'focus-next' };
  }

  if (name === 'escape') {
    return { type: 'quit' };
  }

  if (ctrl && shift && name === 'c') {
    return { type: 'copy-transcript' };
  }

  if (ctrl && name === 'y') {
    return { type: 'copy-last-message' };
  }

  if (ctrl && name === 'b') {
    return { type: 'toggle-sidebar' };
  }

  if (ctrl && name === 'c') {
    return { type: 'quit' };
  }

  if (name === 'pageup') {
    return { type: 'scroll-up', lines: 10 };
  }

  if (name === 'pagedown') {
    return { type: 'scroll-down', lines: 10 };
  }

  // Pane-specific keybindings
  const { focusedPane } = state;

  // Transcript pane: scroll navigation
  if (focusedPane === 'transcript') {
    if (printableChar === '?') {
      return { type: 'toggle-help' };
    }
    if (name === 'up') {
      return { type: 'scroll-up', lines: 1 };
    }
    if (name === 'down') {
      return { type: 'scroll-down', lines: 1 };
    }
    if (name === 'pageup') {
      return { type: 'scroll-up', lines: 10 };
    }
    if (name === 'pagedown') {
      return { type: 'scroll-down', lines: 10 };
    }
  }

  // Input pane: history navigation when empty or navigating, cursor movement otherwise
  if (focusedPane === 'input') {
    const inputIsEmpty = state.input.text.length === 0;
    const isNavigatingHistory = state.input.history.currentIndex !== -1;
    const cursorAtStart = state.input.cursorPosition === 0;
    const shouldUseHistory = isNavigatingHistory || (inputIsEmpty && cursorAtStart);
    const hasHistory = state.input.history.entries.length > 0;


    if (name === 'enter' || name === 'return') {
      if (shift) {
        return { type: 'insert-newline' };
      }
      return { type: 'submit' };
    }

    if (name === 'backspace') {
      return { type: 'backspace' };
    }

    if (name === 'delete') {
      return { type: 'delete' };
    }

    if (name === 'up') {
      if (state.input.slashSearch.isActive && !shouldUseHistory) {
        return { type: 'slash-prev' };
      }
      if (shouldUseHistory && hasHistory) {
        return { type: 'history-up' };
      }
      if (inputIsEmpty && cursorAtStart) {
        return { type: 'scroll-up', lines: 1 };
      }
      return { type: 'cursor-left' };
    }
    if (name === 'down') {
      if (state.input.slashSearch.isActive && !shouldUseHistory) {
        return { type: 'slash-next' };
      }
      if (shouldUseHistory && hasHistory) {
        return { type: 'history-down' };
      }
      if (inputIsEmpty && cursorAtStart) {
        return { type: 'scroll-down', lines: 1 };
      }
      return { type: 'cursor-right' };
    }
    if (name === 'left') {
      return { type: 'cursor-left' };
    }
    if (name === 'right') {
      return { type: 'cursor-right' };
    }

    // Printable characters: single char name, no ctrl/meta modifiers
    if (printableChar) {
      return { type: 'input-text', text: printableChar };
    }

    // Space key
    if (name === 'space') {
      return { type: 'input-text', text: ' ' };
    }
  }

  // Sidebar pane: session navigation
  if (focusedPane === 'sidebar') {
    if (printableChar === '?') {
      return { type: 'toggle-help' };
    }
    if (printableChar?.toLowerCase() === 's') {
      return { type: 'toggle-sessions-section' };
    }
    if (printableChar?.toLowerCase() === 'm') {
      return { type: 'toggle-metadata-section' };
    }
    if (name === 'delete' || name === 'backspace') {
      return { type: 'delete-session' };
    }
    if (name === 'up') {
      return { type: 'session-prev' };
    }
    if (name === 'down') {
      return { type: 'session-next' };
    }
    if (name === 'enter' || name === 'return') {
      return { type: 'session-select' };
    }
  }

  return { type: 'noop' };
}

function getPrintableChar(event: KeyEvent): string | null {
  const { name, shift, ctrl, meta, sequence } = event;

  if (ctrl || meta) {
    return null;
  }

  if (typeof sequence === 'string' && sequence.length === 1) {
    return sequence;
  }

  if (name.length === 1) {
    return shift ? name.toUpperCase() : name;
  }

  return null;
}

/**
 * Apply key action to state
 */
export function applyKeyAction(state: TuiState, action: KeyAction): TuiState {
  switch (action.type) {
    case 'focus-next':
      return setFocusedPane(
        state,
        nextFocusablePane(state.focusedPane, { includeSidebar: state.sidebar.isVisible }),
      );

    case 'focus-prev':
      return setFocusedPane(
        state,
        prevFocusablePane(state.focusedPane, { includeSidebar: state.sidebar.isVisible }),
      );

    case 'toggle-sidebar':
      return toggleSidebarVisibility(state);

    case 'toggle-sessions-section':
      return toggleSidebarSection(state, 'sessions');

    case 'toggle-metadata-section':
      return toggleSidebarSection(state, 'metadata');

    case 'scroll-up':
      return scrollTranscript(state, -action.lines);

    case 'scroll-down':
      return scrollTranscript(state, action.lines);

    case 'history-up':
      return navigateInputHistory(state, 'up');

    case 'history-down':
      return navigateInputHistory(state, 'down');

    case 'input-text': {
      const { text, cursorPosition } = state.input;
      const newText = text.slice(0, cursorPosition) + action.text + text.slice(cursorPosition);
      return updateInputText(state, newText, cursorPosition + action.text.length);
    }

    case 'cursor-left': {
      const newPos = Math.max(0, state.input.cursorPosition - 1);
      return {
        ...state,
        input: {
          ...state.input,
          cursorPosition: newPos,
        },
      };
    }

    case 'cursor-right': {
      const newPos = Math.min(state.input.text.length, state.input.cursorPosition + 1);
      return {
        ...state,
        input: {
          ...state.input,
          cursorPosition: newPos,
        },
      };
    }

    case 'backspace':
      return backspaceAtCursor(state);

    case 'delete':
      return deleteAtCursor(state);

    case 'insert-newline': {
      const { text, cursorPosition } = state.input;
      const newText = text.slice(0, cursorPosition) + '\n' + text.slice(cursorPosition);
      return updateInputText(state, newText, cursorPosition + 1);
    }

    case 'submit':
      return submitInput(state).state;

    case 'toggle-command-palette':
      return toggleCommandPalette(state);

    case 'close-command-palette':
      return closeCommandPalette(state);

    case 'palette-next':
      return moveCommandPaletteSelection(state, 1);

    case 'palette-prev':
      return moveCommandPaletteSelection(state, -1);

    case 'palette-backspace': {
      if (state.commandPalette.query.length === 0) {
        return state;
      }
      return updateCommandPaletteQuery(state, state.commandPalette.query.slice(0, -1));
    }

    case 'palette-query':
      return updateCommandPaletteQuery(state, state.commandPalette.query + action.text);

    case 'palette-submit':
      return closeCommandPalette(state);

    case 'startup-chooser-next':
      return moveStartupChooserSelection(state, 1);

    case 'startup-chooser-prev':
      return moveStartupChooserSelection(state, -1);

    case 'startup-chooser-confirm':
      return state;

    case 'slash-next':
      return moveSlashSearchSelection(state, 1);

    case 'slash-prev':
      return moveSlashSearchSelection(state, -1);

    case 'session-next':
      return selectNextSession(state);

    case 'session-prev':
      return selectPreviousSession(state);

    case 'session-select':
      return selectSidebarSelection(state);

    case 'delete-session':
      return state;

    case 'copy-transcript':
      return state;

    case 'copy-last-message':
      // Handled by app (clipboard write side-effect)
      return state;

    case 'toggle-help':
      return toggleHelpModal(state);

    case 'quit':
      // Handled by app, just return state
      return state;

    case 'noop':
      return state;

    default:
      return state;
  }
}

/**
 * Handle key event (convenience wrapper)
 */
export function handleKeyEvent(state: TuiState, event: KeyEvent): { state: TuiState; action: KeyAction } {
  const action = mapKeyToAction(event, state);
  const newState = applyKeyAction(state, action);

  return { state: newState, action };
}
