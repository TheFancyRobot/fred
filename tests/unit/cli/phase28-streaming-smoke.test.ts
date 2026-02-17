/**
 * Phase 28 smoke tests
 *
 * End-to-end CLI/TUI checks for streaming chat flow, command palette,
 * multiline input, smart-scroll behavior, and status telemetry updates.
 *
 * All Fred/provider/TUI dependencies are injected via ChatDependencies DI
 * instead of mock.module(), preventing global module pollution.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { FredTuiApp } from '../../../packages/cli/src/tui/app';
import {
  createMockContextManager,
  createMockFredClass,
  createSmokeTestDeps,
  createStdinDouble,
  createStdoutDouble,
  restoreProcessDoubles,
} from './fixtures/fred-smoke-contract';

const mockApp = {
  stop: mock(() => {}),
  isRunning: () => true,
  getState: () => ({}),
  updateTelemetryModel: mock(() => {}),
  pushAssistantToken: mock(() => {}),
  completeAssistantStream: mock(() => {}),
  failAssistantStream: mock(() => {}),
};

const mockCreateFredTuiApp = mock(async () => mockApp);

const mockContextManager = createMockContextManager({
  generateConversationId: () => 'conv_phase28_smoke',
});
const MockFred = createMockFredClass({
  contextManager: mockContextManager,
  defaultStreamDelta: 'test',
});

/** Build DI deps for tests that exercise handleChatCommand */
function buildDeps() {
  return createSmokeTestDeps({
    FredClass: MockFred,
    createFredTuiApp: mockCreateFredTuiApp,
  });
}

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

describe('Phase 28 streaming smoke', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;
  let savedEnvVars: Record<string, string | undefined>;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalExit = process.exit;

    // Save and clear provider env vars to ensure tests use mocks
    savedEnvVars = {
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      GROQ_API_KEY: process.env.GROQ_API_KEY,
      OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    };

    // Set a fake key to satisfy detectAvailableProvider
    process.env.OPENAI_API_KEY = 'sk-test-key-for-smoke-tests';

    mockCreateFredTuiApp.mockClear();
    mockApp.pushAssistantToken.mockClear();
    mockApp.completeAssistantStream.mockClear();
    mockApp.failAssistantStream.mockClear();
  });

  afterEach(() => {
    // Restore process globals first
    restoreProcessDoubles({ stdin: originalStdin, stdout: originalStdout, exit: originalExit });

    // Restore env vars
    for (const [key, value] of Object.entries(savedEnvVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    // Reset all mock call history and restore spies
    mock.restore();
  });

  test('launches interactive TTY mode via handleChatCommand', async () => {
    const mockStdin = createStdinDouble({
      isTTY: true,
      isRaw: false,
      setRawMode: mock(() => {}),
    });
    const mockStdout = createStdoutDouble({
      isTTY: true,
      columns: 120,
      rows: 40,
    });

    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });
    (process as any).exit = mock(() => {});

    const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');

    // handleChatCommand runs Effect.never in interactive mode (keeps lifecycle
    // scope open until process.exit). Fire-and-forget and poll for the mock call.
    const chatPromise = handleChatCommand(buildDeps()).catch(() => {});

    // Wait for createFredTuiApp to be called (up to 2s)
    const deadline = Date.now() + 2000;
    while (mockCreateFredTuiApp.mock.calls.length === 0 && Date.now() < deadline) {
      await Bun.sleep(20);
    }

    expect(mockCreateFredTuiApp).toHaveBeenCalledTimes(1);
  });

  test('streams assistant output, opens palette, and preserves smart-scroll under load', async () => {
    const setup = await createTestRenderer({ width: 120, height: 40 });
    const submissions: string[] = [];
    const app = FredTuiApp.createWithRenderer(setup.renderer, {
      onSubmit: (text) => submissions.push(text),
    });

    try {
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'i' }));
      app.processKey(makeKey({ name: 'enter', shift: true }));
      app.processKey(makeKey({ name: 't' }));
      app.processKey(makeKey({ name: 'h' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'r' }));
      app.processKey(makeKey({ name: 'e' }));
      app.processKey(makeKey({ name: 'enter' }));

      expect(submissions).toEqual(['hi\nthere']);
      const afterSubmit = app.getState();
      expect(afterSubmit.transcript.messages[afterSubmit.transcript.messages.length - 1]).toEqual({
        role: 'user',
        content: 'hi\nthere',
      });
      expect(afterSubmit.streaming.isStreaming).toBe(true);

      for (let i = 0; i < 48; i += 1) {
        app.pushAssistantToken(`token-${i}\n`);
      }

      await Bun.sleep(120);

      const streamingStatus = String((app as unknown as { lastStatusLine?: string }).lastStatusLine ?? '');
      expect(streamingStatus).toContain('streaming');
      expect(streamingStatus).toContain('tok/s');
      expect(streamingStatus).toContain('lat ');

      app.processKey(makeKey({ name: 'k', ctrl: true }));
      expect(app.getState().commandPalette.isOpen).toBe(true);
      app.processKey(makeKey({ name: 'f' }));
      app.processKey(makeKey({ name: 'o' }));
      app.processKey(makeKey({ name: 'c' }));
      app.processKey(makeKey({ name: 'u' }));
      app.processKey(makeKey({ name: 's' }));
      expect(app.getState().commandPalette.filteredActions.length).toBeGreaterThan(0);

      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      expect(frame).toContain('[Command Palette]');

      app.processKey(makeKey({ name: 'escape' }));
      expect(app.getState().commandPalette.isOpen).toBe(false);

      app.processKey(makeKey({ name: 'tab' }));
      app.processKey(makeKey({ name: 'tab' }));
      expect(app.getState().focusedPane).toBe('transcript');

      app.processKey(makeKey({ name: 'pageup' }));
      const scrolled = app.getState();
      const offsetBeforeMoreTokens = scrolled.transcript.viewport.scrollOffset;
      expect(scrolled.transcript.viewport.pinnedToBottom).toBe(false);

      app.pushAssistantToken('tail-token\n');
      await Bun.sleep(60);

      const whileStreaming = app.getState();
      expect(whileStreaming.transcript.viewport.scrollOffset).toBe(offsetBeforeMoreTokens);
      expect(whileStreaming.transcript.viewport.pinnedToBottom).toBe(false);

      app.completeAssistantStream();
      await Bun.sleep(40);

      const idleStatus = String((app as unknown as { lastStatusLine?: string }).lastStatusLine ?? '');
      expect(idleStatus).not.toContain('streaming');
      expect(idleStatus).toContain('cost $');
      expect(idleStatus).toContain('tok total:');
    } finally {
      if (app.isRunning()) {
        app.stop();
      }
      setup.renderer.destroy();
    }
  });

  test('stream callback forwards provider chunks as-is (not token-splitting)', async () => {
    const chunk = '/function=brave_search>{"query":"annual potato production"}</function>';
    const originalStreamMessage = MockFred.prototype.streamMessage;
    MockFred.prototype.streamMessage = function () {
      return {
        fullStream: (async function* () {
          yield { type: 'token', delta: chunk };
        })(),
      };
    };

    const mockStdin = createStdinDouble({
      isTTY: true,
      isRaw: false,
      setRawMode: mock(() => {}),
    });
    const mockStdout = createStdoutDouble({
      isTTY: true,
      columns: 120,
      rows: 40,
    });

    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });
    (process as any).exit = mock(() => {});

    try {
      const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');

      // handleChatCommand runs Effect.never in interactive mode. Fire-and-forget
      // and poll for the mock call so we can exercise the onSubmit callback.
      const chatPromise = handleChatCommand(buildDeps()).catch(() => {});

      const deadline = Date.now() + 2000;
      while (mockCreateFredTuiApp.mock.calls.length === 0 && Date.now() < deadline) {
        await Bun.sleep(20);
      }

      const calls = (mockCreateFredTuiApp as any).mock.calls as Array<Array<unknown>>;
      const events = (calls[0]?.[0] as { onSubmit?: (text: string) => void } | undefined);
      expect(typeof events?.onSubmit).toBe('function');
      if (!events?.onSubmit) {
        throw new Error('onSubmit callback not provided to createFredTuiApp');
      }

      events.onSubmit('test message');
      await Bun.sleep(40);

      expect(mockApp.pushAssistantToken).toHaveBeenCalledWith(chunk, 1);
      expect(mockApp.completeAssistantStream).toHaveBeenCalledTimes(1);
    } finally {
      MockFred.prototype.streamMessage = originalStreamMessage;
    }
  });
});
