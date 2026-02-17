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

    // Should contain focus status
    expect(frame).toContain('Focus: input');
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

    // Render and verify status reflects current focus
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain('Focus: input');
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

    // Seed transcript with enough lines to scroll.
    for (let i = 0; i < 40; i += 1) {
      app.processKey(makeKey({ name: 'x' }));
      app.processKey(makeKey({ name: 'enter' }));
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

  test('status telemetry is throttled during active streaming and clears indicator when idle', async () => {
    await createTestApp();

    const getStatusContent = (): string => {
      return String((app as unknown as { lastStatusLine?: string }).lastStatusLine ?? '');
    };

    app.startAssistantStream();
    app.pushAssistantToken('a');
    const firstStreamingLine = getStatusContent();

    await Bun.sleep(30);
    app.pushAssistantToken('b');
    const secondStreamingLine = getStatusContent();

    expect(firstStreamingLine).toContain('streaming');
    expect(secondStreamingLine).toBe(firstStreamingLine);

    await Bun.sleep(120);
    app.pushAssistantToken('c');
    await waitFor(() => getStatusContent() !== firstStreamingLine);
    const thirdStreamingLine = getStatusContent();
    expect(thirdStreamingLine).not.toBe(firstStreamingLine);

    app.completeAssistantStream();
    const idleLine = getStatusContent();
    expect(idleLine.includes('streaming')).toBe(false);
    expect(idleLine).toContain('cost $');
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
});
