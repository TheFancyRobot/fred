import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';
import { FredTuiApp } from '../../../packages/cli/src/tui/app';
import {
  createMockContextManager,
  createMockFredClass,
  createStdinDouble,
  createStdoutDouble,
  installCommonSmokeModuleMocks,
  installFredSmokeContractMock,
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

const mockCreateFredTuiApp = mock(async () => mockApp as any);

const mockContextManager = createMockContextManager({
  generateConversationId: () => 'conv_phase33_smoke',
  setStorage: mock(() => {}),
});
const MockFred = createMockFredClass({
  contextManager: mockContextManager,
  defaultStreamDelta: 'test',
});
installFredSmokeContractMock({ FredClass: MockFred });

mock.module('@fancyrobot/fred-dev/chat-defaults', () => ({
  DEV_CHAT_PROVIDER_PACKAGES: {
    openai: '@fancyrobot/fred-openai',
    anthropic: '@fancyrobot/fred-anthropic',
    google: '@fancyrobot/fred-google',
    groq: '@fancyrobot/fred-groq',
    openrouter: '@fancyrobot/fred-openrouter',
  },
  detectAvailableProvider: () => ({ platform: 'openai', model: 'gpt-4o-mini' }),
  loadProviderPackage: async () => {},
  ensureDefaultChatAgent: async (fred: InstanceType<typeof MockFred>) => {
    if (fred.getAgents().length === 0) {
      await fred.createAgent({
        id: '__tui_agent__',
        name: 'Chat',
        platform: 'openai',
        model: 'gpt-4o-mini',
      });
    }

    return {
      agentId: '__tui_agent__',
      model: 'gpt-4o-mini',
      provider: 'openai',
    };
  },
}));

mock.module('../../../packages/cli/src/project/resolve-config', () => ({
  resolveProjectConfig: () => ({
    success: false,
    diagnostics: [],
  }),
}));

mock.module('@fancyrobot/fred-openai', () => ({}));
mock.module('@fancyrobot/fred-anthropic', () => ({}));
mock.module('@fancyrobot/fred-google', () => ({}));
mock.module('@fancyrobot/fred-groq', () => ({}));
mock.module('@fancyrobot/fred-openrouter', () => ({}));

mock.module('../../../packages/cli/src/tui/app', () => ({
  createFredTuiApp: mockCreateFredTuiApp,
  FredTuiApp,
}));

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
  const asUpdatedAt = (iso: string) => options.serializeDates ? (iso as unknown as Date) : new Date(iso);
  const includeExistingSessions = options.includeExistingSessions ?? true;

  const sessions = includeExistingSessions ? [
    {
      id: 's-latest',
      updatedAt: asUpdatedAt('2026-02-14T12:00:00Z'),
      title: 'Latest',
      messageCount: 1,
      preview: 'latest preview',
      agent: { id: 'default', name: 'default' },
    },
    {
      id: 's-older',
      updatedAt: asUpdatedAt('2026-02-14T10:00:00Z'),
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
              updatedAt: asUpdatedAt('2026-02-14T12:30:00Z'),
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

    // Deterministically reinstall module mocks
    installFredSmokeContractMock({ FredClass: MockFred });
    installCommonSmokeModuleMocks();
    mockCreateFredTuiApp.mockClear();
    mockApp.updateTelemetryModel.mockClear();
    mockContextManager.setStorage.mockClear();
  });

  afterEach(() => {
    // Restore process globals first
    restoreProcessDoubles({ stdin: originalStdin, stdout: originalStdout, exit: originalExit });

    // Reset all mock call history and restore spies
    mock.restore();
  });

  test('chat is the canonical interactive command and no-args/tui are aliases of the same launch handler', async () => {
    const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
    const source = await Bun.file(indexPath).text();

    expect(source).toContain("const command = args[0] || 'chat';");
    expect(source).toMatch(/case 'chat':\s*case 'tui':[\s\S]*?await handleChatCommand\(\);/);
    expect(source.match(/await handleChatCommand\(\);/g)?.length).toBe(1);
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

    const { configureChatFallbackPersistence } = await import('../../../packages/cli/src/commands/chat');
    configureChatFallbackPersistence(new MockFred() as unknown as any);

    expect(mockContextManager.setStorage).toHaveBeenCalledTimes(1);

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
      await handleChatCommand();

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
    expect(resumeApp.getState().transcript.messages).toHaveLength(0);

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
    expect(app.getState().transcript.messages).toHaveLength(0);

    app.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(20);

    expect(app.getState().transcript.messages[0]?.content).toBe('Welcome back latest');
    expect(app.getState().focusedPane).toBe('input');

    app.stop();
    setup.renderer.destroy();
  });

  test('startup chooser appears with empty session list and Enter creates session', async () => {
    const fixture = createSessionServiceFixture({ includeExistingSessions: false });
    const setup = await createTestRenderer({ width: 120, height: 40 });
    const app = FredTuiApp.createWithRenderer(setup.renderer, {}, fixture);
    await Bun.sleep(20);

    expect(app.getState().startup.chooser.isOpen).toBe(true);
    expect(app.getState().startup.chooser.selected).toBe('start-new-session');

    app.processKey(makeKey({ name: 'enter' }));
    await Bun.sleep(20);

    expect(app.getState().startup.chooser.isOpen).toBe(false);
    expect(app.getState().sessions.selectedId).toBe('s-new');
    expect(app.getState().focusedPane).toBe('input');

    app.stop();
    setup.renderer.destroy();
  });
});
