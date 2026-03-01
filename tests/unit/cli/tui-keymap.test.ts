import { describe, expect, test } from 'bun:test';
import type { KeyEvent } from '@opentui/core';
import {
  mapKeyToAction,
  applyKeyAction,
  handleKeyEvent,
} from '../../../packages/cli/src/tui/keymap.js';
import {
  createInitialTuiState,
  nextFocusablePane,
  prevFocusablePane,
  addToInputHistory,
  openStartupChooser,
} from '../../../packages/cli/src/tui/state.js';

/**
 * Helper to create an OpenTUI KeyEvent for testing
 */
function makeKey(overrides: Partial<KeyEvent> & { name: string }): KeyEvent {
  return {
    name: overrides.name,
    sequence: overrides.sequence ?? '',
    ctrl: overrides.ctrl ?? false,
    shift: overrides.shift ?? false,
    meta: overrides.meta ?? false,
    option: overrides.option ?? false,
    eventType: overrides.eventType ?? 'press',
    repeated: overrides.repeated ?? false,
  } as KeyEvent;
}

describe('TUI Keymap', () => {
  describe('Focus cycle with Tab', () => {
    test('Tab cycles focus forward from input to sidebar', () => {
      const state = createInitialTuiState();
      expect(state.focusedPane).toBe('input');

      const event = makeKey({ name: 'tab' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('focus-next');

      const newState = applyKeyAction(state, action);
      expect(newState.focusedPane).toBe('sidebar');
    });

    test('Tab cycles through all focusable panes with wraparound', () => {
      const state = createInitialTuiState();

      // input -> sidebar
      const next1 = nextFocusablePane(state.focusedPane, { includeSidebar: state.sidebar.isVisible });
      expect(next1).toBe('sidebar');

      // sidebar -> transcript
      const next2 = nextFocusablePane(next1, { includeSidebar: state.sidebar.isVisible });
      expect(next2).toBe('transcript');

      // transcript -> input (wraparound)
      const next3 = nextFocusablePane(next2, { includeSidebar: state.sidebar.isVisible });
      expect(next3).toBe('input');
    });

    test('Shift+Tab cycles focus backward', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';

      const event = makeKey({ name: 'tab', shift: true });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('focus-prev');

      const newState = applyKeyAction(state, action);
      expect(newState.focusedPane).toBe('transcript');
    });

    test('Shift+Tab cycles backward with wraparound', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'sidebar';

      // sidebar -> input (wraparound)
      const prev = prevFocusablePane(state.focusedPane, { includeSidebar: state.sidebar.isVisible });
      expect(prev).toBe('input');
    });
  });

  describe('Status bar never receives focus', () => {
    test('focus cycle skips status bar', () => {
      const state = createInitialTuiState();

      let current = state.focusedPane;
      const visited = [current];

      for (let i = 0; i < 5; i++) {
        current = nextFocusablePane(current, { includeSidebar: state.sidebar.isVisible });
        visited.push(current);
      }

      // Status should never appear
      expect(visited).not.toContain('status');

      // Should only see sidebar, transcript, input
      const uniquePanes = new Set(visited);
      expect(uniquePanes.size).toBe(3);
      expect(uniquePanes).toContain('sidebar');
      expect(uniquePanes).toContain('transcript');
      expect(uniquePanes).toContain('input');
    });
  });

  describe('Transcript scrolling', () => {
    test('PgUp scrolls transcript even when transcript is not focused', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.transcript.viewport.scrollOffset = 20;
      state.transcript.viewport.totalLines = 100;

      const event = makeKey({ name: 'pageup' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-up');

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(10);
    });

    test('Up arrow scrolls transcript up when transcript focused', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 10;
      state.transcript.viewport.totalLines = 100;

      const event = makeKey({ name: 'up' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-up');
      if (action.type === 'scroll-up') {
        expect(action.lines).toBe(1);
      }

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(9);
    });

    test('Down arrow scrolls transcript down when transcript focused', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 5;
      state.transcript.viewport.totalLines = 100;

      const event = makeKey({ name: 'down' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-down');

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(6);
    });

    test('PgUp scrolls transcript by multiple lines', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 20;
      state.transcript.viewport.totalLines = 100;

      const event = makeKey({ name: 'pageup' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-up');
      if (action.type === 'scroll-up') {
        expect(action.lines).toBe(10);
      }

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(10);
    });

    test('PgDn scrolls transcript down by multiple lines', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 5;
      state.transcript.viewport.totalLines = 100;

      const event = makeKey({ name: 'pagedown' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-down');
      if (action.type === 'scroll-down') {
        expect(action.lines).toBe(10);
      }

      const newState = applyKeyAction(state, action);
      expect(newState.transcript.viewport.scrollOffset).toBe(15);
    });

    test('scroll up stops at offset 0', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.viewport.scrollOffset = 0;

      const event = makeKey({ name: 'up' });
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.transcript.viewport.scrollOffset).toBe(0);
    });
  });

  describe('Input pane Up/Down behavior', () => {
    test('Up arrow navigates history when input is empty', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.history.entries = ['command 1', 'command 2'];

      const event = makeKey({ name: 'up' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('history-up');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('command 2'); // Most recent
    });

    test('Up arrow scrolls transcript when input is empty and history is empty', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.cursorPosition = 0;
      state.input.history.entries = [];

      const event = makeKey({ name: 'up' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-up');
      if (action.type === 'scroll-up') {
        expect(action.lines).toBe(1);
      }
    });

    test('Down arrow scrolls transcript when input is empty and history is empty', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.cursorPosition = 0;
      state.input.history.entries = [];

      const event = makeKey({ name: 'down' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('scroll-down');
      if (action.type === 'scroll-down') {
        expect(action.lines).toBe(1);
      }
    });

    test('Up arrow moves cursor when input has text', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 5;

      const event = makeKey({ name: 'up' });
      const action = mapKeyToAction(event, state);

      expect(action.type).toBe('cursor-left');
    });

    test('Up arrow does not start history when cursor is not at position 0', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.cursorPosition = 2;
      state.input.history.entries = ['command 1', 'command 2'];

      const event = makeKey({ name: 'up' });
      const action = mapKeyToAction(event, state);

      expect(action.type).toBe('cursor-left');
    });

    test('history navigation continues after first recall even if cursor moved', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'command 2';
      state.input.cursorPosition = 3;
      state.input.history.entries = ['command 1', 'command 2'];
      state.input.history.currentIndex = 1;

      const event = makeKey({ name: 'up' });
      const action = mapKeyToAction(event, state);

      expect(action.type).toBe('history-up');
    });

    test('Down arrow navigates history forward when navigating', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.history.entries = ['command 1', 'command 2'];
      state.input.history.currentIndex = 0;

      const event = makeKey({ name: 'down' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('history-down');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('command 2');
    });

    test('Down arrow moves cursor when input has text', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 0;

      const event = makeKey({ name: 'down' });
      const action = mapKeyToAction(event, state);

      expect(action.type).toBe('cursor-right');
    });

    test('history navigation fills input with selected entry', () => {
      let state = createInitialTuiState();
      state = addToInputHistory(state, 'first command');
      state = addToInputHistory(state, 'second command');

      state.input.text = '';
      state.focusedPane = 'input';

      // Press up - should get most recent
      const event1 = makeKey({ name: 'up' });
      const action1 = mapKeyToAction(event1, state);
      state = applyKeyAction(state, action1);
      expect(state.input.text).toBe('second command');

      // Press up again - should get older
      const event2 = makeKey({ name: 'up' });
      const action2 = mapKeyToAction(event2, state);
      state = applyKeyAction(state, action2);
      expect(state.input.text).toBe('first command');
    });
  });

  describe('Text input handling', () => {
    test('printable characters are added to input', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';
      state.input.cursorPosition = 0;

      const event = makeKey({ name: 'a' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('input-text');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('a');
      expect(newState.input.cursorPosition).toBe(1);
    });

    test('uppercase characters are accepted when shift is held', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';

      const event = makeKey({ name: 'a', shift: true, sequence: 'A' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('input-text');
      if (action.type === 'input-text') {
        expect(action.text).toBe('A');
      }

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('A');
      expect(newState.input.cursorPosition).toBe(1);
    });

    test('characters are inserted at cursor position', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'helo';
      state.input.cursorPosition = 3;

      const event = makeKey({ name: 'l' });
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.input.text).toBe('hello');
      expect(newState.input.cursorPosition).toBe(4);
    });

    test('cursor left/right navigation', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 3;

      // Move left
      const leftEvent = makeKey({ name: 'left' });
      const leftAction = mapKeyToAction(leftEvent, state);
      const leftState = applyKeyAction(state, leftAction);
      expect(leftState.input.cursorPosition).toBe(2);

      // Move right
      const rightEvent = makeKey({ name: 'right' });
      const rightAction = mapKeyToAction(rightEvent, state);
      const rightState = applyKeyAction(leftState, rightAction);
      expect(rightState.input.cursorPosition).toBe(3);
    });

    test('cursor stops at text boundaries', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hi';
      state.input.cursorPosition = 0;

      // Try to move left from position 0
      const leftEvent = makeKey({ name: 'left' });
      const leftAction = mapKeyToAction(leftEvent, state);
      const leftState = applyKeyAction(state, leftAction);
      expect(leftState.input.cursorPosition).toBe(0);

      // Move to end
      state.input.cursorPosition = 2;

      // Try to move right from end
      const rightEvent = makeKey({ name: 'right' });
      const rightAction = mapKeyToAction(rightEvent, state);
      const rightState = applyKeyAction(state, rightAction);
      expect(rightState.input.cursorPosition).toBe(2);
    });
  });

  describe('Backspace and Delete', () => {
    test('backspace removes character before cursor', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 5;

      const event = makeKey({ name: 'backspace' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('backspace');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('hell');
      expect(newState.input.cursorPosition).toBe(4);
    });

    test('backspace at position 0 does nothing', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 0;

      const event = makeKey({ name: 'backspace' });
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.input.text).toBe('hello');
      expect(newState.input.cursorPosition).toBe(0);
    });

    test('delete removes character at cursor', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 0;

      const event = makeKey({ name: 'delete' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('delete');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('ello');
      expect(newState.input.cursorPosition).toBe(0);
    });

    test('delete at end of text does nothing', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 5;

      const event = makeKey({ name: 'delete' });
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.input.text).toBe('hello');
    });
  });

  describe('Submit handling', () => {
    test('Enter triggers submit action', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';

      const event = makeKey({ name: 'enter' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('submit');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('');
      expect(newState.input.cursorPosition).toBe(0);
    });

    test('Shift+Enter inserts newline instead of submitting', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'hello';
      state.input.cursorPosition = 5;

      const event = makeKey({ name: 'enter', shift: true });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('insert-newline');

      const newState = applyKeyAction(state, action);
      expect(newState.input.text).toBe('hello\n');
      expect(newState.input.cursorPosition).toBe(6);
      expect(newState.input.history.entries).toHaveLength(0);
    });

    test('submit adds text to history', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = 'test command';

      const event = makeKey({ name: 'enter' });
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.input.history.entries).toContain('test command');
    });

    test('submit with empty text does not add to history', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '';

      const event = makeKey({ name: 'enter' });
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.input.history.entries).toHaveLength(0);
    });

    test('submit with whitespace-only text is ignored', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.text = '   ';
      state.input.cursorPosition = 3;

      const event = makeKey({ name: 'enter' });
      const action = mapKeyToAction(event, state);
      const newState = applyKeyAction(state, action);

      expect(newState.input.text).toBe('   ');
      expect(newState.input.history.entries).toHaveLength(0);
    });
  });

  describe('Sidebar delete shortcut', () => {
    test('backspace triggers delete action in sidebar focus', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'sidebar';

      const event = makeKey({ name: 'backspace' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('delete-session');
    });

    test('delete triggers delete action in sidebar focus', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'sidebar';

      const event = makeKey({ name: 'delete' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('delete-session');
    });
  });

  describe('Sidebar visibility toggles', () => {
    test('Ctrl+B maps to toggle-sidebar', () => {
      const state = createInitialTuiState();
      const event = makeKey({ name: 'b', ctrl: true });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('toggle-sidebar');
    });

    test('focus cycle skips sidebar when hidden', () => {
      let state = createInitialTuiState();
      state.focusedPane = 'input';

      const hideAction = mapKeyToAction(makeKey({ name: 'b', ctrl: true }), state);
      state = applyKeyAction(state, hideAction);
      expect(state.sidebar.isVisible).toBe(false);

      const nextAction = mapKeyToAction(makeKey({ name: 'tab' }), state);
      expect(nextAction.type).toBe('focus-next');

      const nextState = applyKeyAction(state, nextAction);
      expect(nextState.focusedPane).toBe('transcript');
    });

    test('uppercase S toggles sidebar sessions section', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'sidebar';

      const action = mapKeyToAction(makeKey({ name: 's', shift: true, sequence: 'S' }), state);
      expect(action.type).toBe('toggle-sessions-section');
    });

    test('uppercase M toggles sidebar metadata section', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'sidebar';

      const action = mapKeyToAction(makeKey({ name: 'm', shift: true, sequence: 'M' }), state);
      expect(action.type).toBe('toggle-metadata-section');
    });
  });

  describe('Command palette controls', () => {
    test('Ctrl+K toggles command palette on Windows/Linux', () => {
      const state = createInitialTuiState();

      const openAction = mapKeyToAction(makeKey({ name: 'k', ctrl: true }), state);
      expect(openAction.type).toBe('toggle-command-palette');

      const opened = applyKeyAction(state, openAction);
      expect(opened.commandPalette.isOpen).toBe(true);

      const closeAction = mapKeyToAction(makeKey({ name: 'k', ctrl: true }), opened);
      const closed = applyKeyAction(opened, closeAction);
      expect(closed.commandPalette.isOpen).toBe(false);
    });

    test('Cmd+K toggles command palette on macOS', () => {
      const state = createInitialTuiState();

      const action = mapKeyToAction(makeKey({ name: 'k', meta: true }), state);
      const opened = applyKeyAction(state, action);

      expect(action.type).toBe('toggle-command-palette');
      expect(opened.commandPalette.isOpen).toBe(true);
    });

    test('palette search is case-insensitive and keeps alphabetical fallback', () => {
      let state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state = applyKeyAction(state, { type: 'toggle-command-palette' });

      for (const text of ['S', 'c', 'R', 'o', 'L', 'l']) {
        state = applyKeyAction(state, { type: 'palette-query', text });
      }

      expect(state.commandPalette.query).toBe('ScRoLl');
      expect(state.commandPalette.filteredActions.length).toBeGreaterThan(0);
      expect(state.commandPalette.filteredActions[0]?.label).toContain('scroll');

      const labels = state.commandPalette.filteredActions.map((action) => action.label);
      const sorted = [...labels].sort((a, b) => a.localeCompare(b));
      expect(labels).toEqual(sorted);
    });

    test('Esc dismisses palette and restores normal key handling', () => {
      let state = createInitialTuiState();
      state = applyKeyAction(state, { type: 'toggle-command-palette' });

      const escAction = mapKeyToAction(makeKey({ name: 'escape' }), state);
      expect(escAction.type).toBe('close-command-palette');

      state = applyKeyAction(state, escAction);
      expect(state.commandPalette.isOpen).toBe(false);

      const tabAction = mapKeyToAction(makeKey({ name: 'tab' }), state);
      expect(tabAction.type).toBe('focus-next');
    });

    test('palette selection uses arrow keys and wraps', () => {
      let state = createInitialTuiState();
      state = applyKeyAction(state, { type: 'toggle-command-palette' });

      const initial = state.commandPalette.selectedIndex;
      state = applyKeyAction(state, { type: 'palette-next' });
      expect(state.commandPalette.selectedIndex).toBe((initial + 1) % state.commandPalette.filteredActions.length);

      state = applyKeyAction(state, { type: 'palette-prev' });
      expect(state.commandPalette.selectedIndex).toBe(initial);
    });
  });

  describe('Startup chooser controls', () => {
    test('chooser consumes Up/Down and Enter before pane routing', () => {
      let state = createInitialTuiState();
      state = openStartupChooser(state);
      state.focusedPane = 'input';

      const downAction = mapKeyToAction(makeKey({ name: 'down' }), state);
      expect(downAction.type).toBe('startup-chooser-next');

      const upAction = mapKeyToAction(makeKey({ name: 'up' }), state);
      expect(upAction.type).toBe('startup-chooser-prev');

      const enterAction = mapKeyToAction(makeKey({ name: 'enter' }), state);
      expect(enterAction.type).toBe('startup-chooser-confirm');
    });

    test('chooser defaults to start-new and toggles selection with arrows', () => {
      let state = createInitialTuiState();
      state = openStartupChooser(state);

      expect(state.startup.chooser.selected).toBe('start-new-session');

      state = applyKeyAction(state, { type: 'startup-chooser-prev' });
      expect(state.startup.chooser.selected).toBe('resume-last-session');

      state = applyKeyAction(state, { type: 'startup-chooser-next' });
      expect(state.startup.chooser.selected).toBe('start-new-session');
    });

    test('chooser preserves navigation mappings for directional keys and tab', () => {
      let state = createInitialTuiState();
      state = openStartupChooser(state);

      expect(mapKeyToAction(makeKey({ name: 'up' }), state).type).toBe('startup-chooser-prev');
      expect(mapKeyToAction(makeKey({ name: 'left' }), state).type).toBe('startup-chooser-prev');
      expect(mapKeyToAction(makeKey({ name: 'down' }), state).type).toBe('startup-chooser-next');
      expect(mapKeyToAction(makeKey({ name: 'right' }), state).type).toBe('startup-chooser-next');
      expect(mapKeyToAction(makeKey({ name: 'tab' }), state).type).toBe('startup-chooser-next');
      expect(mapKeyToAction(makeKey({ name: 'enter' }), state).type).toBe('startup-chooser-confirm');
    });
  });

  describe('Quit handling', () => {
    test('Ctrl+Shift+C triggers transcript copy action', () => {
      const state = createInitialTuiState();
      const event = makeKey({ name: 'c', ctrl: true, shift: true });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('copy-transcript');
    });

    test('Esc triggers quit action', () => {
      const state = createInitialTuiState();
      const event = makeKey({ name: 'escape' });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('quit');

      const { action: resultAction } = handleKeyEvent(state, event);
      expect(resultAction.type).toBe('quit');
    });

    test('Ctrl+C triggers quit action', () => {
      const state = createInitialTuiState();
      const event = makeKey({ name: 'c', ctrl: true });
      const action = mapKeyToAction(event, state);
      expect(action.type).toBe('quit');
    });

    test('Ctrl+C triggers quit while startup chooser is open', () => {
      let state = createInitialTuiState();
      state = openStartupChooser(state);

      const action = mapKeyToAction(makeKey({ name: 'c', ctrl: true }), state);
      expect(action.type).toBe('quit');
    });

    test('Esc triggers quit while startup chooser is open', () => {
      let state = createInitialTuiState();
      state = openStartupChooser(state);

      const action = mapKeyToAction(makeKey({ name: 'escape' }), state);
      expect(action.type).toBe('quit');
    });
  });

  describe('handleKeyEvent convenience wrapper', () => {
    test('returns state and action together', () => {
      const state = createInitialTuiState();
      const event = makeKey({ name: 'tab' });
      const result = handleKeyEvent(state, event);

      expect(result.state.focusedPane).not.toBe(state.focusedPane);
      expect(result.action.type).toBe('focus-next');
    });
  });

  describe('Help modal', () => {
    test('? from transcript pane toggles help modal', () => {
      let state = createInitialTuiState();
      state = { ...state, focusedPane: 'transcript' };

      const action = mapKeyToAction(makeKey({ name: '?', sequence: '?' }), state);
      expect(action.type).toBe('toggle-help');
    });

    test('? from sidebar pane toggles help modal', () => {
      let state = createInitialTuiState();
      state = { ...state, focusedPane: 'sidebar' };

      const action = mapKeyToAction(makeKey({ name: '?', sequence: '?' }), state);
      expect(action.type).toBe('toggle-help');
    });

    test('? from input pane types character instead of toggling help', () => {
      const state = createInitialTuiState();
      expect(state.focusedPane).toBe('input');

      const action = mapKeyToAction(makeKey({ name: '?', sequence: '?' }), state);
      expect(action.type).toBe('input-text');
      expect((action as { type: 'input-text'; text: string }).text).toBe('?');
    });

    test('f1 toggles help modal globally (from any pane)', () => {
      for (const pane of ['input', 'transcript', 'sidebar'] as const) {
        let state = createInitialTuiState();
        state = { ...state, focusedPane: pane };

        const action = mapKeyToAction(makeKey({ name: 'f1' }), state);
        expect(action.type).toBe('toggle-help');
      }
    });

    test('Escape closes help modal when open', () => {
      let state = createInitialTuiState();
      state = { ...state, helpModal: { isOpen: true } };

      const action = mapKeyToAction(makeKey({ name: 'escape' }), state);
      expect(action.type).toBe('toggle-help');

      const newState = applyKeyAction(state, action);
      expect(newState.helpModal.isOpen).toBe(false);
    });

    test('Escape does NOT close help modal when not open (still quits)', () => {
      const state = createInitialTuiState();
      expect(state.helpModal.isOpen).toBe(false);

      const action = mapKeyToAction(makeKey({ name: 'escape' }), state);
      expect(action.type).toBe('quit');
    });

    test('other keys are noop when help modal is open', () => {
      let state = createInitialTuiState();
      state = { ...state, helpModal: { isOpen: true } };

      const action = mapKeyToAction(makeKey({ name: 'a', sequence: 'a' }), state);
      expect(action.type).toBe('noop');
    });

    test('toggle-help action toggles helpModal.isOpen via applyKeyAction', () => {
      let state = createInitialTuiState();
      expect(state.helpModal.isOpen).toBe(false);

      state = applyKeyAction(state, { type: 'toggle-help' });
      expect(state.helpModal.isOpen).toBe(true);

      state = applyKeyAction(state, { type: 'toggle-help' });
      expect(state.helpModal.isOpen).toBe(false);
    });
  });
});
