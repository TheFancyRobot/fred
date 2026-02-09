import { describe, expect, test } from 'bun:test';
import {
  renderInputContent,
  renderSidebarContent,
  renderTranscriptContent,
  renderStatusContent,
  DEFAULT_LAYOUT,
  STARTUP_HINT,
} from '../../../packages/cli/src/tui/layout.js';
import { createInitialTuiState } from '../../../packages/cli/src/tui/state.js';

describe('TUI Layout', () => {
  describe('Default layout config', () => {
    test('has expected sidebar width', () => {
      expect(DEFAULT_LAYOUT.sidebarWidth).toBe(30);
    });

    test('has expected input height', () => {
      expect(DEFAULT_LAYOUT.inputHeight).toBe(3);
    });

    test('has expected status height', () => {
      expect(DEFAULT_LAYOUT.statusHeight).toBe(1);
    });
  });

  describe('Pane content rendering', () => {
    test('renders sidebar with empty state', () => {
      const state = createInitialTuiState();
      const content = renderSidebarContent(state, false);

      expect(content.lines).toContain('[Sessions]');
      expect(content.lines).toContain('(empty)');
      expect(content.lines).toContain('▸ + New Session (Enter)');
    });

    test('renders sidebar with items', () => {
      const state = createInitialTuiState();
      state.sessions.items = [
        {
          id: 's1',
          title: 'Session 1',
          updatedAt: new Date('2026-02-08T12:00:00Z'),
          messageCount: 2,
          preview: 'Hello there',
          unread: false,
        },
        {
          id: 's2',
          title: 'Session 2',
          updatedAt: new Date('2026-02-08T11:00:00Z'),
          messageCount: 1,
          preview: 'Preview text',
          unread: true,
        },
      ];
      state.sessions.selectedId = 's1';
      state.sidebar.selectedIndex = 1;

      const content = renderSidebarContent(state, false);

      expect(content.lines).toContain('[Sessions]');
      expect(content.lines).toContain('  + New Session (Enter)');
      expect(content.lines.join('\n')).toContain('▸ Session 1');
      expect(content.lines.join('\n')).toContain('Session 1');
      expect(content.lines.join('\n')).toContain('Session 2');
    });

    test('highlights new session action when selected', () => {
      const state = createInitialTuiState();
      state.sidebar.selectedIndex = 0;
      state.sessions.items = [
        {
          id: 's1',
          title: 'Session 1',
          updatedAt: new Date('2026-02-08T12:00:00Z'),
          messageCount: 2,
          preview: 'Hello there',
          unread: false,
        },
      ];

      const content = renderSidebarContent(state, true);
      expect(content.lines).toContain('▸ + New Session (Enter)');
    });

    test('sidebar shows focus indicator when focused', () => {
      const state = createInitialTuiState();
      const focused = renderSidebarContent(state, true);
      const unfocused = renderSidebarContent(state, false);

      expect(focused.focusIndicator).toBe('>');
      expect(unfocused.focusIndicator).toBeUndefined();
    });

    test('renders empty transcript with welcome message', () => {
      const state = createInitialTuiState();
      const content = renderTranscriptContent(state, false);

      expect(content.lines.join(' ')).toContain('Fred AI Framework');
      expect(content.lines.join(' ')).toContain('Type a message');
    });

    test('renders transcript with messages', () => {
      const state = createInitialTuiState();
      state.transcript.messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ];

      const content = renderTranscriptContent(state, false);

      expect(content.lines.join('\n')).toContain('user:');
      expect(content.lines.join('\n')).toContain('Hello');
      expect(content.lines.join('\n')).toContain('assistant:');
      expect(content.lines.join('\n')).toContain('Hi there!');
    });

    test('renders status bar with focus indicator', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';

      const content = renderStatusContent(state);

      expect(content.lines[0]).toContain('Focus: transcript');
      expect(content.lines[0]).toContain('Esc: quit');
      expect(content.lines[0]).toContain('cost $0.0000');
      expect(content.lines[0]).toContain('tok total:0');
      expect(content.lines[0]).toContain('in:0 out:0');
    });

    test('renders composer without shortcut hint suffix', () => {
      const state = createInitialTuiState();
      const content = renderInputContent(state, true, 'Type a message...');

      expect(content.lines[0]).toBe('> Type a message...');
      expect(content.lines[0]).not.toContain('Enter send');
    });

    test('renders command palette content in sidebar mode', () => {
      const state = createInitialTuiState();
      state.commandPalette.isOpen = true;
      state.commandPalette.query = 'focus';

      const content = renderSidebarContent(state, true);
      expect(content.lines[0]).toBe('[Command Palette]');
      expect(content.lines[1]).toContain('focus');
      expect(content.lines.join('\n')).toContain('Focus Next Pane');
    });

    test('shows streaming indicator only when actively streaming', () => {
      const state = createInitialTuiState();

      state.streaming.isStreaming = true;
      state.streaming.tokensPerSecond = 42.4;
      state.streaming.firstTokenLatencyMs = 91;
      const streaming = renderStatusContent(state, { nowMs: 1_000 });
      expect(streaming.lines[0]).toContain('streaming');
      expect(streaming.lines[0]).toContain('42.4 tok/s');
      expect(streaming.lines[0]).toContain('lat 91ms');

      state.streaming.isStreaming = false;
      const idle = renderStatusContent(state, { nowMs: 1_150 });
      expect(idle.lines[0]).not.toContain('streaming');
    });

    test('degrades status output for compact widths', () => {
      const state = createInitialTuiState();
      state.streaming.isStreaming = true;
      state.streaming.tokensPerSecond = 120.2;

      const content = renderStatusContent(state, { maxWidth: 52, nowMs: 1_200 });
      expect(content.lines[0].length).toBeLessThanOrEqual(52);
      expect(content.lines[0].length).toBeGreaterThan(0);
    });
  });

  describe('Initial focus state', () => {
    test('initial state has input pane focused', () => {
      const state = createInitialTuiState();

      expect(state.focusedPane).toBe('input');
    });
  });

  describe('Startup hint', () => {
    test('startup hint is defined and informative', () => {
      expect(STARTUP_HINT).toBeTruthy();
      expect(STARTUP_HINT.toLowerCase()).toContain('tab');
      expect(STARTUP_HINT.toLowerCase()).toContain('esc');
    });
  });

  describe('Viewport scrolling behavior', () => {
    test('transcript viewport starts at offset 0', () => {
      const state = createInitialTuiState();

      expect(state.transcript.viewport.scrollOffset).toBe(0);
    });

    test('transcript viewport shows visible lines subset', () => {
      const state = createInitialTuiState();
      state.transcript.messages = Array.from({ length: 30 }, (_, i) => ({
        role: 'user',
        content: `Message ${i}`,
      }));
      state.transcript.viewport.totalLines = 90;
      state.transcript.viewport.scrollOffset = 10;

      const content = renderTranscriptContent(state, false);

      expect(content.lines.length).toBeLessThanOrEqual(state.transcript.viewport.visibleLines);
    });
  });
});
