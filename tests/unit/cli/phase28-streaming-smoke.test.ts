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
import { Stream } from 'effect';
import type { StreamEvent } from '@fancyrobot/fred';
import { FredTuiApp } from '../../../packages/cli/src/tui/app';
import {
  createMockContextManager,
  createSmokeTestDeps,
  createStdinDouble,
  createStdoutDouble,
  restoreProcessDoubles,
  shutdownMockFredClients,
} from './fixtures/fred-smoke-contract';

const mockApp = {
  stop: mock(() => {}),
  isRunning: () => true,
  getState: () => ({}),
  updateTelemetryModel: mock(() => {}),
  clearAssistantStreamContent: mock(() => {}),
  pushAssistantToken: mock(() => {}),
  pushToolCall: mock(() => {}),
  pushToolResult: mock(() => {}),
  pushToolError: mock(() => {}),
  completeAssistantStream: mock(() => {}),
  failAssistantStream: mock(() => {}),
};

/**
 * Poll until `completeAssistantStream` or `failAssistantStream` has been called.
 *
 * The smoothStream async generator introduces real 12ms delays between word-level
 * segments, so a fixed `Bun.sleep(40)` is not enough for streams with many segments.
 * Polling decouples tests from the exact number of segments × delay timing.
 */
async function waitForStreamComplete(timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (
    (mockApp.completeAssistantStream as ReturnType<typeof mock>).mock.calls.length === 0 &&
    (mockApp.failAssistantStream as ReturnType<typeof mock>).mock.calls.length === 0 &&
    Date.now() < deadline
  ) {
    await Bun.sleep(20);
  }
}

const mockCreateFredTuiApp = mock(async () => mockApp);

const mockContextManager = createMockContextManager({
  generateConversationId: () => 'conv_phase28_smoke',
});
/** Build DI deps for tests that exercise handleChatCommand */
function buildDeps(stream?: () => Stream.Stream<StreamEvent>) {
  return createSmokeTestDeps({
    client: { contextManager: mockContextManager, stream },
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
    mockApp.clearAssistantStreamContent.mockClear();
    mockApp.pushAssistantToken.mockClear();
    mockApp.pushToolCall.mockClear();
    mockApp.pushToolResult.mockClear();
    mockApp.pushToolError.mockClear();
    mockApp.completeAssistantStream.mockClear();
    mockApp.failAssistantStream.mockClear();
  });

  afterEach(async () => {
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
    await shutdownMockFredClients();
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

  test('uses project runtime hook when available', async () => {
    const createOptions: Array<unknown> = [];
    const runtimeHook = mock(async () => undefined);

    const deps = createSmokeTestDeps({
      createFredTuiApp: mockCreateFredTuiApp,
      onCreate: (options) => createOptions.push(options),
    });
    deps.resolveProjectConfig = () => ({
      success: true,
      config: {},
      configPath: '/tmp/fred.config.yaml',
      diagnostics: [],
    }) as any;
    deps.loadProjectRuntimeHook = async () => runtimeHook as any;

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
    const chatPromise = handleChatCommand(deps).catch(() => {});

    const deadline = Date.now() + 2000;
    while (mockCreateFredTuiApp.mock.calls.length === 0 && Date.now() < deadline) {
      await Bun.sleep(20);
    }

    expect(runtimeHook).toHaveBeenCalledTimes(1);
    expect(createOptions).toEqual([undefined]);

    void chatPromise;
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

      // Status bar shows shortcut badges (no telemetry)
      await setup.renderOnce();
      const streamFrame = setup.captureCharFrame();
      expect(streamFrame).toContain('? Help');
      expect(streamFrame).toContain('Esc Quit');

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

      // Idle status shows badges, no telemetry
      await setup.renderOnce();
      const idleFrame = setup.captureCharFrame();
      expect(idleFrame).toContain('? Help');
      expect(idleFrame).not.toContain('streaming');
      expect(idleFrame).not.toContain('cost $');
    } finally {
      if (app.isRunning()) {
        app.stop();
      }
      setup.renderer.destroy();
    }
  });

  test('stream callback forwards provider chunks with XML tags filtered (not token-splitting)', async () => {
    // Chunk contains a closing </function> tag that the XML filter should strip.
    // The TUI now filters XML-like tags from token deltas to prevent hallucinated
    // XML pseudo-tool-calls from appearing in the transcript.
    const chunk = '/function=brave_search>{"query":"annual potato production"}</function>';
    const expectedFiltered = '/function=brave_search>{"query":"annual potato production"}';
    const stream = () => Stream.fromIterable<StreamEvent>([{
      type: 'token', runId: 'run_1', threadId: 'conv_1', sequence: 1, emittedAt: 1,
      messageId: 'message_1', step: 0, delta: chunk, accumulated: chunk,
    }]);

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

      // handleChatCommand runs Effect.never in interactive mode. Fire-and-forget
      // and poll for the mock call so we can exercise the onSubmit callback.
      const chatPromise = handleChatCommand(buildDeps(stream)).catch(() => {});

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
      await waitForStreamComplete();

      // XML filtering strips the </function> closing tag and display segmentation preserves content order
      const rendered = ((mockApp.pushAssistantToken as any).mock.calls as Array<Array<unknown>>)
        .map((call) => String(call[0] ?? ''))
        .join('');
      expect(rendered).toBe(expectedFiltered);
      expect(mockApp.completeAssistantStream).toHaveBeenCalledTimes(1);
  });

  test('stream callback falls back to run-end content when no token deltas arrive', async () => {
    const stream = () => Stream.fromIterable([
          {
            type: 'tool-call',
            runId: 'run_1',
            sequence: 1,
            emittedAt: 1,
            messageId: 'msg_1',
            step: 0,
            toolCallId: 'tool_1',
            toolName: 'fetch_latest_news',
            input: { topic: 'trump' },
            startedAt: Date.now(),
          },
          {
            type: 'tool-result',
            runId: 'run_1',
            sequence: 2,
            emittedAt: 2,
            messageId: 'msg_1',
            step: 0,
            toolCallId: 'tool_1',
            toolName: 'fetch_latest_news',
            output: { digest: 'news digest' },
            completedAt: Date.now(),
            durationMs: 25,
          },
          {
            type: 'run-end',
            sequence: 4,
            emittedAt: Date.now(),
            runId: 'run_1',
            finishedAt: Date.now(),
            durationMs: 100,
            result: {
              content: 'Top developments\n- Item 1',
              toolCalls: [],
            },
          },
        ] satisfies StreamEvent[]);

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
      const chatPromise = handleChatCommand(buildDeps(stream)).catch(() => {});

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

      events.onSubmit('what did trump say today');
      await waitForStreamComplete();

      expect(mockApp.pushToolCall).toHaveBeenCalledTimes(1);
      expect(mockApp.pushToolResult).toHaveBeenCalledTimes(1);
      const rendered = ((mockApp.pushAssistantToken as any).mock.calls as Array<Array<unknown>>)
        .map((call) => String(call[0] ?? ''))
        .join('');
      expect(rendered).toBe('Top developments\n- Item 1');
      expect(mockApp.completeAssistantStream).toHaveBeenCalledTimes(1);

      void chatPromise;
  });

  test('stream callback surfaces handoffs and nested tool depth', async () => {
    const stream = () => Stream.fromIterable([
          {
            type: 'run-start', runId: 'run_root', sequence: 0, emittedAt: 0,
            startedAt: 0, input: { message: 'research this', previousMessages: [] },
          },
          {
            type: 'handoff-start',
            runId: 'run_root',
            sequence: 1,
            emittedAt: Date.now(),
            fromAgentId: 'concierge',
            toAgentId: 'research-orchestrator',
            message: 'research this',
            handoffDepth: 1,
          },
          {
            type: 'run-start', runId: 'run_child', sequence: 2, emittedAt: 2,
            startedAt: 2, input: { message: 'research this', previousMessages: [] },
          },
          {
            type: 'tool-call',
            runId: 'run_child',
            sequence: 3,
            emittedAt: 3,
            messageId: 'msg_child',
            step: 0,
            toolCallId: 'tool_nested',
            toolName: 'run_research_swarm',
            input: { question: 'history' },
            startedAt: Date.now(),
          },
          {
            type: 'tool-result',
            runId: 'run_child',
            sequence: 4,
            emittedAt: 4,
            messageId: 'msg_child',
            step: 0,
            toolCallId: 'tool_nested',
            toolName: 'run_research_swarm',
            output: 'done',
            completedAt: Date.now(),
            durationMs: 25,
          },
          {
            type: 'run-end',
            sequence: 5,
            emittedAt: Date.now(),
            runId: 'run_child',
            finishedAt: Date.now(),
            durationMs: 100,
            result: { content: 'final', toolCalls: [] },
          },
        ] satisfies StreamEvent[]);

    const mockStdin = createStdinDouble({ isTTY: true, isRaw: false, setRawMode: mock(() => {}) });
    const mockStdout = createStdoutDouble({ isTTY: true, columns: 120, rows: 40 });

    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });
    (process as any).exit = mock(() => {});

      const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
      const chatPromise = handleChatCommand(buildDeps(stream)).catch(() => {});

      const deadline = Date.now() + 2000;
      while (mockCreateFredTuiApp.mock.calls.length === 0 && Date.now() < deadline) {
        await Bun.sleep(20);
      }

      const calls = (mockCreateFredTuiApp as any).mock.calls as Array<Array<unknown>>;
      const events = (calls[0]?.[0] as { onSubmit?: (text: string) => void } | undefined);
      if (!events?.onSubmit) {
        throw new Error('onSubmit callback not provided to createFredTuiApp');
      }

      events.onSubmit('research this');
      await waitForStreamComplete();

      expect(mockApp.pushToolCall).toHaveBeenCalledTimes(1);
      const pushToolCallCalls = (mockApp.pushToolCall as any).mock.calls as Array<Array<unknown>>;
      expect(pushToolCallCalls[0]?.[0]).toMatchObject({
        toolName: 'run_research_swarm',
        depth: 2,
      });

      void chatPromise;
  });

  test('stream callback splits large visible deltas into smaller display segments', async () => {
    const stream = () => Stream.fromIterable([
          {
            type: 'token',
            runId: 'run_1',
            sequence: 1,
            emittedAt: 1,
            messageId: 'message_1',
            step: 0,
            delta: 'Hello world.',
            accumulated: 'Hello world.',
          },
          {
            type: 'run-end',
            sequence: 2,
            emittedAt: Date.now(),
            runId: 'run_1',
            finishedAt: Date.now(),
            durationMs: 25,
            result: {
              content: 'Hello world.',
              toolCalls: [],
            },
          },
        ] satisfies StreamEvent[]);

    const mockStdin = createStdinDouble({ isTTY: true, isRaw: false, setRawMode: mock(() => {}) });
    const mockStdout = createStdoutDouble({ isTTY: true, columns: 120, rows: 40 });

    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });
    (process as any).exit = mock(() => {});

      const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
      const chatPromise = handleChatCommand(buildDeps(stream)).catch(() => {});

      const deadline = Date.now() + 2000;
      while (mockCreateFredTuiApp.mock.calls.length === 0 && Date.now() < deadline) {
        await Bun.sleep(20);
      }

      const calls = (mockCreateFredTuiApp as any).mock.calls as Array<Array<unknown>>;
      const events = (calls[0]?.[0] as { onSubmit?: (text: string) => void } | undefined);
      if (!events?.onSubmit) {
        throw new Error('onSubmit callback not provided to createFredTuiApp');
      }

      events.onSubmit('hello');
      await waitForStreamComplete();

      expect(mockApp.pushAssistantToken.mock.calls.map((call: any[]) => call[0])).toEqual(['Hello', ' ', 'world', '.']);

      void chatPromise;
  });

  test('handoff tool calls clear narrated transfer text from the transcript', async () => {
    const narrated = "I've handed off your request to the research orchestrator.";
    const stream = () => Stream.fromIterable([
          {
            type: 'run-start', runId: 'run_root', sequence: 0, emittedAt: 0,
            startedAt: 0, input: { message: 'research this', previousMessages: [] },
          },
          {
            type: 'token', runId: 'run_root', sequence: 1, emittedAt: 1,
            messageId: 'message_root', step: 0, delta: narrated, accumulated: narrated,
          },
          {
            type: 'tool-call',
            runId: 'run_root',
            sequence: 2,
            emittedAt: 2,
            messageId: 'msg_root',
            step: 0,
            toolCallId: 'handoff_tool',
            toolName: 'handoff_to_agent',
            input: { agentId: 'research-orchestrator' },
            startedAt: Date.now(),
          },
          {
            type: 'tool-result',
            runId: 'run_root',
            sequence: 3,
            emittedAt: 3,
            messageId: 'msg_root',
            step: 0,
            toolCallId: 'handoff_tool',
            toolName: 'handoff_to_agent',
            output: { type: 'handoff', agentId: 'research-orchestrator', message: 'research this' },
            completedAt: Date.now(),
            durationMs: 10,
          },
          {
            type: 'run-end',
            sequence: 4,
            emittedAt: Date.now(),
            runId: 'run_root',
            finishedAt: Date.now(),
            durationMs: 20,
            result: {
              content: narrated,
              handoff: { type: 'handoff', agentId: 'research-orchestrator', message: 'research this' },
            },
          },
          {
            type: 'handoff-start',
            runId: 'run_root',
            sequence: 5,
            emittedAt: Date.now(),
            fromAgentId: 'concierge',
            toAgentId: 'research-orchestrator',
            message: 'research this',
            handoffDepth: 1,
          },
          {
            type: 'run-start', runId: 'run_child', sequence: 6, emittedAt: 6,
            startedAt: 6, input: { message: 'research this', previousMessages: [] },
          },
          {
            type: 'token', runId: 'run_child', sequence: 7, emittedAt: 7,
            messageId: 'message_child', step: 0, delta: 'Final answer', accumulated: 'Final answer',
          },
          {
            type: 'run-end',
            sequence: 8,
            emittedAt: Date.now(),
            runId: 'run_child',
            finishedAt: Date.now(),
            durationMs: 40,
            result: { content: 'Final answer' },
          },
        ] satisfies StreamEvent[]);

    const mockStdin = createStdinDouble({ isTTY: true, isRaw: false, setRawMode: mock(() => {}) });
    const mockStdout = createStdoutDouble({ isTTY: true, columns: 120, rows: 40 });

    Object.defineProperty(process, 'stdin', { value: mockStdin, configurable: true });
    Object.defineProperty(process, 'stdout', { value: mockStdout, configurable: true });
    (process as any).exit = mock(() => {});

      const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
      const chatPromise = handleChatCommand(buildDeps(stream)).catch(() => {});

      const deadline = Date.now() + 2000;
      while (mockCreateFredTuiApp.mock.calls.length === 0 && Date.now() < deadline) {
        await Bun.sleep(20);
      }

      const calls = (mockCreateFredTuiApp as any).mock.calls as Array<Array<unknown>>;
      const events = (calls[0]?.[0] as { onSubmit?: (text: string) => void } | undefined);
      if (!events?.onSubmit) {
        throw new Error('onSubmit callback not provided to createFredTuiApp');
      }

      events.onSubmit('research this');
      await waitForStreamComplete();

      expect(mockApp.clearAssistantStreamContent).toHaveBeenCalledTimes(1);
      expect(mockApp.pushToolCall).not.toHaveBeenCalledWith(expect.objectContaining({ toolName: 'handoff_to_agent' }));

      void chatPromise;
  });
});
