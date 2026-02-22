import { describe, expect, test } from 'bun:test';
import {
  renderInputContent,
  renderSidebarContent,
  renderTranscriptContent,
  renderStatusContent,
  buildStatusBadges,
  DEFAULT_LAYOUT,
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

    test('has 5-line max visible input lines', () => {
      expect(DEFAULT_LAYOUT.inputMaxVisibleLines).toBe(5);
    });

    test('has zero region gap for flush transcript/input boundary', () => {
      expect(DEFAULT_LAYOUT.regionGap).toBe(0);
    });
  });

  describe('Pane content rendering', () => {
    test('renders sidebar with empty state', () => {
      const state = createInitialTuiState();
      const content = renderSidebarContent(state, false);

      expect(content.lines).toContain('▼ Sessions');
      expect(content.lines).toContain('  (empty)');
      expect(content.lines).toContain('▸ + New Session (Enter)');
      expect(content.lines).not.toContain('(empty)');
      expect(content.metadataHeader).toBe('▼ Metadata');
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

      expect(content.lines).toContain('▼ Sessions');
      expect(content.lines).toContain('  + New Session (Enter)');
      expect(content.lines.join('\n')).toContain('▸ Session 1');
      expect(content.lines.join('\n')).toContain('  12:00');
      expect(content.lines.join('\n')).toContain('  11:00');
      expect(content.metadataLines.join('\n')).toContain('Sessions: 2');
      expect(content.metadataLines.join('\n')).toContain('Model:');
      expect(content.metadataLines.join('\n')).toContain('Tokens: in');
      expect(content.metadataHeader).toBe('▼ Metadata');
    });

    test('collapsing sessions keeps metadata anchored header and avoids extra gaps', () => {
      const state = createInitialTuiState();
      state.sidebar.sections.sessionsCollapsed = true;

      const content = renderSidebarContent(state, false);

      expect(content.lines[0]).toBe('▶ Sessions');
      expect(content.lines).not.toContain('+ New Session (Enter)');
      expect(content.lines).not.toContain('  (empty)');
      expect(content.metadataHeader).toBe('▼ Metadata');
    });

    test('collapsed metadata keeps session empty state aligned', () => {
      const state = createInitialTuiState();
      state.sidebar.sections.metadataCollapsed = true;

      const content = renderSidebarContent(state, false);

      expect(content.lines).toContain('▼ Sessions');
      expect(content.lines).toContain('(empty)');
      expect(content.metadataHeader).toBe('▶ Metadata');
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

    test('renders status bar with core shortcut badges only', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';

      const content = renderStatusContent(state);

      // Core badges are always present
      expect(content.lines[0]).toContain('? Help');
      expect(content.lines[0]).toContain('Esc Quit');
      expect(content.lines[0]).toContain('Ctrl+B Sidebar');
    });

    test('status output excludes telemetry metrics', () => {
      const state = createInitialTuiState();
      state.streaming.isStreaming = true;
      state.streaming.tokensPerSecond = 42.5;
      state.streaming.firstTokenLatencyMs = 150;
      state.telemetry.model = 'claude-3';
      state.telemetry.sessionCostUsd = 0.002;

      const content = renderStatusContent(state);

      // No telemetry phrases should appear
      expect(content.lines[0]).not.toContain('tok');
      expect(content.lines[0]).not.toContain('lat');
      expect(content.lines[0]).not.toContain('cost');
      expect(content.lines[0]).not.toContain('mdl');
      expect(content.lines[0]).not.toContain('Focus:');
      expect(content.lines[0]).not.toContain('streaming');
    });

    test('buildStatusBadges returns core badges with highest priority', () => {
      const state = createInitialTuiState();
      const badges = buildStatusBadges(state);

      // Core badges
      const helpBadge = badges.find((b) => b.text === '? Help');
      const quitBadge = badges.find((b) => b.text === 'Esc Quit');
      const sidebarBadge = badges.find((b) => b.text === 'Ctrl+B Sidebar');

      expect(helpBadge).toBeDefined();
      expect(quitBadge).toBeDefined();
      expect(sidebarBadge).toBeDefined();
      expect(helpBadge?.priority).toBe(100);
      expect(quitBadge?.priority).toBe(100);
      expect(sidebarBadge?.priority).toBe(100);
    });

    test('sidebar focused shows j/k nav and session actions', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'sidebar';
      state.sessions.items = [
        {
          id: 's1',
          title: 'Test',
          updatedAt: new Date(),
          messageCount: 1,
          preview: 'test',
          unread: false,
        },
      ];
      state.sessions.selectedId = 's1';

      const badges = buildStatusBadges(state);
      const texts = badges.map((b) => b.text);

      expect(texts).toContain('j/k nav');
      expect(texts).toContain('Enter select');
      expect(texts).toContain('Del delete');
    });

    test('transcript focused shows scroll and copy badges', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.messages = [{ role: 'assistant', content: 'test' }];

      const badges = buildStatusBadges(state);
      const texts = badges.map((b) => b.text);

      expect(texts).toContain('PgUp/PgDn scroll');
      expect(texts).toContain('Ctrl+Y copy');
    });

    test('transcript focused shows no copy badge when empty', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'transcript';
      state.transcript.messages = [];

      const badges = buildStatusBadges(state);
      const texts = badges.map((b) => b.text);

      expect(texts).not.toContain('Ctrl+Y copy');
      expect(texts).toContain('PgUp/PgDn scroll');
    });

    test('input focused with slash search shows Tab complete', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.slashSearch.isActive = true;

      const badges = buildStatusBadges(state);
      const texts = badges.map((b) => b.text);

      expect(texts).toContain('Tab complete');
      expect(texts).not.toContain('Ctrl+K palette');
    });

    test('input focused without slash search shows palette shortcut', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.slashSearch.isActive = false;

      const badges = buildStatusBadges(state);
      const texts = badges.map((b) => b.text);

      expect(texts).toContain('Ctrl+K palette');
      expect(texts).not.toContain('Tab complete');
    });

    test('truncation preserves core badges at narrow widths', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';
      state.input.slashSearch.isActive = false;

      const content = renderStatusContent(state, { maxWidth: 40 });

      // Core badges must still be visible even at narrow width
      expect(content.lines[0]).toContain('? Help');
      expect(content.lines[0]).toContain('Esc Quit');
      expect(content.lines[0]).toContain('Ctrl+B Sidebar');
      // Context badge may be dropped
    });

    test('renders composer without shortcut hint suffix', () => {
      const state = createInitialTuiState();
      const content = renderInputContent(state, true, 'Type a message...');

      expect(content.lines[0]).toBe('▎ ▍Type a message...');
      expect(content.lines[0]).not.toContain('Enter send');
    });

    test('renders cursor indicator inline for input text when focused', () => {
      const state = createInitialTuiState();
      state.input.text = 'hello';
      state.input.cursorPosition = 2;

      const content = renderInputContent(state, true, 'Type a message...');
      expect(content.lines[0]).toBe('▎ he▍llo');
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

    test('degrades status output for compact widths', () => {
      const state = createInitialTuiState();
      state.focusedPane = 'input';

      const content = renderStatusContent(state, { maxWidth: 40 });
      expect(content.lines[0].length).toBeLessThanOrEqual(40);
      expect(content.lines[0].length).toBeGreaterThan(0);
    });

    test('renderStatusContent returns dim flag when overlay is active', () => {
      const state = createInitialTuiState();

      // Default: not dimmed
      const normal = renderStatusContent(state);
      expect(normal.dim).toBe(false);

      // Explicit dim: true
      const dimmed = renderStatusContent(state, { dim: true });
      expect(dimmed.dim).toBe(true);

      // Content is the same regardless of dim flag
      expect(dimmed.lines[0]).toBe(normal.lines[0]);
    });
  });

  describe('Initial focus state', () => {
    test('initial state has input pane focused', () => {
      const state = createInitialTuiState();

      expect(state.focusedPane).toBe('input');
    });
  });

  describe('Startup chooser affordance', () => {
    test('renders compact startup chooser with start-new selected by default', () => {
      const state = createInitialTuiState();
      state.startup.chooser.isOpen = true;
      state.startup.chooser.selected = 'start-new-session';

      const content = renderTranscriptContent(state, true);
      expect(content.lines[0]).toBe('[Startup: selection required]');
      expect(content.lines.join('\n')).toContain('   Resume previous session');
      expect(content.lines.join('\n')).toContain('>> Start new session');
      expect(content.lines.join('\n')).toContain('Use Up/Down to choose, Enter to continue');
    });

    test('chooser content never renders dismissible hint copy', () => {
      const state = createInitialTuiState();
      state.startup.chooser.isOpen = true;

      const content = renderTranscriptContent(state, false);
      expect(content.lines.join('\n')).not.toContain('Hint:');
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
