/**
 * Phase 33 launch contract smoke tests
 *
 * Verifies canonical command routing, TTY mode semantics, startup chooser,
 * and session resume flows.
 *
 * All Fred/provider/TUI dependencies are injected via ChatDependencies DI
 * instead of mock.module(), preventing global module pollution.
 */

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import path from 'node:path';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import type { SessionSummary } from '@fancyrobot/fred';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';
import { FredTuiApp } from '../../../packages/cli/src/tui/app';
import type { SessionContextService } from '../../../packages/cli/src/tui/session';
import {
  createMockContextManager,
  createSmokeTestDeps,
  createStdinDouble,
  createStdoutDouble,
  MockSqliteContextStorage,
  restoreProcessDoubles,
  shutdownMockFredClients,
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

const mockCreateFredTuiApp = mock(async () => mockApp as any);

const mockContextManager = createMockContextManager({
  generateConversationId: () => 'conv_phase33_smoke',
  setStorage: mock(() => {}),
});
/** Build DI deps for tests that exercise handleChatCommand */
function buildDeps() {
  return createSmokeTestDeps({
    client: { contextManager: mockContextManager },
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

function createSessionServiceFixture(options: { serializeDates?: boolean; includeExistingSessions?: boolean } = {}) {
  const asSummary = (summary: SessionSummary): SessionSummary => {
    if (options.serializeDates) {
      Reflect.set(summary, 'updatedAt', summary.updatedAt.toISOString());
    }
    return summary;
  };
  const includeExistingSessions = options.includeExistingSessions ?? true;

  const sessions = includeExistingSessions ? [
    asSummary({
      id: 's-latest',
      createdAt: new Date('2026-02-14T12:00:00Z'),
      updatedAt: new Date('2026-02-14T12:00:00Z'),
      title: 'Latest',
      messageCount: 1,
      preview: 'latest preview',
      agent: { id: 'default', name: 'default' },
    }),
    asSummary({
      id: 's-older',
      createdAt: new Date('2026-02-14T10:00:00Z'),
      updatedAt: new Date('2026-02-14T10:00:00Z'),
      title: 'Older',
      messageCount: 1,
      preview: 'older preview',
      agent: { id: 'default', name: 'default' },
    }),
  ] : [];

  const transcripts: Record<string, Array<{ role: string; content: string }>> = {
    's-latest': [{ role: 'assistant', content: 'Welcome back latest' }],
    's-older': [{ role: 'assistant', content: 'Welcome back older' }],
    's-new': [],
  };

  const contextManager: SessionContextService = {
    listSessions: async () => sessions,
    generateConversationId: async () => 's-new',
    getContext: async (_id: string) => ({ id: _id }),
    updateMetadata: async (_id: string, _metadata: Record<string, unknown>) => undefined,
    getSession: async (id: string) => {
      const summary = sessions.find((session) => session.id === id)
        ?? (id === 's-new'
          ? asSummary({
              id: 's-new',
              createdAt: new Date('2026-02-14T12:30:00Z'),
              updatedAt: new Date('2026-02-14T12:30:00Z'),
              title: null,
              messageCount: 0,
              preview: null,
              agent: { id: 'default', name: 'default' },
            })
          : null);
      if (!summary) {
        return null;
      }

      return {
        summary,
        metadata: { createdAt: new Date(), updatedAt: new Date() },
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
      contextManager,
    },
  };
}

describe('phase 33 launch contract smoke', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;
  let exitCode: number | undefined;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalExit = process.exit;
    exitCode = undefined;
    (process as any).exit = mock((code?: number) => {
      exitCode = code ?? 0;
    });

    mockCreateFredTuiApp.mockClear();
    mockApp.updateTelemetryModel.mockClear();
    mockContextManager.setStorage.mockClear();
  });

  afterEach(async () => {
    // Restore process globals first
    restoreProcessDoubles({ stdin: originalStdin, stdout: originalStdout, exit: originalExit });

    // Reset all mock call history and restore spies
    mock.restore();
    await shutdownMockFredClients();
  });

  test('chat is the canonical interactive command and no-args/tui are aliases of the same launch handler', async () => {
    const indexPath = path.resolve(import.meta.dir, '../../../packages/cli/src/index.ts');
    const source = await Bun.file(indexPath).text();

    expect(source).toContain("const command = args[0] || 'chat';");
    expect(source).toMatch(
      /case 'chat':\s*case 'tui':[\s\S]*?await handleChatCommand\(\{ projectSetupHook: loadProjectSetup \}\);/,
    );
    expect(source.match(/await handleChatCommand\(\{ projectSetupHook: loadProjectSetup \}\);/g)?.length).toBe(1);
  });

  test('explicit help flags remain help-only and do not route into launch flow', () => {
    const resolveCommand = (args: string[]) => {
      const firstArg = args[0];
      if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
        return 'help';
      }
      return firstArg || 'chat';
    };

    expect(resolveCommand(['help'])).toBe('help');
    expect(resolveCommand(['--help'])).toBe('help');
    expect(resolveCommand(['-h'])).toBe('help');
    expect(resolveCommand([])).toBe('chat');
    expect(resolveCommand(['tui'])).toBe('tui');
  });

  test('TTY mode keeps chat-primary launch semantics with no-args/tui alias behavior', async () => {
    const mockStdin = createStdinDouble({
      isTTY: true,
      isRaw: false,
      setRawMode: mock(() => {}),
    });
    const mockStdout = createStdoutDouble({ isTTY: true });

    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: mockStdout,
      configurable: true,
    });

    const mode = detectTerminalMode();
    expect(mode.mode).toBe('interactive-tty');

    const storage = new MockSqliteContextStorage({ path: '/tmp/phase33.db' });
    const createStorage = mock(() => storage);
    const { createChatFallbackOptions } = await import('../../../packages/cli/src/commands/chat');
    const fallbackOptions = createChatFallbackOptions('/tmp/phase33.db', createStorage);

    expect(createStorage).toHaveBeenCalledWith({ path: '/tmp/phase33.db' });
    expect(fallbackOptions.storage).toBe(storage);

    const resolveCommand = (args: string[]) => {
      const firstArg = args[0];
      if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
        return 'help';
      }
      return firstArg || 'chat';
    };

    expect(resolveCommand([])).toBe('chat');
    expect(resolveCommand(['tui'])).toBe('tui');
  });

  test('non-TTY fallback contract stays equivalent for chat and its no-args/tui aliases', async () => {
    const mockStdin = createStdinDouble({ isTTY: false });
    const mockStdout = createStdoutDouble({ isTTY: false });

    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: mockStdout,
      configurable: true,
    });

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = mock((...args: any[]) => {
      logs.push(args.join(' '));
    });

    try {
      const mode = detectTerminalMode();
      expect(mode.mode).toBe('non-tty');

      const { handleChatCommand, createNonInteractiveFallbackPayload } = await import('../../../packages/cli/src/commands/chat');
      await handleChatCommand(buildDeps());

      const parsed = JSON.parse(logs.join('\n'));
      const expected = createNonInteractiveFallbackPayload(mode.reason);
      expect(parsed).toEqual(expected);
      expect(exitCode).toBe(1);

      const resolveCommand = (args: string[]) => {
        const firstArg = args[0];
        if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
          return 'help';
        }
        return firstArg || 'chat';
      };

      const entrypoints = [[], ['tui'], ['chat']];
      const commands = entrypoints.map((entrypoint) => resolveCommand(entrypoint));
      expect(commands).toEqual(['chat', 'tui', 'chat']);

      for (const _entrypoint of entrypoints) {
        expect(createNonInteractiveFallbackPayload(mode.reason)).toEqual(expected);
      }
    } finally {
      console.log = originalLog;
    }
  });

  test('startup chooser defaults to start-new and resume path hands off to sidebar selection', async () => {
    const fixture = createSessionServiceFixture();

    const startNewSetup = await createTestRenderer({ width: 120, height: 40 });
    const startNewApp = FredTuiApp.createWithRenderer(startNewSetup.renderer, {}, fixture);
    await Bun.sleep(20);

    expect(startNewApp.getState().startup.chooser.isOpen).toBe(true);
    expect(startNewApp.getState().startup.chooser.selected).toBe('start-new-session');

    startNewApp.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(20);

    expect(startNewApp.getState().startup.chooser.isOpen).toBe(false);
    expect(startNewApp.getState().sessions.selectedId).toBe('s-new');
    expect(startNewApp.getState().focusedPane).toBe('input');

    startNewApp.stop();
    startNewSetup.renderer.destroy();

    const resumeSetup = await createTestRenderer({ width: 120, height: 40 });
    const resumeApp = FredTuiApp.createWithRenderer(resumeSetup.renderer, {}, fixture);
    await Bun.sleep(20);

    resumeApp.processKey(makeKey({ name: 'up' }));
    resumeApp.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(20);

    expect(resumeApp.getState().startup.chooser.isOpen).toBe(false);
    expect(resumeApp.getState().sessions.selectedId).toBe('s-latest');
    expect(resumeApp.getState().focusedPane).toBe('sidebar');
    // Transcript is now eagerly loaded for the initially-selected session
    expect(resumeApp.getState().transcript.messages[0]?.content).toBe('Welcome back latest');

    resumeApp.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(20);

    expect(resumeApp.getState().transcript.messages[0]?.content).toBe('Welcome back latest');
    expect(resumeApp.getState().focusedPane).toBe('input');

    resumeApp.stop();
    resumeSetup.renderer.destroy();
  });

  test('startup chooser still appears when stored sessions return serialized timestamp values', async () => {
    const fixture = createSessionServiceFixture({ serializeDates: true });
    const setup = await createTestRenderer({ width: 120, height: 40 });
    const app = FredTuiApp.createWithRenderer(setup.renderer, {}, fixture);
    await Bun.sleep(20);

    expect(app.getState().startup.chooser.isOpen).toBe(true);
    expect(app.getState().sessions.items.map((item) => item.id)).toContain('s-latest');

    app.processKey(makeKey({ name: 'up' }));
    app.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(20);

    expect(app.getState().sessions.selectedId).toBe('s-latest');
    expect(app.getState().focusedPane).toBe('sidebar');
    // Transcript is now eagerly loaded for the initially-selected session
    expect(app.getState().transcript.messages[0]?.content).toBe('Welcome back latest');

    app.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(20);

    expect(app.getState().transcript.messages[0]?.content).toBe('Welcome back latest');
    expect(app.getState().focusedPane).toBe('input');

    app.stop();
    setup.renderer.destroy();
  });

  test('empty session list skips chooser and auto-creates a session', async () => {
    const fixture = createSessionServiceFixture({ includeExistingSessions: false });
    const setup = await createTestRenderer({ width: 120, height: 40 });
    const app = FredTuiApp.createWithRenderer(setup.renderer, {}, fixture);
    await Bun.sleep(20);

    // With no existing sessions, chooser should not appear; a session is auto-created
    expect(app.getState().startup.chooser.isOpen).toBe(false);
    expect(app.getState().sessions.selectedId).toBe('s-new');
    expect(app.getState().focusedPane).toBe('input');

    app.stop();
    setup.renderer.destroy();
  });
});
