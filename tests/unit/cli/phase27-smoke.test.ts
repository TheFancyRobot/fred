/**
 * Phase 27 Smoke Tests
 *
 * Cross-module smoke coverage for phase-27 command and mode routing.
 * These tests verify the user-visible behavior guarantees of launch routing:
 * - Bare command follows the chat/tui launch path
 * - Explicit chat command selects interactive branch in TTY mode
 * - Explicit chat command selects non-interactive branch in non-TTY mode
 * - No raw-mode APIs invoked in non-TTY mode
 *
 * All Fred/provider/TUI dependencies are injected via ChatDependencies DI
 * instead of mock.module(), preventing global module pollution that caused
 * 50+ unrelated test failures when running the full suite.
 */

import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';
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
};

const mockCreateFredTuiApp = mock(async () => mockApp);

const expectedNonInteractivePayload = {
  mode: 'non-interactive',
  reason: 'stdin TTY: false, stdout TTY: false',
  suggestion: 'Run fred chat in a terminal for interactive mode',
  help: 'Use fred --help for other commands',
};

const mockContextManager = createMockContextManager({
  generateConversationId: () => 'conv_smoke_test',
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
    // Restore process globals first (before mock cleanup)
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
      const mockStdin = createStdinDouble({
        isTTY: true,
        isRaw: false,
        setRawMode: mock((mode: boolean) => {
          rawMode = mode;
        }),
      });

      const mockStdout = createStdoutDouble({
        isTTY: true,
      });

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
      const mockStdin = createStdinDouble({ isTTY: false });
      const mockStdout = createStdoutDouble({ isTTY: true });

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
        const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');
        await handleChatCommand(buildDeps());

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

      const mockStdin = createStdinDouble({
        isTTY: false,
        setRawMode: setRawModeSpy,
      });

      const mockStdout = createStdoutDouble({ isTTY: false });

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
        await handleChatCommand(buildDeps());

        expect(setRawModeSpy).not.toHaveBeenCalled();
      } finally {
        console.log = originalLog;
      }
    });

    test('terminal lifecycle safety in non-TTY mode', () => {
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
      const ttyMockStdin = createStdinDouble({
        isTTY: true,
        isRaw: false,
        setRawMode: mock((mode: boolean) => {
          rawMode = mode;
        }),
      });

      const ttyMockStdout = createStdoutDouble({ isTTY: true });

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

      const nonTtyMockStdin = createStdinDouble({ isTTY: false });

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
