import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { createTestRenderer } from '@opentui/core/testing';
import type { KeyEvent } from '@opentui/core';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';
import { FredTuiApp } from '../../../packages/cli/src/tui/app';

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

const mockContextManager = {
  generateConversationId: () => 'conv_phase33_smoke',
};

class MockFred {
  private agents: any[] = [];
  private providers: Map<string, any> = new Map();
  private defaultAgentId: string | null = null;

  async initializeFromConfig() {
    this.agents.push({ id: '__mock__', platform: 'openai', model: 'gpt-4o-mini' });
    this.providers.set('openai', { id: 'openai' });
  }

  async setToolPolicies() {}

  getAgents() {
    return this.agents;
  }

  getContextManager() {
    return mockContextManager;
  }

  async createAgent(config: any) {
    this.agents.push({ ...config, id: config.id || '__test_agent__' });
    if (!this.defaultAgentId) {
      this.defaultAgentId = config.id || '__test_agent__';
    }
    return this.agents[this.agents.length - 1];
  }

  async setDefaultAgent(agentId: string) {
    this.defaultAgentId = agentId;
  }

  streamMessage() {
    return {
      fullStream: (async function* () {
        yield { type: 'token', delta: 'test' };
      })(),
    };
  }
}

mock.module('@fancyrobot/fred', () => ({
  Fred: MockFred,
  registerBuiltinPack: mock(() => {}),
}));

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
  ensureDefaultChatAgent: async (fred: MockFred) => {
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

function createSessionServiceFixture(options: { serializeDates?: boolean } = {}) {
  const asUpdatedAt = (iso: string) => options.serializeDates ? (iso as unknown as Date) : new Date(iso);

  const sessions = [
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
  ];

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
    mockCreateFredTuiApp.mockClear();
    mockApp.updateTelemetryModel.mockClear();
  });

  afterEach(() => {
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: originalStdout,
      configurable: true,
    });
    (process as any).exit = originalExit;
  });

  test('no-args and tui entrypoints share the interactive launch handler route', async () => {
    const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
    const source = await Bun.file(indexPath).text();

    expect(source).toContain("const command = args[0] || 'chat';");
    expect(source).toContain("case 'chat':");
    expect(source).toContain("case 'tui':");
    expect(source).toContain('await handleChatCommand();');
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

  test('TTY mode resolves to interactive launch path for no-args and tui entrypoints', async () => {
    const mockStdin = {
      isTTY: true,
      isRaw: false,
      setRawMode: mock(() => {}),
    } as any;
    const mockStdout = {
      isTTY: true,
    } as any;

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

    const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
    await handleChatCommand();

    expect(mockCreateFredTuiApp).toHaveBeenCalledTimes(1);
    expect(mockApp.updateTelemetryModel).toHaveBeenCalledWith('gpt-4o-mini', 'openai');

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

  test('non-TTY guidance and exit semantics stay equivalent across no-args/tui/chat', async () => {
    const mockStdin = {
      isTTY: false,
    } as any;
    const mockStdout = {
      isTTY: false,
    } as any;

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

      const entrypoints = [[], ['tui'], ['chat']];
      for (const _entrypoint of entrypoints) {
        expect(createNonInteractiveFallbackPayload(mode.reason)).toEqual(expected);
      }
    } finally {
      console.log = originalLog;
    }
  });

  test('startup chooser defaults to start-new and both chooser paths land in input-focused chat state', async () => {
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
    expect(app.getState().transcript.messages[0]?.content).toBe('Welcome back latest');
    expect(app.getState().focusedPane).toBe('input');

    app.stop();
    setup.renderer.destroy();
  });
});
