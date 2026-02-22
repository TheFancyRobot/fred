/**
 * TUI App Integration Tests
 *
 * Tests FredTuiApp using OpenTUI's createTestRenderer for headless testing.
 * Verifies the full key→state→UI pipeline without a real terminal.
 */

import { describe, expect, test, afterEach } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { FredTuiApp } from '../../../packages/cli/src/tui/app.js';
import type { TuiAppConfig } from '../../../packages/cli/src/tui/app.js';

/**
 * Poll until a condition is met, avoiding timing-based flakiness.
 * Throws if the condition is not met within the timeout.
 */
async function waitFor(
  condition: () => boolean,
  { timeout = 2000, interval = 5 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`waitFor timed out after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

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

describe('TUI App (OpenTUI integration)', () => {
  let testSetup: Awaited<ReturnType<typeof createTestRenderer>>;
  let app: FredTuiApp;

  afterEach(() => {
    if (app && app.isRunning()) {
      app.stop();
    }
    if (testSetup) {
      try {
        testSetup.renderer.destroy();
      } catch {
        // Already destroyed
      }
    }
  });

  async function createTestApp(
    events: Parameters<typeof FredTuiApp.createWithRenderer>[1] = {},
    config: TuiAppConfig = {},
  ) {
    testSetup = await createTestRenderer({
      width: 120,
      height: 40,
    });
    app = FredTuiApp.createWithRenderer(testSetup.renderer, events, config);
    return { testSetup, app };
  }

  function createSessionServiceFixture(options: { includeExistingSessions?: boolean } = {}) {
    const includeExistingSessions = options.includeExistingSessions ?? true;
    const sessions = includeExistingSessions ? [
      {
        id: 's-latest',
        updatedAt: new Date('2026-02-14T12:00:00Z'),
        title: 'Latest',
        messageCount: 1,
        preview: 'latest preview',
        agent: { id: 'default', name: 'default' },
      },
      {
        id: 's-older',
        updatedAt: new Date('2026-02-14T10:00:00Z'),
        title: 'Older',
        messageCount: 1,
        preview: 'older preview',
        agent: { id: 'default', name: 'default' },
      },
    ] : [];

    const transcripts: Record<string, Array<{ role: string; content: string }>> = {
      's-latest': [{ role: 'assistant', content: 'Welcome back latest' }],
      's-older': [{ role: 'assistant', content: 'Welcome back older' }],
      's-new': [],
    };

    const contextManager = {
      listSessions: async () => sessions,
      generateConversationId: () => 's-new',
      getContext: async (_id: string) => ({ id: _id }),
      updateMetadata: async (_id: string, _metadata: Record<string, unknown>) => undefined,
      getSession: async (id: string) => {
        const summary = sessions.find((session) => session.id === id)
          ?? (id === 's-new'
            ? {
                id: 's-new',
                updatedAt: new Date('2026-02-14T12:30:00Z'),
                title: null,
                messageCount: 0,
                preview: null,
                agent: { id: 'default', name: 'default' },
              }
            : null);
        if (!summary) {
          return null;
        }

        return {
          summary,
          messages: (transcripts[id] ?? []).map((message) => ({
            ...message,
            timestamp: new Date(),
          })),
        };
      },
      deleteSession: async (_id: string) => undefined,
    };

    return {
      sessionService: {
        contextManager: contextManager as any,
      },
    };
  }

  test('initial render shows all panes', async () => {
    await createTestApp();
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // Should contain sidebar title
    expect(frame).toContain('▼ Sessions');

    // Should contain welcome message
    expect(frame).toContain('Fred AI Framework');

    // Should contain shortcut badges in status bar
    expect(frame).toContain('? Help');
    expect(frame).toContain('Esc Quit');
  });

  test('Tab cycles focus', async () => {
    await createTestApp();

    // Initial focus is input
    expect(app.getState().focusedPane).toBe('input');

    // Tab: input -> sidebar
    app.processKey(makeKey({ name: 'tab' }));
    expect(app.getState().focusedPane).toBe('sidebar');

    // Tab: sidebar -> transcript
    app.processKey(makeKey({ name: 'tab' }));
    expect(app.getState().focusedPane).toBe('transcript');

    // Tab: transcript -> input (wraparound)
    app.processKey(makeKey({ name: 'tab' }));
    expect(app.getState().focusedPane).toBe('input');

    // Render and verify status shows shortcut badges
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain('? Help');
    expect(frame).toContain('Esc Quit');
    expect(frame).toContain('Ctrl+B Sidebar');
  });

  test('Ctrl+B hides sidebar without losing focus', async () => {
    await createTestApp();

    expect(app.getState().focusedPane).toBe('input');
    app.processKey(makeKey({ name: 'b', ctrl: true }));

    const state = app.getState();
    expect(state.sidebar.isVisible).toBe(false);
    expect(['input', 'transcript']).toContain(state.focusedPane);
  });

  test('Shift+Tab cycles focus backward', async () => {
    await createTestApp();

    // Initial: input
    expect(app.getState().focusedPane).toBe('input');

    // Shift+Tab: input -> transcript
    app.processKey(makeKey({ name: 'tab', shift: true }));
    expect(app.getState().focusedPane).toBe('transcript');
  });

  test('typing updates input', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));

    expect(app.getState().input.text).toBe('hi');
    expect(app.getState().input.cursorPosition).toBe(2);
  });

  test('existing-session launch opens chooser with start-new selected by default', async () => {
    const fixture = createSessionServiceFixture();
    await createTestApp({}, fixture);
    await waitFor(() => app.getState().startup.chooser.isOpen);

    const state = app.getState();
    expect(state.startup.chooser.isOpen).toBe(true);
    expect(state.startup.chooser.selected).toBe('start-new-session');
  });

  test('Enter on chooser default creates new session and keeps input focus', async () => {
    const fixture = createSessionServiceFixture();
    await createTestApp({}, fixture);
    await waitFor(() => app.getState().startup.chooser.isOpen);

    app.processKey(makeKey({ name: 'enter' }));
    await waitFor(() => app.getState().sessions.selectedId === 's-new');

    const state = app.getState();
    expect(state.startup.chooser.isOpen).toBe(false);
    expect(state.sessions.selectedId).toBe('s-new');
    expect(state.focusedPane).toBe('input');
  });

  test('interactive startup with empty session list still opens chooser and Enter creates session', async () => {
    const fixture = createSessionServiceFixture({ includeExistingSessions: false });
    await createTestApp({}, fixture);
    await waitFor(() => app.getState().startup.chooser.isOpen);

    expect(app.getState().startup.chooser.isOpen).toBe(true);
    expect(app.getState().startup.chooser.selected).toBe('start-new-session');

    app.processKey(makeKey({ name: 'enter' }));
    await waitFor(() => app.getState().sessions.selectedId === 's-new');

    const state = app.getState();
    expect(state.startup.chooser.isOpen).toBe(false);
    expect(state.sessions.selectedId).toBe('s-new');
    expect(state.focusedPane).toBe('input');
  });

  test('resume chooser option routes to sidebar and can create session when none exist', async () => {
    const fixture = createSessionServiceFixture({ includeExistingSessions: false });
    await createTestApp({}, fixture);
    await waitFor(() => app.getState().startup.chooser.isOpen);

    app.processKey(makeKey({ name: 'up' }));
    app.processKey(makeKey({ name: 'enter' }));
    await waitFor(() => !app.getState().startup.chooser.isOpen);

    expect(app.getState().startup.chooser.isOpen).toBe(false);
    expect(app.getState().focusedPane).toBe('sidebar');

    app.processKey(makeKey({ name: 'enter' }));
    await waitFor(() => app.getState().sessions.selectedId === 's-new');

    const state = app.getState();
    expect(state.sessions.selectedId).toBe('s-new');
    expect(state.focusedPane).toBe('input');
  });

  test('resume option hands off to sidebar before loading transcript', async () => {
    const fixture = createSessionServiceFixture();
    await createTestApp({}, fixture);
    await waitFor(() => app.getState().startup.chooser.isOpen);

    app.processKey(makeKey({ name: 'up' }));
    app.processKey(makeKey({ name: 'enter' }));
    await waitFor(() => !app.getState().startup.chooser.isOpen);

    expect(app.getState().startup.chooser.isOpen).toBe(false);
    expect(app.getState().sessions.selectedId).toBe('s-latest');
    expect(app.getState().focusedPane).toBe('sidebar');
    expect(app.getState().transcript.messages).toHaveLength(0);

    app.processKey(makeKey({ name: 'enter' }));
    await waitFor(() => app.getState().transcript.messages.length > 0);

    const state = app.getState();
    expect(state.transcript.messages[0]?.content).toBe('Welcome back latest');
    expect(state.focusedPane).toBe('input');
  });

  test('startup chooser keeps selection required affordance while navigating options', async () => {
    const fixture = createSessionServiceFixture();
    await createTestApp({}, fixture);
    await waitFor(() => app.getState().startup.chooser.isOpen);

    expect(app.getState().startup.chooser.isOpen).toBe(true);
    expect(app.getState().startup.chooser.selected).toBe('start-new-session');

    app.processKey(makeKey({ name: 'up' }));
    expect(app.getState().startup.chooser.selected).toBe('resume-last-session');

    app.processKey(makeKey({ name: 'down' }));
    expect(app.getState().startup.chooser.selected).toBe('start-new-session');
  });

  test('Ctrl+C exits immediately while startup chooser is open', async () => {
    let quitFired = false;
    const fixture = createSessionServiceFixture();
    await createTestApp(
      {
        onQuit: () => {
          quitFired = true;
        },
      },
      fixture,
    );
    await waitFor(() => app.getState().startup.chooser.isOpen);

    const selectedBeforeQuit = app.getState().sessions.selectedId;
    expect(app.getState().startup.chooser.isOpen).toBe(true);

    app.processKey(makeKey({ name: 'c', ctrl: true }));

    expect(app.isRunning()).toBe(false);
    expect(quitFired).toBe(true);
    expect(app.getState().startup.chooser.isOpen).toBe(true);
    expect(app.getState().sessions.selectedId).toBe(selectedBeforeQuit);
  });

  test('Enter submits and clears input', async () => {
    let submitted = '';
    await createTestApp({
      onSubmit: (text) => { submitted = text; },
    });

    // Type something
    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    expect(app.getState().input.text).toBe('hi');

    // Submit
    app.processKey(makeKey({ name: 'enter' }));
    expect(app.getState().input.text).toBe('');
    expect(app.getState().input.cursorPosition).toBe(0);
    expect(submitted).toBe('hi');
    expect(app.getState().streaming.isStreaming).toBe(true);
  });

  test('typing /sidebar toggles visibility without starting stream', async () => {
    await createTestApp();

    const initialVisible = app.getState().sidebar.isVisible;

    app.processKey(makeKey({ name: '/' }));
    app.processKey(makeKey({ name: 's' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'd' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'b' }));
    app.processKey(makeKey({ name: 'a' }));
    app.processKey(makeKey({ name: 'r' }));
    app.processKey(makeKey({ name: 'enter' }));

    const state = app.getState();
    expect(state.sidebar.isVisible).toBe(!initialVisible);
    expect(state.streaming.isStreaming).toBe(false);
  });

  test('Shift+Enter creates multiline input and Enter submits full payload', async () => {
    let submitted = '';
    await createTestApp({
      onSubmit: (text) => { submitted = text; },
    });

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter', shift: true }));
    app.processKey(makeKey({ name: 't' }));
    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'r' }));
    app.processKey(makeKey({ name: 'e' }));

    expect(app.getState().input.text).toBe('hi\nthere');

    app.processKey(makeKey({ name: 'enter' }));

    const state = app.getState();
    expect(submitted).toBe('hi\nthere');
    expect(state.transcript.messages[state.transcript.messages.length - 1]).toEqual({
      role: 'user',
      content: 'hi\nthere',
    });
    expect(state.streaming.isStreaming).toBe(true);
  });

  test('whitespace-only input is ignored on submit', async () => {
    let submitCount = 0;
    await createTestApp({
      onSubmit: () => { submitCount += 1; },
    });

    app.processKey(makeKey({ name: 'space' }));
    app.processKey(makeKey({ name: 'space' }));
    app.processKey(makeKey({ name: 'space' }));
    app.processKey(makeKey({ name: 'enter' }));

    const state = app.getState();
    expect(submitCount).toBe(0);
    expect(state.transcript.messages).toHaveLength(0);
    expect(state.streaming.isStreaming).toBe(false);
    expect(state.input.text).toBe('   ');
  });

  test('backspace deletes character', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'a' }));
    app.processKey(makeKey({ name: 'b' }));
    app.processKey(makeKey({ name: 'c' }));
    expect(app.getState().input.text).toBe('abc');

    app.processKey(makeKey({ name: 'backspace' }));
    expect(app.getState().input.text).toBe('ab');
    expect(app.getState().input.cursorPosition).toBe(2);
  });

  test('backspace in sidebar opens delete confirmation', async () => {
    await createTestApp();
    const state = app.getState();
    state.focusedPane = 'sidebar';
    state.sessions.items = [
      {
        id: 's1',
        title: 'Session 1',
        updatedAt: new Date('2026-02-08T12:00:00Z'),
        messageCount: 1,
        preview: 'preview',
        unread: false,
      },
    ];
    state.sessions.selectedId = 's1';

    app.processKey(makeKey({ name: 'backspace' }));

    expect(app.getState().deleteConfirm.isOpen).toBe(true);
    expect(app.getState().deleteConfirm.sessionId).toBe('s1');
  });

  test('up arrow navigates history', async () => {
    await createTestApp();

    // Type and submit first command
    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));
    expect(app.getState().input.text).toBe('');

    // Press up to recall
    app.processKey(makeKey({ name: 'up' }));
    expect(app.getState().input.text).toBe('hi');
  });

  test('Escape triggers quit and destroy', async () => {
    let quitFired = false;
    await createTestApp({
      onQuit: () => { quitFired = true; },
    });

    expect(app.isRunning()).toBe(true);

    app.processKey(makeKey({ name: 'escape' }));

    expect(app.isRunning()).toBe(false);
    expect(quitFired).toBe(true);
  });

  test('Ctrl+Shift+C copies transcript to clipboard without quitting', async () => {
    await createTestApp();

    const copySpy = (testSetup.renderer as unknown as { copyToClipboardOSC52: (text: string) => boolean }).copyToClipboardOSC52;
    let copiedText = '';
    (testSetup.renderer as unknown as { copyToClipboardOSC52: (text: string) => boolean }).copyToClipboardOSC52 = (text: string) => {
      copiedText = text;
      return true;
    };

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));
    app.startAssistantStream();
    app.pushAssistantToken('hello world');
    await waitFor(() => app.getState().transcript.messages.some(m => m.content?.includes('hello world')));

    app.processKey(makeKey({ name: 'c', ctrl: true, shift: true }));

    expect(copiedText).toContain('user:');
    expect(copiedText).toContain('hi');
    expect(app.isRunning()).toBe(true);

    (testSetup.renderer as unknown as { copyToClipboardOSC52: (text: string) => boolean }).copyToClipboardOSC52 = copySpy;
  });

  test('mouse wheel scrolling updates transcript viewport offset', async () => {
    await createTestApp();

    // Seed transcript with enough lines to scroll by completing streams between submissions.
    for (let i = 0; i < 40; i += 1) {
      app.processKey(makeKey({ name: 'x' }));
      app.processKey(makeKey({ name: 'enter' }));
      // Complete the stream so the message is added to transcript
      app.completeAssistantStream();
    }

    (app as any).handleTranscriptMouseScroll({
      scroll: { direction: 'up', delta: 2 },
    });

    const afterUp = app.getState().transcript.viewport.scrollOffset;

    (app as any).handleTranscriptMouseScroll({
      scroll: { direction: 'down', delta: 3 },
    });

    const afterDown = app.getState().transcript.viewport.scrollOffset;
    expect(afterDown).toBeGreaterThan(afterUp);
  });

  test('Ctrl+K and Cmd+K toggle command palette', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'k', ctrl: true }));
    expect(app.getState().commandPalette.isOpen).toBe(true);

    app.processKey(makeKey({ name: 'k', ctrl: true }));
    expect(app.getState().commandPalette.isOpen).toBe(false);

    app.processKey(makeKey({ name: 'k', meta: true }));
    expect(app.getState().commandPalette.isOpen).toBe(true);
  });

  test('Esc dismisses command palette without quitting app', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'k', ctrl: true }));
    expect(app.getState().commandPalette.isOpen).toBe(true);

    app.processKey(makeKey({ name: 'escape' }));
    expect(app.getState().commandPalette.isOpen).toBe(false);
    expect(app.isRunning()).toBe(true);
  });

  test('palette action selection executes clear input command', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'y' }));
    expect(app.getState().input.text).toBe('hey');

    app.processKey(makeKey({ name: 'k', ctrl: true }));
    app.processKey(makeKey({ name: 'c' }));
    app.processKey(makeKey({ name: 'l' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'a' }));
    app.processKey(makeKey({ name: 'r' }));
    app.processKey(makeKey({ name: 'enter' }));

    expect(app.getState().commandPalette.isOpen).toBe(false);
    expect(app.getState().input.text).toBe('');
  });

  test('onStateChange fires on state updates', async () => {
    const states: any[] = [];
    await createTestApp({
      onStateChange: (state) => { states.push(state); },
    });

    app.processKey(makeKey({ name: 'tab' }));
    expect(states.length).toBeGreaterThan(0);
    expect(states[states.length - 1].focusedPane).toBe('sidebar');
  });

  test('submit immediately appends transcript and starts streaming lifecycle', async () => {
    const states: Array<ReturnType<FredTuiApp['getState']>> = [];
    await createTestApp({
      onStateChange: (state) => { states.push(state); },
    });

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));

    const state = app.getState();
    expect(state.transcript.messages).toHaveLength(1);
    expect(state.transcript.messages[0]).toEqual({ role: 'user', content: 'hi' });
    expect(state.streaming.isStreaming).toBe(true);
    expect(state.streaming.outputTokenCount).toBe(0);
    expect(states[states.length - 1]?.streaming.isStreaming).toBe(true);
  });

  test('input remains usable while assistant stream is active', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));
    expect(app.getState().streaming.isStreaming).toBe(true);

    app.processKey(makeKey({ name: 'n' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'x' }));
    app.processKey(makeKey({ name: 't' }));

    expect(app.getState().input.text).toBe('next');
    expect(app.getState().focusedPane).toBe('input');
    expect(app.getState().streaming.isStreaming).toBe(true);
  });

  test('streams assistant output incrementally under high token burst', async () => {
    await createTestApp();

    app.startAssistantStream();

    const tokens = Array.from({ length: 150 }, (_, index) => `${index % 10}`);
    for (const token of tokens) {
      app.pushAssistantToken(token);
    }

    await waitFor(() => app.getState().streaming.outputTokenCount === 150);
    app.completeAssistantStream();

    const state = app.getState();
    const lastMessage = state.transcript.messages[state.transcript.messages.length - 1];
    expect(lastMessage?.role).toBe('assistant');
    expect(lastMessage?.content).toBe(tokens.join(''));
    expect(state.streaming.outputTokenCount).toBe(150);
    expect(state.streaming.tokensPerSecond).toBeGreaterThan(0);
    expect(state.streaming.isStreaming).toBe(false);
  });

  test('records streaming errors and keeps accumulated output', async () => {
    let capturedErrorMessage: string | undefined;
    await createTestApp({
      onError: (error) => {
        capturedErrorMessage = error.message;
      },
    });

    app.startAssistantStream();
    app.pushAssistantToken('hello ');
    app.pushAssistantToken('world');
    await waitFor(() => app.getState().streaming.outputTokenCount === 2);
    app.failAssistantStream(new Error('provider disconnected'));
    await waitFor(() => !app.getState().streaming.isStreaming);

    const state = app.getState();
    expect(state.streaming.isStreaming).toBe(false);
    expect(state.streaming.lastError).toBe('provider disconnected');
    expect(state.streaming.outputTokenCount).toBe(2);
    expect(state.transcript.messages[state.transcript.messages.length - 1]?.content).toBe('hello world');
    expect(capturedErrorMessage).toBe('provider disconnected');
  });

  test('status bar shows shortcut badges during streaming and idle states', async () => {
    await createTestApp();

    // Idle state: render badges
    await testSetup.renderOnce();
    let frame = testSetup.captureCharFrame();
    expect(frame).toContain('? Help');
    expect(frame).toContain('Esc Quit');
    expect(frame).toContain('Ctrl+B Sidebar');
    // No telemetry strings
    expect(frame).not.toMatch(/\btok\b/i);
    expect(frame).not.toContain('cost $');

    // Start streaming — badges still shown, no telemetry
    app.startAssistantStream();
    app.pushAssistantToken('hello');
    await testSetup.renderOnce();
    frame = testSetup.captureCharFrame();
    expect(frame).toContain('? Help');
    expect(frame).toContain('Esc Quit');
    expect(frame).not.toMatch(/\btok\b/i);
    expect(frame).not.toContain('cost $');

    // Complete streaming — badges persist
    app.completeAssistantStream();
    await testSetup.renderOnce();
    frame = testSetup.captureCharFrame();
    expect(frame).toContain('? Help');
    expect(frame).toContain('Esc Quit');
    expect(frame).not.toContain('cost $');
  });

  describe('updateTelemetryModel', () => {
    test('updates model and provider in telemetry state', async () => {
      await createTestApp();

      // Initial state should have '--' defaults
      expect(app.getState().telemetry.model).toBe('--');
      expect(app.getState().telemetry.provider).toBe('--');

      // Update to real model
      app.updateTelemetryModel('claude-3-5-haiku-latest', 'anthropic');

      // Verify state updated
      expect(app.getState().telemetry.model).toBe('claude-3-5-haiku-latest');
      expect(app.getState().telemetry.provider).toBe('anthropic');
    });

    test('initial telemetry model is "--" not a real model name', async () => {
      await createTestApp();

      // Verify defaults are '--' not hardcoded model names
      expect(app.getState().telemetry.model).toBe('--');
      expect(app.getState().telemetry.provider).toBe('--');
    });

    test('triggers state change event when telemetry updated', async () => {
      let stateChangeCount = 0;
      await createTestApp({
        onStateChange: () => {
          stateChangeCount++;
        },
      });

      const initialCount = stateChangeCount;
      app.updateTelemetryModel('gpt-4o-mini', 'openai');

      // Should trigger state change
      expect(stateChangeCount).toBeGreaterThan(initialCount);
      expect(app.getState().telemetry.model).toBe('gpt-4o-mini');
      expect(app.getState().telemetry.provider).toBe('openai');
    });
  });

  describe('pending submission queue', () => {
    test('submitting while streaming queues the message', async () => {
      await createTestApp();

      // First submission starts streaming
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'enter' }));
      expect(app.getState().streaming.isStreaming).toBe(true);
      expect(app.getState().transcript.messages).toHaveLength(1);
      expect(app.getState().input.pendingSubmissions).toHaveLength(0);

      // Second submission while streaming should be queued
      app.processKey(makeKey({ name: 'n' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'x' }));
      app.processKey(makeKey({ name: 't' }));
      app.processKey(makeKey({ name: 'enter' }));

      // Queued, not added to transcript yet
      expect(app.getState().input.pendingSubmissions).toHaveLength(1);
      expect(app.getState().input.pendingSubmissions[0]?.text).toBe('next');
      expect(app.getState().transcript.messages).toHaveLength(1);
      expect(app.getState().input.text).toBe('');
    });

    test('queued submissions are auto-dispatched after stream completes', async () => {
      let submittedTexts: string[] = [];
      await createTestApp({
        onSubmit: (text) => { submittedTexts.push(text); },
      });

      // First submission
      app.processKey(makeKey({ name: 'f' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'r' }));
      app.processKey(makeKey({ name: 's' }));
      app.processKey(makeKey({ name: 't' }));
      app.processKey(makeKey({ name: 'enter' }));

      // Queue second while streaming
      app.processKey(makeKey({ name: 's' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'c' }));
      app.processKey(makeKey({ name: 'o' }));
      app.processKey(makeKey({ name: 'n' }));
      app.processKey(makeKey({ name: 'd' }));
      app.processKey(makeKey({ name: 'enter' }));

      expect(app.getState().input.pendingSubmissions).toHaveLength(1);
      expect(submittedTexts).toEqual(['first']);

      // Complete stream - should drain queue
      app.completeAssistantStream();

      await waitFor(() => app.getState().input.pendingSubmissions.length === 0);
      expect(submittedTexts).toEqual(['first', 'second']);
      expect(app.getState().streaming.isStreaming).toBe(true);
    });

    test('queued submissions drain in FIFO order', async () => {
      let submittedTexts: string[] = [];
      await createTestApp({
        onSubmit: (text) => { submittedTexts.push(text); },
      });

      // Submit first and start streaming
      app.processKey(makeKey({ name: '1' }));
      app.processKey(makeKey({ name: 'enter' }));

      // Queue multiple submissions
      app.processKey(makeKey({ name: '2' }));
      app.processKey(makeKey({ name: 'enter' }));

      app.processKey(makeKey({ name: '3' }));
      app.processKey(makeKey({ name: 'enter' }));

      app.processKey(makeKey({ name: '4' }));
      app.processKey(makeKey({ name: 'enter' }));

      expect(app.getState().input.pendingSubmissions).toHaveLength(3);
      expect(submittedTexts).toEqual(['1']);

      // Complete first stream
      app.completeAssistantStream();
      await waitFor(() => submittedTexts.length === 2);
      expect(submittedTexts[1]).toBe('2');

      // Complete second stream
      app.completeAssistantStream();
      await waitFor(() => submittedTexts.length === 3);
      expect(submittedTexts[2]).toBe('3');

      // Complete third stream
      app.completeAssistantStream();
      await waitFor(() => submittedTexts.length === 4);
      expect(submittedTexts[3]).toBe('4');
    });

    test('queued submissions drain after stream error', async () => {
      let submittedTexts: string[] = [];
      await createTestApp({
        onSubmit: (text) => { submittedTexts.push(text); },
      });

      // Submit first and start streaming
      app.processKey(makeKey({ name: 'f' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'r' }));
      app.processKey(makeKey({ name: 's' }));
      app.processKey(makeKey({ name: 't' }));
      app.processKey(makeKey({ name: 'enter' }));

      // Queue second
      app.processKey(makeKey({ name: 's' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'c' }));
      app.processKey(makeKey({ name: 'o' }));
      app.processKey(makeKey({ name: 'n' }));
      app.processKey(makeKey({ name: 'd' }));
      app.processKey(makeKey({ name: 'enter' }));

      expect(app.getState().input.pendingSubmissions).toHaveLength(1);

      // Fail stream - should still drain queue
      app.failAssistantStream(new Error('test error'));
      await waitFor(() => submittedTexts.length === 2);

      expect(submittedTexts).toEqual(['first', 'second']);
    });
  });

  describe('status bar shortcut badges', () => {
    test('core shortcuts visible in default idle state', async () => {
      await createTestApp();
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();

      expect(frame).toContain('? Help');
      expect(frame).toContain('Esc Quit');
      expect(frame).toContain('Ctrl+B Sidebar');
    });

    test('core shortcuts remain visible during active streaming', async () => {
      await createTestApp();
      app.startAssistantStream();
      app.pushAssistantToken('token');
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();

      expect(frame).toContain('? Help');
      expect(frame).toContain('Esc Quit');
      expect(frame).toContain('Ctrl+B Sidebar');
    });

    test('sidebar-focused shortcuts appear only when sidebar is focused', async () => {
      await createTestApp();

      // Focus sidebar via Tab (input → sidebar)
      app.processKey(makeKey({ name: 'tab' }));
      expect(app.getState().focusedPane).toBe('sidebar');
      await testSetup.renderOnce();
      let frame = testSetup.captureCharFrame();

      expect(frame).toContain('j/k nav');
      expect(frame).toContain('Enter select');

      // Move away from sidebar (sidebar → transcript)
      app.processKey(makeKey({ name: 'tab' }));
      expect(app.getState().focusedPane).toBe('transcript');
      await testSetup.renderOnce();
      frame = testSetup.captureCharFrame();

      expect(frame).not.toContain('j/k nav');
      expect(frame).not.toContain('Enter select');
    });

    test('transcript-focused copy badge appears only with messages', async () => {
      await createTestApp();

      // Focus transcript (input → sidebar → transcript)
      app.processKey(makeKey({ name: 'tab' }));
      app.processKey(makeKey({ name: 'tab' }));
      expect(app.getState().focusedPane).toBe('transcript');

      // No messages — no copy badge
      await testSetup.renderOnce();
      let frame = testSetup.captureCharFrame();
      expect(frame).toContain('PgUp/PgDn scroll');
      expect(frame).not.toContain('Ctrl+Y copy');

      // Add a message then re-render
      app.processKey(makeKey({ name: 'tab' })); // back to input
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'enter' }));
      app.completeAssistantStream();

      // Focus transcript again
      app.processKey(makeKey({ name: 'tab' }));
      app.processKey(makeKey({ name: 'tab' }));
      expect(app.getState().focusedPane).toBe('transcript');
      await testSetup.renderOnce();
      frame = testSetup.captureCharFrame();
      expect(frame).toContain('Ctrl+Y copy');
    });

    test('status output never includes telemetry phrases', async () => {
      await createTestApp();

      // Simulate streaming with telemetry data
      app.updateTelemetryModel('gpt-4o', 'openai');
      app.startAssistantStream();
      for (let i = 0; i < 10; i++) {
        app.pushAssistantToken(`token${i} `);
      }
      await testSetup.renderOnce();
      let frame = testSetup.captureCharFrame();

      // None of the old telemetry strings should appear
      expect(frame).not.toMatch(/\btok\/s\b/);
      expect(frame).not.toMatch(/\blat\b/);
      expect(frame).not.toContain('cost $');
      expect(frame).not.toMatch(/\bmdl\b/);
      expect(frame).not.toContain('Focus:');
      expect(frame).not.toContain('streaming');

      // Complete and check idle state too
      app.completeAssistantStream();
      await testSetup.renderOnce();
      frame = testSetup.captureCharFrame();

      expect(frame).not.toMatch(/\btok\/s\b/);
      expect(frame).not.toMatch(/\blat\b/);
      expect(frame).not.toContain('cost $');
      expect(frame).not.toMatch(/\bmdl\b/);
    });

    test('compact width keeps core badges and drops context badges', async () => {
      // Create app with narrow width (60 cols)
      testSetup = await createTestRenderer({
        width: 60,
        height: 20,
      });
      app = FredTuiApp.createWithRenderer(testSetup.renderer, {}, {});

      // Focus input — palette shortcut is a context badge
      expect(app.getState().focusedPane).toBe('input');
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();

      // Core badges must survive (may be truncated with ellipsis at extreme widths)
      expect(frame).toContain('? Help');
      expect(frame).toContain('Esc Quit');
      // Ctrl+B badge present (may be truncated depending on exact rendering width)
      expect(frame).toContain('Ctrl+B');
      // Context badge (Ctrl+K palette) should be dropped at this width
      expect(frame).not.toContain('Ctrl+K palette');
    });
  });

  describe('Help modal', () => {
    test('F1 opens help modal and Escape closes it', async () => {
      await createTestApp();

      // Initially help is closed
      expect(app.getState().helpModal.isOpen).toBe(false);
      await testSetup.renderOnce();
      let frame = testSetup.captureCharFrame();
      expect(frame).not.toContain('Keyboard Shortcuts');

      // Press F1 to open help
      app.processKey(makeKey({ name: 'f1' }));
      expect(app.getState().helpModal.isOpen).toBe(true);
      await testSetup.renderOnce();
      frame = testSetup.captureCharFrame();
      expect(frame).toContain('Keyboard Shortcuts');

      // Press Escape to close help
      app.processKey(makeKey({ name: 'escape' }));
      expect(app.getState().helpModal.isOpen).toBe(false);
      await testSetup.renderOnce();
      frame = testSetup.captureCharFrame();
      expect(frame).not.toContain('Keyboard Shortcuts');
    });

    test('help modal blocks other key actions while open', async () => {
      await createTestApp();

      // Open help
      app.processKey(makeKey({ name: 'f1' }));
      expect(app.getState().helpModal.isOpen).toBe(true);

      // Tab should not change focus while help is open
      const focusBefore = app.getState().focusedPane;
      app.processKey(makeKey({ name: 'tab' }));
      expect(app.getState().focusedPane).toBe(focusBefore);
      expect(app.getState().helpModal.isOpen).toBe(true);
    });
  });

  describe('Status badge dimming', () => {
    test('status badges dim when help modal is open', async () => {
      await createTestApp();

      // Normal state — badges are visible
      await testSetup.renderOnce();
      let frame = testSetup.captureCharFrame();
      expect(frame).toContain('? Help');

      // Open help modal
      app.processKey(makeKey({ name: 'f1' }));
      expect(app.getState().helpModal.isOpen).toBe(true);

      // Status badges still present (dimmed visually, but content unchanged)
      await testSetup.renderOnce();
      frame = testSetup.captureCharFrame();
      expect(frame).toContain('? Help');
      expect(frame).toContain('Esc Quit');
    });

    test('status badges dim when slash overlay is active', async () => {
      await createTestApp();

      // Type / to activate slash search
      expect(app.getState().focusedPane).toBe('input');
      app.processKey(makeKey({ name: '/' }));

      // Slash search should be active
      expect(app.getState().input.slashSearch.isActive).toBe(true);

      // Status badges still render (dimmed) and Tab complete appears
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      expect(frame).toContain('? Help');
      expect(frame).toContain('Tab complete');
    });
  });
});
