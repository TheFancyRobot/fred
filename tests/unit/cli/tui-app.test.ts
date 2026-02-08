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

  async function createTestApp(events: Parameters<typeof FredTuiApp.createWithRenderer>[1] = {}) {
    testSetup = await createTestRenderer({
      width: 120,
      height: 40,
    });
    app = FredTuiApp.createWithRenderer(testSetup.renderer, events);
    return { testSetup, app };
  }

  test('initial render shows all panes', async () => {
    await createTestApp();
    await testSetup.renderOnce();
    const frame = testSetup.captureCharFrame();

    // Should contain sidebar title
    expect(frame).toContain('[Sessions]');

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

    await Bun.sleep(90);
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
    await Bun.sleep(40);
    app.failAssistantStream(new Error('provider disconnected'));
    await Bun.sleep(40);

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
    await Bun.sleep(40);
    const thirdStreamingLine = getStatusContent();
    expect(thirdStreamingLine).not.toBe(firstStreamingLine);

    app.completeAssistantStream();
    const idleLine = getStatusContent();
    expect(idleLine.includes('streaming')).toBe(false);
    expect(idleLine).toContain('cost $');
  });
});
