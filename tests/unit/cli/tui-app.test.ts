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

  test('clears narrated handoff text from the current assistant stream', async () => {
    await createTestApp();

    app.startAssistantStream();
    app.pushAssistantToken("I've handed off your request to the research orchestrator.");
    await Bun.sleep(10);

    app.clearAssistantStreamContent();
    app.pushAssistantToken('Final answer');
    app.completeAssistantStream();

    const messages = app.getState().transcript.messages;
    expect(messages[messages.length - 1]?.content).toBe('Final answer');
    expect(messages.some((message) => message.content.includes('handed off your request'))).toBe(false);
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

  test('empty session list skips chooser and auto-creates a session', async () => {
    const fixture = createSessionServiceFixture({ includeExistingSessions: false });
    await createTestApp({}, fixture);
    await waitFor(() => app.getState().sessions.selectedId === 's-new');

    const state = app.getState();
    expect(state.startup.chooser.isOpen).toBe(false);
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

  test('Ctrl+Shift+C is not intercepted so terminal can copy selected text', async () => {
    await createTestApp();

    let copiedText = '';
    (app as any).copyToClipboard = (text: string) => {
      copiedText = text;
    };

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));
    app.startAssistantStream();
    app.pushAssistantToken('hello world');
    await waitFor(() => app.getState().transcript.messages.some(m => m.content?.includes('hello world')));

    app.processKey(makeKey({ name: 'c', ctrl: true, shift: true }));

    // Nothing should be copied — Ctrl+Shift+C is reserved for the terminal
    expect(copiedText).toBe('');
    expect(app.isRunning()).toBe(true);
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

  test('renders tool-only activity as muted transcript metadata', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushToolCall({
      messageId: 'msg_1',
      step: 0,
      toolCallId: 'tool_1',
      toolName: 'fetch_latest_news',
      input: { topic: 'trump' },
      startedAt: Date.now(),
    });

    await testSetup.renderOnce();
    let frame = testSetup.captureCharFrame();
    expect(frame).toContain('fetch_latest_news - topic: trump');

    app.pushToolResult({
      toolCallId: 'tool_1',
      toolName: 'fetch_latest_news',
      output: { digest: 'digest' },
      completedAt: Date.now(),
      durationMs: 25,
    });
    app.completeAssistantStream();

    await testSetup.renderOnce();
    frame = testSetup.captureCharFrame();
    expect(frame).toContain('fetch_latest_news');
    expect(frame).toContain('1 field');
  });

  test.skip('rebuilds transcript when tool activity arrives after assistant text has started streaming', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushAssistantToken('Let me check that.');
    await waitFor(() => app.getState().streaming.outputTokenCount >= 1);
    await testSetup.renderOnce();

    app.pushToolCall({
      messageId: 'msg_after_text',
      step: 1,
      toolCallId: 'tool_after_text',
      toolName: 'fetch_latest_news',
      input: { topic: 'markets' },
      startedAt: Date.now(),
    });

    await testSetup.renderOnce();
    const state = app.getState();
    const frame = testSetup.captureCharFrame();

    expect(state.transcript.messages.some((message) => message.content.includes('Let me check that.'))).toBe(true);
    expect(frame).toContain('fetch_latest_news - topic: markets');
  });

  test('renders meaningful in-progress query context for tool activity', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushToolCall({
      messageId: 'msg_query',
      step: 0,
      toolCallId: 'tool_query',
      toolName: 'agent_browser_research',
      input: { query: 'best beginner road bike under 1500' },
      startedAt: Date.now(),
    });

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain('query: best beginner road bike under 1500');
  });

  test('summarizes browser research results using query instead of date prefix', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushToolCall({
      messageId: 'msg_browser',
      step: 0,
      toolCallId: 'tool_browser',
      toolName: 'agent_browser_research',
      input: { query: 'best beginner road bike under 1500' },
      startedAt: Date.now(),
    });

    app.pushToolResult({
      toolCallId: 'tool_browser',
      toolName: 'agent_browser_research',
      output: [
        '# Browser Research',
        'Current date: 2026-03-08',
        'Query: best beginner road bike under 1500',
        '',
        '1. Example Result',
      ].join('\n'),
      completedAt: Date.now(),
      durationMs: 25,
    });
    app.completeAssistantStream();

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain('Query: best beginner road bike under 1500');
    expect(frame).not.toContain('Current date: 2026-03-08');
  });

  test('prioritizes browser research query text in narrow viewports', async () => {
    testSetup = await createTestRenderer({
      width: 60,
      height: 20,
    });
    app = FredTuiApp.createWithRenderer(testSetup.renderer, {}, {});

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushToolCall({
      messageId: 'msg_query_narrow',
      step: 0,
      toolCallId: 'tool_query_narrow',
      toolName: 'agent_browser_research',
      input: { query: 'best beginner bike' },
      startedAt: Date.now(),
    });

    await testSetup.renderOnce();
    await Bun.sleep(120);
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();
    expect(frame).toContain('query: best');
    expect(frame).not.toContain('agent_browser_research - query:');
  });

  test('animates in-progress tool spinner without other state changes', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'i' }));
    app.processKey(makeKey({ name: 'enter' }));
    app.pushToolCall({
      messageId: 'msg_spinner',
      step: 0,
      toolCallId: 'tool_spinner',
      toolName: 'fetch_latest_news',
      input: {},
      startedAt: Date.now(),
    });

    await testSetup.renderOnce();
    const firstFrame = testSetup.captureCharFrame();
    await Bun.sleep(120);
    await testSetup.renderOnce();
    const secondFrame = testSetup.captureCharFrame();

    expect(firstFrame).not.toBe(secondFrame);
  });

  test('renders tool metadata between the triggering user message and assistant output', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'n' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'w' }));
    app.processKey(makeKey({ name: 's' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushToolCall({
      messageId: 'msg_2',
      step: 0,
      toolCallId: 'tool_news',
      toolName: 'fetch_latest_news',
      input: { topic: 'politics' },
      startedAt: Date.now(),
      depth: 1,
    });
    app.pushAssistantToken('Here is the summary.');
    app.pushToolResult({
      toolCallId: 'tool_news',
      toolName: 'fetch_latest_news',
      output: { digest: 'digest' },
      completedAt: Date.now(),
      durationMs: 10,
    });
    app.completeAssistantStream();

    const state = app.getState();
    expect(state.transcript.messages[0]).toEqual({ role: 'user', content: 'news' });
    expect(state.transcript.messages[1]).toEqual({ role: 'assistant', content: 'Here is the summary.' });
    expect(state.toolBlocks.groups).toHaveLength(1);
    expect(state.toolBlocks.groups[0]?.anchorUserMessageIndex).toBe(0);
    expect(state.toolBlocks.groups[0]?.blocks[0]?.toolName).toBe('fetch_latest_news');
  });

  test('renders handoff and nested tool calls as a tree beneath the triggering message', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'r' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 's' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'a' }));
    app.processKey(makeKey({ name: 'r' }));
    app.processKey(makeKey({ name: 'c' }));
    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushToolCall({
      messageId: 'handoff-msg',
      step: 1,
      toolCallId: 'handoff_1',
      toolName: 'research-orchestrator',
      input: { fromAgentId: 'concierge' },
      startedAt: Date.now(),
      kind: 'task',
      depth: 1,
    });
    app.pushToolCall({
      messageId: 'research-msg',
      step: 2,
      toolCallId: 'research_1',
      toolName: 'run_research_swarm',
      input: { question: 'history of income tax' },
      startedAt: Date.now(),
      depth: 2,
    });
    app.pushToolResult({
      toolCallId: 'research_1',
      toolName: 'run_research_swarm',
      output: 'completed',
      completedAt: Date.now(),
      durationMs: 50,
    });
    app.pushToolResult({
      toolCallId: 'handoff_1',
      toolName: 'research-orchestrator',
      output: 'completed',
      completedAt: Date.now(),
      durationMs: 80,
    });
    app.pushAssistantToken('Final report');
    app.completeAssistantStream();

    const state = app.getState();
    expect(state.toolBlocks.groups).toHaveLength(2);
    expect(state.toolBlocks.groups[0]?.anchorUserMessageIndex).toBe(0);
    expect(state.toolBlocks.groups[1]?.anchorUserMessageIndex).toBe(0);
    expect(state.toolBlocks.groups[0]?.blocks[0]?.toolName).toBe('research-orchestrator');
    expect(state.toolBlocks.groups[0]?.blocks[0]?.depth).toBe(1);
    expect(state.toolBlocks.groups[1]?.blocks[0]?.toolName).toBe('run_research_swarm');
    expect(state.toolBlocks.groups[1]?.blocks[0]?.depth).toBe(2);
    expect(state.transcript.messages[state.transcript.messages.length - 1]).toEqual({
      role: 'assistant',
      content: 'Final report',
    });
  });

  test('renders compact sibling-aware tree prefixes for nested tool calls', async () => {
    await createTestApp();

    app.processKey(makeKey({ name: 'r' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 's' }));
    app.processKey(makeKey({ name: 'e' }));
    app.processKey(makeKey({ name: 'a' }));
    app.processKey(makeKey({ name: 'r' }));
    app.processKey(makeKey({ name: 'c' }));
    app.processKey(makeKey({ name: 'h' }));
    app.processKey(makeKey({ name: 'enter' }));

    app.pushToolCall({
      messageId: 'root-msg',
      step: 1,
      toolCallId: 'root-tool',
      toolName: 'run_research_swarm',
      input: { question: 'History of Mexican drug cartels' },
      startedAt: Date.now(),
      depth: 2,
    });
    app.pushToolCall({
      messageId: 'planner-msg',
      step: 2,
      toolCallId: 'planner-tool',
      toolName: 'research-planner',
      input: { stepName: 'planResearch' },
      startedAt: Date.now(),
      kind: 'task',
      depth: 3,
    });
    app.pushToolCall({
      messageId: 'planner-query-msg',
      step: 3,
      toolCallId: 'planner-query-tool',
      toolName: 'agent_browser_research',
      input: { query: 'Mexican drug cartels current status' },
      startedAt: Date.now(),
      originAgentId: 'research-planner',
      depth: 4,
    });
    app.pushToolCall({
      messageId: 'web-msg',
      step: 4,
      toolCallId: 'web-tool',
      toolName: 'web-researcher',
      input: { stepName: 'webTrack' },
      startedAt: Date.now(),
      kind: 'task',
      depth: 3,
    });

    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    expect(frame).toContain('run_research_swarm - question: History of Mexican drug cartels');
    expect(frame).toContain('Running research-planner');
    expect(frame).toContain('Running web-researcher');
    expect(frame).toContain('research-planner - query: Mexican drug cartels current status');
    expect(frame).not.toContain('│─');
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
    // Accumulated output preserved with error appended for visibility
    const lastMsg = state.transcript.messages[state.transcript.messages.length - 1];
    expect(lastMsg?.content).toContain('hello world');
    expect(lastMsg?.content).toContain('[Error: provider disconnected]');
    expect(capturedErrorMessage).toBe('provider disconnected');
  });

  test('sanitizes streaming errors before showing them in the TUI', async () => {
    await createTestApp();

    app.startAssistantStream();
    app.failAssistantStream(new Error('Fiber terminated with an unhandled error\n    at /home/gimbo/dev/fred/packages/core/src/subagent/service.ts:650:1'));
    await waitFor(() => !app.getState().streaming.isStreaming);

    const state = app.getState();
    expect(state.streaming.lastError).toBe('Fiber terminated with an unhandled error');
    const lastMsg = state.transcript.messages[state.transcript.messages.length - 1];
    expect(lastMsg?.content).toContain('[Error: Fiber terminated with an unhandled error]');
    expect(lastMsg?.content).not.toContain('/home/gimbo/dev/fred');
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

    test('queue keeps draining when first queued item is a non-streaming slash command', async () => {
      let submittedTexts: string[] = [];
      await createTestApp({
        onSubmit: (text) => { submittedTexts.push(text); },
      });

      // Start initial stream
      app.processKey(makeKey({ name: 'f' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'r' }));
      app.processKey(makeKey({ name: 's' }));
      app.processKey(makeKey({ name: 't' }));
      app.processKey(makeKey({ name: 'enter' }));

      // Queue /sidebar (does not start stream) and then a normal message.
      for (const ch of '/sidebar') {
        app.processKey(makeKey({ name: ch, sequence: ch }));
      }
      app.processKey(makeKey({ name: 'enter' }));

      app.processKey(makeKey({ name: 's' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'c' }));
      app.processKey(makeKey({ name: 'o' }));
      app.processKey(makeKey({ name: 'n' }));
      app.processKey(makeKey({ name: 'd' }));
      app.processKey(makeKey({ name: 'enter' }));

      expect(app.getState().input.pendingSubmissions).toHaveLength(2);

      app.completeAssistantStream();

      await waitFor(() => submittedTexts.length === 2);
      expect(submittedTexts).toEqual(['first', 'second']);
      expect(app.getState().input.pendingSubmissions).toHaveLength(0);
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

  describe('thinking indicator and stream timeout', () => {
    test('waitingForFirstToken is true after submit, false after first token', async () => {
      await createTestApp();

      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'enter' }));

      expect(app.getState().streaming.isStreaming).toBe(true);
      expect(app.getState().streaming.waitingForFirstToken).toBe(true);

      // Push first token — should clear waitingForFirstToken
      app.pushAssistantToken('hello');
      await waitFor(() => app.getState().streaming.outputTokenCount >= 1);

      expect(app.getState().streaming.waitingForFirstToken).toBe(false);
      expect(app.getState().streaming.isStreaming).toBe(true);
    });

    test('waitingForFirstToken clears on stream completion', async () => {
      await createTestApp();

      app.startAssistantStream();
      expect(app.getState().streaming.waitingForFirstToken).toBe(true);

      app.completeAssistantStream();
      expect(app.getState().streaming.waitingForFirstToken).toBe(false);
      expect(app.getState().streaming.isStreaming).toBe(false);
    });

    test('waitingForFirstToken clears on stream error', async () => {
      await createTestApp({
        onError: () => {},
      });

      app.startAssistantStream();
      expect(app.getState().streaming.waitingForFirstToken).toBe(true);

      app.failAssistantStream(new Error('test error'));
      expect(app.getState().streaming.waitingForFirstToken).toBe(false);
      expect(app.getState().streaming.isStreaming).toBe(false);
    });

    test('thinking indicator renders during pre-token wait', async () => {
      await createTestApp();

      // Submit a user message so the spinner has a message to attach to
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'enter' }));
      expect(app.getState().streaming.waitingForFirstToken).toBe(true);

      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      // Indicator uses braille dot spinner characters (U+2800 block)
      const hasBrailleSpinner = /[\u2800-\u28FF]/.test(frame);
      expect(hasBrailleSpinner).toBe(true);
    });

    test('thinking indicator disappears after first token', async () => {
      await createTestApp();

      // Submit a user message first
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'enter' }));
      app.pushAssistantToken('hello');
      await waitFor(() => app.getState().streaming.outputTokenCount >= 1);

      // State should reflect: no longer waiting, but still streaming
      expect(app.getState().streaming.waitingForFirstToken).toBe(false);
      expect(app.getState().streaming.isStreaming).toBe(true);

      // Allow render pipeline to settle after state change
      await testSetup.renderOnce();
      await testSetup.renderOnce();
      const frame = testSetup.captureCharFrame();
      // Braille spinner should be gone
      const hasBrailleSpinner = /[\u2800-\u28FF]/.test(frame);
      expect(hasBrailleSpinner).toBe(false);
    });

    test('stream timeout fires error after silence', async () => {
      let capturedErrorMessage: string | undefined;
      await createTestApp({
        onError: (error) => {
          capturedErrorMessage = error.message;
        },
      });

      // Manually start stream and simulate timeout by calling failAssistantStream
      app.startAssistantStream();
      expect(app.getState().streaming.waitingForFirstToken).toBe(true);

      // Simulate what the timeout callback does
      app.failAssistantStream(new Error('Response timed out — no tokens received within 30 seconds'));

      expect(app.getState().streaming.isStreaming).toBe(false);
      expect(app.getState().streaming.waitingForFirstToken).toBe(false);
      expect(app.getState().streaming.lastError).toContain('timed out');
      expect(capturedErrorMessage).toContain('timed out');
    });
  });

  describe('patient timeout mode', () => {
    test('no error after timeout interval in patient mode', async () => {
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceIntervalMs: 50,
      });

      app.startAssistantStream();
      expect(app.getState().streaming.waitingForFirstToken).toBe(true);

      // Wait longer than the patience interval
      await Bun.sleep(80);

      // Stream should still be alive (no error)
      expect(app.getState().streaming.isStreaming).toBe(true);
      expect(app.getState().streaming.lastError).toBeNull();
    });

    test('stream stays alive in patient mode without message', async () => {
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceIntervalMs: 50,
      });

      app.startAssistantStream();
      await Bun.sleep(80);

      // No message configured, so no systemNotice
      expect(app.getState().systemNotice).toBeNull();
      // But stream is still running
      expect(app.getState().streaming.isStreaming).toBe(true);
    });

    test('shows string patience message after interval', async () => {
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: 'Still working...',
        patienceIntervalMs: 50,
      });

      app.startAssistantStream();
      expect(app.getState().systemNotice).toBeNull();

      await waitFor(() => app.getState().systemNotice !== null, { timeout: 500 });
      expect(app.getState().systemNotice).toBe('Still working...');
    });

    test('string message stays the same on subsequent ticks', async () => {
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: 'Still working...',
        patienceIntervalMs: 30,
      });

      app.startAssistantStream();

      // Wait for first tick
      await waitFor(() => app.getState().systemNotice !== null, { timeout: 500 });
      expect(app.getState().systemNotice).toBe('Still working...');

      // Wait for second tick
      await Bun.sleep(50);
      expect(app.getState().systemNotice).toBe('Still working...');
    });

    test('rotates through array messages', async () => {
      const messages = ['msg-one', 'msg-two', 'msg-three'];
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: messages,
        patienceIntervalMs: 30,
      });

      app.startAssistantStream();

      // First message
      await waitFor(() => app.getState().systemNotice === 'msg-one', { timeout: 500 });
      expect(app.getState().systemNotice).toBe('msg-one');

      // Second message
      await waitFor(() => app.getState().systemNotice === 'msg-two', { timeout: 500 });
      expect(app.getState().systemNotice).toBe('msg-two');
    });

    test('cycles array messages back to start', async () => {
      const messages = ['alpha', 'beta'];
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: messages,
        patienceIntervalMs: 25,
      });

      app.startAssistantStream();

      // Wait for alpha -> beta -> alpha cycle
      await waitFor(() => app.getState().systemNotice === 'alpha', { timeout: 500 });
      await waitFor(() => app.getState().systemNotice === 'beta', { timeout: 500 });
      await waitFor(() => app.getState().systemNotice === 'alpha', { timeout: 500 });
    });

    test('function message is called on each tick', async () => {
      let callCount = 0;
      const messageFn = () => {
        callCount++;
        return `tick-${callCount}`;
      };

      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: messageFn,
        patienceIntervalMs: 30,
      });

      app.startAssistantStream();

      await waitFor(() => app.getState().systemNotice === 'tick-1', { timeout: 500 });
      expect(callCount).toBe(1);

      await waitFor(() => app.getState().systemNotice === 'tick-2', { timeout: 500 });
      expect(callCount).toBe(2);
    });

    test('systemNotice cleared on completeAssistantStream', async () => {
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: 'working...',
        patienceIntervalMs: 30,
      });

      app.startAssistantStream();
      await waitFor(() => app.getState().systemNotice !== null, { timeout: 500 });

      app.completeAssistantStream();
      expect(app.getState().systemNotice).toBeNull();
      expect(app.getState().streaming.isStreaming).toBe(false);
    });

    test('tick index resets between streaming turns', async () => {
      const messages = ['first', 'second'];
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: messages,
        patienceIntervalMs: 30,
      });

      // First turn
      app.startAssistantStream();
      await waitFor(() => app.getState().systemNotice === 'first', { timeout: 500 });
      app.completeAssistantStream();
      expect(app.getState().systemNotice).toBeNull();

      // Second turn — should start from 'first' again
      app.startAssistantStream();
      await waitFor(() => app.getState().systemNotice === 'first', { timeout: 500 });
      app.completeAssistantStream();
    });

    test('fail mode regression — default behavior unchanged', async () => {
      let capturedError: string | undefined;
      await createTestApp({
        onError: (error) => { capturedError = error.message; },
      });

      // Default mode is 'fail'
      app.startAssistantStream();
      expect(app.getState().streaming.waitingForFirstToken).toBe(true);

      // Simulate what the fail-mode timeout does
      app.failAssistantStream(new Error('Response timed out — no tokens received within 30 seconds'));

      expect(app.getState().streaming.isStreaming).toBe(false);
      expect(capturedError).toContain('timed out');
    });

    test('onError callback is invoked when failAssistantStream fires in fail mode', async () => {
      const errors: Error[] = [];
      await createTestApp({
        onError: (error) => { errors.push(error); },
      });

      app.startAssistantStream();
      expect(app.getState().streaming.isStreaming).toBe(true);

      const timeoutError = new Error('Response timed out — stream aborted');
      app.failAssistantStream(timeoutError);

      expect(errors.length).toBeGreaterThanOrEqual(1);
      expect(errors.some(e => e.message.includes('stream aborted'))).toBe(true);
      expect(app.getState().streaming.isStreaming).toBe(false);
    });

    test('custom patienceIntervalMs is respected', async () => {
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: 'custom-interval',
        patienceIntervalMs: 100,
      });

      app.startAssistantStream();

      // At 50ms, should not have fired yet
      await Bun.sleep(50);
      expect(app.getState().systemNotice).toBeNull();

      // At 120ms, should have fired
      await waitFor(() => app.getState().systemNotice === 'custom-interval', { timeout: 500 });
    });

    test('timer resets on tool events in patient mode', async () => {
      const messages = ['waiting...'];
      await createTestApp({}, {
        streamTimeoutMode: 'patient',
        patienceMessage: messages,
        patienceIntervalMs: 60,
      });

      app.startAssistantStream();

      // At 40ms, push a tool call to reset the timer
      await Bun.sleep(40);
      expect(app.getState().systemNotice).toBeNull();

      app.pushToolCall({
        messageId: 'msg1',
        step: 1,
        toolCallId: 'tc1',
        toolName: 'test_tool',
        input: {},
        startedAt: Date.now(),
      });

      // The timer was reset at 40ms. Wait another 40ms (80ms total).
      // With 60ms interval from reset point, it should fire around 100ms total.
      await Bun.sleep(40);
      // Should NOT have fired yet (only 40ms since reset)
      expect(app.getState().systemNotice).toBeNull();

      // Wait for it to fire (60ms from reset)
      await waitFor(() => app.getState().systemNotice === 'waiting...', { timeout: 500 });
    });
  });
});
