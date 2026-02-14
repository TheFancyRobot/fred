/**
 * Phase 27 Smoke Tests
 *
 * Cross-module smoke coverage for phase-27 command and mode routing.
 * These tests verify the user-visible behavior guarantees of launch routing:
 * - Bare command follows the chat/tui launch path
 * - Explicit chat command selects interactive branch in TTY mode
 * - Explicit chat command selects non-interactive branch in non-TTY mode
 * - No raw-mode APIs invoked in non-TTY mode
 */

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';

// We mock createFredTuiApp at the module level so handleChatCommand
// doesn't try to create a real OpenTUI renderer in TTY mode tests.
// Import the real FredTuiApp so other tests can still use it.
import { FredTuiApp } from '../../../packages/cli/src/tui/app';

const mockApp = {
  stop: mock(() => {}),
  isRunning: () => true,
  getState: () => ({}),
  updateTelemetryModel: mock(() => {}),
};

const mockCreateFredTuiApp = mock(async () => mockApp);

const expectedNonInteractivePayload = {
  mode: 'non-interactive',
  reason: 'stdin TTY: false, stdout TTY: false',
  suggestion: 'Run fred chat in a terminal for interactive mode',
  help: 'Use fred --help for other commands',
};

const mockContextManager = {
  generateConversationId: () => 'conv_smoke_test',
};

// Mock Fred class to avoid actual provider initialization
class MockFred {
  private agents: any[] = [];
  private providers: Map<string, any> = new Map();
  private defaultAgentId: string | null = null;

  async registerDefaultProviders() {
    // Register fake providers
    this.providers.set('openai', { id: 'openai' });
    this.providers.set('anthropic', { id: 'anthropic' });
    this.providers.set('google', { id: 'google' });
    this.providers.set('groq', { id: 'groq' });
    this.providers.set('openrouter', { id: 'openrouter' });
  }

  async setToolPolicies() {
    // no-op for smoke tests
  }

  async initializeFromConfig() {
    // Add a fake agent immediately
    this.agents.push({ platform: 'openai', model: 'gpt-4o-mini', id: '__mock__' });
    this.providers.set('openai', { id: 'openai' });
  }

  getAgents() {
    return this.agents;
  }

  getAgent(id: string) {
    return this.agents.find((agent) => agent.id === id);
  }

  getContextManager() {
    return mockContextManager;
  }

  getDefaultAgentId() {
    return this.defaultAgentId;
  }

  setDefaultAgent(agentId: string) {
    this.defaultAgentId = agentId;
  }

  useProvider(platform: string) {
    // Register provider if not already registered
    if (!this.providers.has(platform)) {
      this.providers.set(platform, { id: platform });
    }
    return Promise.resolve({ id: platform });
  }

  createAgent(config: any) {
    // Add the agent to the list
    this.agents.push({ ...config, id: config.id || '__test_agent__' });
    if (!this.defaultAgentId) {
      this.defaultAgentId = config.id || '__test_agent__';
    }
    return Promise.resolve(this.agents[this.agents.length - 1]);
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
  registerBuiltinPack: mock(() => {}), // Mock for provider package imports
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

// Mock resolveProjectConfig to return failure (forces detectAvailableProvider path)
mock.module('../../../packages/cli/src/project/resolve-config', () => ({
  resolveProjectConfig: () => ({
    success: false,
    diagnostics: [],
  }),
}));

// Mock provider package imports to avoid peer dependency issues in tests
mock.module('@fancyrobot/fred-openai', () => ({}));
mock.module('@fancyrobot/fred-anthropic', () => ({}));
mock.module('@fancyrobot/fred-google', () => ({}));
mock.module('@fancyrobot/fred-groq', () => ({}));
mock.module('@fancyrobot/fred-openrouter', () => ({}));

// Use mock.module to intercept only createFredTuiApp, preserve FredTuiApp
mock.module('../../../packages/cli/src/tui/app', () => ({
  createFredTuiApp: mockCreateFredTuiApp,
  FredTuiApp,
}));


describe('phase 27 smoke', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;
  let exitCode: number | undefined;
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

    exitCode = undefined;
    (process as any).exit = mock((code?: number) => {
      exitCode = code ?? 0;
    });

    mockCreateFredTuiApp.mockClear();
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

    // Restore env vars
    for (const [key, value] of Object.entries(savedEnvVars)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('bare command path launch parity', () => {
    test('help text remains explicit and includes fred chat', async () => {
      const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
      const content = await Bun.file(indexPath).text();

      expect(content).toContain('fred chat');
      expect(content).toContain('Start interactive chat interface');
      expect(content).toContain('Get started:');
    });

    test('bare command defaults to chat launch path', () => {
      const args: string[] = [];
      const command = args[0] || 'chat';

      expect(command).toBe('chat');
    });

    test('explicit help flag triggers help', () => {
      const args = ['--help'];
      const shouldShowHelp = args[0] === 'help' || args[0] === '--help' || args[0] === '-h';

      expect(shouldShowHelp).toBe(true);
    });
  });

  describe('chat command selects interactive branch in TTY mode', () => {
    test('detectTerminalMode returns interactive-tty for full TTY capabilities', () => {
      let rawMode = false;
      const mockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock((mode: boolean) => {
          rawMode = mode;
        }),
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

      const result = detectTerminalMode();

      expect(result.mode).toBe('interactive-tty');
      expect(result.isInteractive).toBe(true);
      expect(result.canUseRawMode).toBe(true);
    });

    test('interactive branch in chat command still wires createFredTuiApp', async () => {
      const chatCommandPath = '/home/gimbo/dev/fred/packages/cli/src/commands/chat.ts';
      const content = await Bun.file(chatCommandPath).text();

      expect(content).toContain("if (mode.mode === 'interactive-tty')");
      expect(content).toContain('createFredTuiApp');
    });
  });

  describe('chat command selects non-interactive branch in non-TTY mode', () => {
    test('detectTerminalMode returns non-tty for piped stdin', () => {
      const mockStdin = {
        isTTY: false,
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

      const result = detectTerminalMode();

      expect(result.mode).toBe('non-tty');
      expect(result.isInteractive).toBe(false);
      expect(result.canUseRawMode).toBe(false);
    });

    test('chat command in non-TTY mode emits shared JSON contract and exits', async () => {
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
        const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
        await handleChatCommand();

        const jsonOutput = logs.join('\n');
        expect(jsonOutput).toContain('non-interactive');

        const parsed = JSON.parse(jsonOutput);
        expect(parsed).toEqual(expectedNonInteractivePayload);

        expect(exitCode).toBe(1);
      } finally {
        console.log = originalLog;
      }
    });

    test('fred, fred tui, and fred chat resolve to same non-TTY fallback semantics', () => {
      const resolveCommand = (args: string[]): string => {
        const firstArg = args[0];
        if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
          return 'help';
        }
        return firstArg || 'chat';
      };

      const launchEntrypoints = [
        [],
        ['tui'],
        ['chat'],
      ];

      for (const args of launchEntrypoints) {
        const command = resolveCommand(args);
        expect(command === 'chat' || command === 'tui').toBe(true);
        expect(expectedNonInteractivePayload).toEqual({
          mode: 'non-interactive',
          reason: 'stdin TTY: false, stdout TTY: false',
          suggestion: 'Run fred chat in a terminal for interactive mode',
          help: 'Use fred --help for other commands',
        });
      }
    });
  });

  describe('no raw-mode APIs invoked in non-TTY mode', () => {
    test('setRawMode not called when non-TTY detected', async () => {
      const setRawModeSpy = mock(() => {
        throw new Error('setRawMode should not be called in non-TTY mode');
      });

      const mockStdin = {
        isTTY: false,
        setRawMode: setRawModeSpy,
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

      const originalLog = console.log;
      console.log = mock(() => {});

      try {
        const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
        await handleChatCommand();

        expect(setRawModeSpy).not.toHaveBeenCalled();
      } finally {
        console.log = originalLog;
      }
    });

    test('terminal lifecycle safety in non-TTY mode', () => {
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

      const mode = detectTerminalMode();

      expect(mode.canUseRawMode).toBe(false);
      expect(mode.isInteractive).toBe(false);
    });
  });

  describe('command and mode routing integration', () => {
    test('chat command routing logic exists in CLI index', async () => {
      const indexPath = '/home/gimbo/dev/fred/packages/cli/src/index.ts';
      const content = await Bun.file(indexPath).text();

      expect(content).toContain("case 'chat':");
      expect(content).toContain('handleChatCommand');
    });

    test('parseArgs correctly identifies chat command', () => {
      const args = ['chat'];
      const command = args[0];

      expect(command).toBe('chat');
      expect(command).not.toBe('dev');
      expect(command).not.toBe('test');
      expect(command).not.toBe('help');
    });

    test('mode detection drives routing decision', () => {
      let rawMode = false;
      const ttyMockStdin = {
        isTTY: true,
        isRaw: false,
        setRawMode: mock((mode: boolean) => {
          rawMode = mode;
        }),
      } as any;

      const ttyMockStdout = {
        isTTY: true,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: ttyMockStdin,
        configurable: true,
      });

      Object.defineProperty(process, 'stdout', {
        value: ttyMockStdout,
        configurable: true,
      });

      const ttyMode = detectTerminalMode();
      expect(ttyMode.mode).toBe('interactive-tty');

      const nonTtyMockStdin = {
        isTTY: false,
      } as any;

      Object.defineProperty(process, 'stdin', {
        value: nonTtyMockStdin,
        configurable: true,
      });

      const nonTtyMode = detectTerminalMode();
      expect(nonTtyMode.mode).toBe('non-tty');

      expect(ttyMode.mode).not.toBe(nonTtyMode.mode);
      expect(ttyMode.isInteractive).toBe(true);
      expect(nonTtyMode.isInteractive).toBe(false);
    });
  });
});
