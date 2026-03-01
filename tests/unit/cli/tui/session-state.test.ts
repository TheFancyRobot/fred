import { describe, expect, test } from 'bun:test';
import {
  createInitialTuiState,
  addSession,
  applySessionList,
  selectNextSession,
  selectPreviousSession,
  switchSession,
  createTranscriptState,
  scrollTranscript,
  upsertSessionTranscript,
  markSessionReadIfPinned,
  openStartupChooser,
  moveStartupChooserSelection,
  closeStartupChooser,
  shouldOpenStartupChooser,
} from '../../../../packages/cli/src/tui/state.js';

describe('TUI Session State', () => {
  test('switchSession preserves per-session drafts', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: 'First',
        updatedAt: new Date('2026-02-08T10:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
      {
        id: 's2',
        title: 'Second',
        updatedAt: new Date('2026-02-08T11:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
    ], 's1');

    state = {
      ...state,
      input: {
        ...state.input,
        text: 'draft for s1',
        cursorPosition: 12,
      },
    };

    state = switchSession(state, 's2');
    expect(state.input.text).toBe('');
    expect(state.sessions.drafts.s1).toBe('draft for s1');

    state = {
      ...state,
      input: {
        ...state.input,
        text: 'draft for s2',
        cursorPosition: 12,
      },
    };

    state = switchSession(state, 's1');
    expect(state.input.text).toBe('draft for s1');
    expect(state.sessions.drafts.s2).toBe('draft for s2');
  });

  test('selectNextSession and selectPreviousSession update selection', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: 'First',
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
      {
        id: 's2',
        title: 'Second',
        updatedAt: new Date('2026-02-08T11:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
      {
        id: 's3',
        title: 'Third',
        updatedAt: new Date('2026-02-08T10:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
    ], 's1');

    state = selectNextSession(state);
    expect(state.sessions.selectedId).toBe('s2');
    state = selectNextSession(state);
    expect(state.sessions.selectedId).toBe('s3');
    state = selectPreviousSession(state);
    expect(state.sessions.selectedId).toBe('s2');
  });

  test('selectPreviousSession focuses new session action', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: 'First',
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
      {
        id: 's2',
        title: 'Second',
        updatedAt: new Date('2026-02-08T11:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
    ], 's1');

    state = selectPreviousSession(state);
    expect(state.sessions.selectedId).toBe('s1');
    expect(state.sidebar.selectedIndex).toBe(0);
  });

  test('addSession auto-selects new session by default', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: 'First',
        updatedAt: new Date('2026-02-08T10:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
    ], 's1');

    state = addSession(state, {
      id: 's2',
      title: 'Second',
      updatedAt: new Date('2026-02-08T11:00:00Z'),
      messageCount: 0,
      preview: null,
      unread: false,
    });

    expect(state.sessions.selectedId).toBe('s2');
    expect(state.sidebar.selectedIndex).toBe(1);
  });

  test('upsertSessionTranscript updates message counts and preview', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: null,
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
    ], 's1');

    state = upsertSessionTranscript(state, 's1', [
      { role: 'user', content: 'Hello world' },
      { role: 'assistant', content: 'Welcome back' },
    ]);

    const session = state.sessions.items.find((item) => item.id === 's1');
    expect(session?.messageCount).toBe(2);
    expect(session?.preview).toBe('Welcome back');
    expect(session?.title).toBe('Hello world');
  });

  test('switchSession pins transcript to bottom and clears unread', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: 'First',
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: true,
      },
      {
        id: 's2',
        title: 'Second',
        updatedAt: new Date('2026-02-08T11:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: false,
      },
    ], 's2');

    state = switchSession(state, 's1');
    const session = state.sessions.items.find((item) => item.id === 's1');
    expect(state.transcript.viewport.pinnedToBottom).toBe(true);
    expect(session?.unread).toBe(false);
  });

  test('markSessionReadIfPinned clears unread when pinned to bottom', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: 'First',
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: true,
      },
    ], 's1');

    state = {
      ...state,
      transcript: createTranscriptState([], state.transcript.viewport.visibleLines, true),
    };

    state = markSessionReadIfPinned(state);
    const session = state.sessions.items.find((item) => item.id === 's1');
    expect(session?.unread).toBe(false);
  });

  test('scrollTranscript clears unread when reaching bottom', () => {
    let state = createInitialTuiState();
    state = applySessionList(state, [
      {
        id: 's1',
        title: 'First',
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 0,
        preview: null,
        unread: true,
      },
    ], 's1');

    state = {
      ...state,
      transcript: {
        ...state.transcript,
        viewport: {
          ...state.transcript.viewport,
          totalLines: 10,
          visibleLines: 5,
          scrollOffset: 4,
          pinnedToBottom: false,
        },
      },
    };

    state = scrollTranscript(state, 1);
    const session = state.sessions.items.find((item) => item.id === 's1');
    expect(state.transcript.viewport.pinnedToBottom).toBe(true);
    expect(session?.unread).toBe(false);
  });

  test('startup chooser opens with start-new selected by default', () => {
    let state = createInitialTuiState();
    state = openStartupChooser(state);

    expect(state.startup.chooser.isOpen).toBe(true);
    expect(state.startup.chooser.selected).toBe('start-new-session');
  });

  test('startup chooser selection wraps between resume and start-new', () => {
    let state = createInitialTuiState();
    state = openStartupChooser(state);

    state = moveStartupChooserSelection(state, -1);
    expect(state.startup.chooser.selected).toBe('resume-last-session');

    state = moveStartupChooserSelection(state, 1);
    expect(state.startup.chooser.selected).toBe('start-new-session');
  });

  test('startup chooser close hides chooser without changing selection', () => {
    let state = createInitialTuiState();
    state = openStartupChooser(state);
    state = moveStartupChooserSelection(state, -1);
    state = closeStartupChooser(state);

    expect(state.startup.chooser.isOpen).toBe(false);
    expect(state.startup.chooser.selected).toBe('resume-last-session');
  });

  test('startup chooser opens on interactive startup unless a session id is forced', () => {
    const sessions = [
      {
        id: 's1',
        title: 'Session',
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 1,
        preview: 'preview',
        unread: false,
      },
    ];

    expect(shouldOpenStartupChooser(sessions, null)).toBe(true);
    expect(shouldOpenStartupChooser(sessions, 's1')).toBe(false);
    // Empty session list should skip the chooser (nothing to resume)
    expect(shouldOpenStartupChooser([], null)).toBe(false);
    expect(shouldOpenStartupChooser([], 's1')).toBe(false);
  });
});
