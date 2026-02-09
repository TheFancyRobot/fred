import { describe, expect, test } from 'bun:test';
import type { TuiState } from '../../../../packages/cli/src/tui/state.js';
import {
  applySessionDeletion,
  closeDeleteConfirm,
  createInitialTuiState,
  createTranscriptState,
  openDeleteConfirm,
} from '../../../../packages/cli/src/tui/state.js';

function createSession(id: string, updatedAt: string): TuiState['sessions']['items'][number] {
  return {
    id,
    title: id.toUpperCase(),
    updatedAt: new Date(updatedAt),
    messageCount: 1,
    preview: 'preview',
    unread: false,
  };
}

describe('TUI session deletion', () => {
  test('delete confirmation lifecycle opens and closes', () => {
    let state = createInitialTuiState();
    state = {
      ...state,
      sessions: {
        ...state.sessions,
        items: [createSession('s1', '2026-02-08T12:00:00Z')],
        selectedId: 's1',
      },
    };

    state = openDeleteConfirm(state, 's1');
    expect(state.deleteConfirm.isOpen).toBe(true);
    expect(state.deleteConfirm.sessionId).toBe('s1');

    state = closeDeleteConfirm(state);
    expect(state.deleteConfirm.isOpen).toBe(false);
    expect(state.deleteConfirm.sessionId).toBe(null);
  });

  test('deleting active session selects most recent remaining', () => {
    let state = createInitialTuiState();
    state = {
      ...state,
      transcript: createTranscriptState([{ role: 'user', content: 'hi' }], 10, true),
      sessions: {
        ...state.sessions,
        items: [
          createSession('s1', '2026-02-08T10:00:00Z'),
          createSession('s2', '2026-02-08T12:00:00Z'),
          createSession('s3', '2026-02-08T11:00:00Z'),
        ],
        selectedId: 's1',
        drafts: {
          s1: 'draft one',
          s2: 'draft two',
        },
      },
    };

    state = applySessionDeletion(state, [
      createSession('s2', '2026-02-08T12:00:00Z'),
      createSession('s3', '2026-02-08T11:00:00Z'),
    ], { selectedId: 's2' });

    expect(state.sessions.selectedId).toBe('s2');
    expect(state.sessions.drafts.s1).toBeUndefined();
    expect(state.sessions.drafts.s2).toBe('draft two');
    expect(state.transcript.messages.length).toBe(0);
  });

  test('deleting last session leaves empty sidebar and transcript', () => {
    let state = createInitialTuiState();
    state = {
      ...state,
      transcript: createTranscriptState([{ role: 'assistant', content: 'hello' }], 10, true),
      sessions: {
        ...state.sessions,
        items: [createSession('s1', '2026-02-08T10:00:00Z')],
        selectedId: 's1',
        drafts: {
          s1: 'draft one',
        },
      },
    };

    state = applySessionDeletion(state, [], { selectedId: null });

    expect(state.sessions.items.length).toBe(0);
    expect(state.sessions.selectedId).toBe(null);
    expect(state.sessions.drafts.s1).toBeUndefined();
    expect(state.transcript.messages.length).toBe(0);
  });
});
