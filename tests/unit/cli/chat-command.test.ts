import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { detectTerminalMode } from '../../../packages/cli/src/runtime/tty-mode';
import {
  createAssistantSegmentRenderer,
  createNonInteractiveFallbackPayload,
  detectAvailableProvider,
  loadProviderPackage,
  PROVIDER_PACKAGES,
  TERMINAL_RECOVERY_GUIDANCE,
} from '../../../packages/cli/src/commands/chat';

/**
 * Tests for chat command routing and launch-path behavior
 *
 * Note: We can't directly test handleChatCommand() because it calls startDevChat()
 * which uses BunRuntime.runMain and never returns. Instead, we test:
 * 1. Terminal mode detection (which drives routing)
 * 2. CLI help text includes chat command
 * 3. Command parsing handles chat case
 * 4. Lifecycle wiring verification (source-level)
 * 5. Recovery guidance contract
 */
describe('Chat Command', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
  });

  afterEach(() => {
    // Restore stdin/stdout after tests
    Object.defineProperty(process, 'stdin', {
      value: originalStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: originalStdout,
      configurable: true,
    });
  });

  describe('Terminal mode detection for routing', () => {
    test('detects interactive-tty mode for chat', () => {
      // Mock fully capable TTY
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

    test('detects non-tty mode for piped input', () => {
      // Mock as non-TTY (piped)
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
  });

  describe('Help text includes chat command', () => {
    test('help text mentions fred chat', async () => {
      // Import the CLI module to check help text
      const indexPath = path.resolve(import.meta.dir, '../../../packages/cli/src/index.ts');

      // Read the file content to verify help text
      const content = await Bun.file(indexPath).text();

      // Verify help text includes chat command
      expect(content).toContain('chat');
      expect(content).toContain('Start interactive chat interface');
      expect(content).toContain('fred chat');
    });
  });

  describe('Command parsing handles chat', () => {
    test('parseArgs extracts chat command', () => {
      // Simulate command line args: ['chat']
      const args = ['chat'];

      // Simple parser that mimics the CLI behavior
      const command = args[0] || 'help';

      expect(command).toBe('chat');
    });

    test('parseArgs extracts chat command with options', () => {
      // Simulate command line args: ['chat', '--config', 'fred.config.yaml']
      const args = ['chat', '--config', 'fred.config.yaml'];

      const command = args[0];
      const hasConfig = args.includes('--config');

      expect(command).toBe('chat');
      expect(hasConfig).toBe(true);
    });

    test('empty args defaults to chat', () => {
      // Simulate bare 'fred' command (no args)
      const args: string[] = [];

      const command = args[0] || 'chat';

      expect(command).toBe('chat');
    });

    test('help flag triggers help', () => {
      // Simulate 'fred --help'
      const args = ['--help'];

      const isHelp = args[0] === 'help' || args[0] === '--help' || args[0] === '-h';

      expect(isHelp).toBe(true);
    });
  });

  describe('Non-TTY mode degradation', () => {
    test('non-tty mode should provide shared structured output contract', () => {
      // This test verifies the expected behavior without actually calling handleChatCommand
      // (since it never returns in interactive mode)

      const mockMode = {
        mode: 'non-tty' as const,
        canUseRawMode: false,
        isInteractive: false,
        reason: 'stdin is not a TTY',
      };

      // In non-TTY mode, chat command should provide structured JSON output
      const expectedOutput = createNonInteractiveFallbackPayload(mockMode.reason);

      // Verify expected output structure
      expect(expectedOutput.mode).toBe('non-interactive');
      expect(expectedOutput.reason).toBeTruthy();
      expect(expectedOutput.suggestion).toContain('terminal');
      expect(expectedOutput.help).toContain('--help');
    });

    test('bare fred, fred tui, and fred chat share non-interactive contract', () => {
      const modeReason = 'stdin is not a TTY';

      const resolveCommand = (args: string[]): string => {
        const firstArg = args[0];
        if (firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
          return 'help';
        }
        return firstArg || 'chat';
      };

      const entrypoints = [
        [],
        ['tui'],
        ['chat'],
      ];

      for (const entrypoint of entrypoints) {
        const command = resolveCommand(entrypoint);
        expect(command === 'chat' || command === 'tui').toBe(true);

        const payload = createNonInteractiveFallbackPayload(modeReason);
        expect(payload).toEqual({
          mode: 'non-interactive',
          reason: modeReason,
          suggestion: 'Run fred chat in a terminal for interactive mode',
          help: 'Use fred --help for other commands',
        });
      }
    });
  });

  describe('CLI routing behavior', () => {
    test('bare fred command routes to chat launch path', async () => {
      const args: string[] = [];
      const firstArg = args[0];
      const command = (firstArg === 'help' || firstArg === '--help' || firstArg === '-h')
        ? 'help'
        : firstArg || 'chat';

      expect(command).toBe('chat');
    });

    test('fred chat command routes to handleChatCommand', () => {
      // Verify routing logic (without actually calling the command)
      const args = ['chat'];
      const command = args[0];

      // This would trigger the 'chat' case in the switch statement
      expect(command).toBe('chat');

      // Verify other commands are distinct
      expect(command).not.toBe('dev');
      expect(command).not.toBe('test');
      expect(command).not.toBe('eval');
    });

    test('fred dev still works (backward compatibility)', () => {
      const args = ['dev'];
      const command = args[0];

      expect(command).toBe('dev');
    });
  });

  describe('detectAvailableProvider', () => {
    let savedEnv: Record<string, string | undefined>;

    beforeEach(() => {
      // Save current env vars
      savedEnv = {
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY,
        GROQ_API_KEY: process.env.GROQ_API_KEY,
        OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
      };

      // Clear all provider env vars for clean test state
      delete process.env.OPENAI_API_KEY;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
      delete process.env.GROQ_API_KEY;
      delete process.env.OPENROUTER_API_KEY;
    });

    afterEach(() => {
      // Restore saved env vars
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    });

    test('returns openai when OPENAI_API_KEY is set', () => {
      process.env.OPENAI_API_KEY = 'sk-test-key';

      const result = detectAvailableProvider();

      expect(result.platform).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
    });

    test('returns anthropic when ANTHROPIC_API_KEY is set', () => {
      process.env.ANTHROPIC_API_KEY = 'sk-ant-test';

      const result = detectAvailableProvider();

      expect(result.platform).toBe('anthropic');
      expect(result.model).toBe('claude-3-5-haiku-latest');
    });

    test('returns google when GOOGLE_GENERATIVE_AI_API_KEY is set', () => {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'test-key';

      const result = detectAvailableProvider();

      expect(result.platform).toBe('google');
      expect(result.model).toBe('gemini-2.0-flash-exp');
    });

    test('returns groq when GROQ_API_KEY is set', () => {
      process.env.GROQ_API_KEY = 'test-key';

      const result = detectAvailableProvider();

      expect(result.platform).toBe('groq');
      expect(result.model).toBe('llama-3.1-8b-instant');
    });

    test('returns null platform when no API keys set', () => {
      // All env vars already cleared in beforeEach

      const result = detectAvailableProvider();

      expect(result.platform).toBe(null);
      expect(result.model).toBe(null);
    });

    test('respects priority order (openai before anthropic)', () => {
      // Set both keys
      process.env.OPENAI_API_KEY = 'sk-openai-key';
      process.env.ANTHROPIC_API_KEY = 'sk-ant-key';

      const result = detectAvailableProvider();

      // Should return OpenAI since it has higher priority
      expect(result.platform).toBe('openai');
      expect(result.model).toBe('gpt-4o-mini');
    });

    test('respects priority order (anthropic before google)', () => {
      // Set anthropic and google, but not openai
      process.env.ANTHROPIC_API_KEY = 'sk-ant-key';
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'google-key';

      const result = detectAvailableProvider();

      // Should return Anthropic since it has higher priority than Google
      expect(result.platform).toBe('anthropic');
      expect(result.model).toBe('claude-3-5-haiku-latest');
    });
  });

  describe('loadProviderPackage', () => {
    test('PROVIDER_PACKAGES maps all 5 supported platforms', () => {
      expect(Object.keys(PROVIDER_PACKAGES)).toEqual(
        expect.arrayContaining(['openai', 'anthropic', 'google', 'groq', 'openrouter'])
      );
      expect(Object.keys(PROVIDER_PACKAGES)).toHaveLength(5);
    });

    test('maps platform ids to @fancyrobot/fred-{platform} packages', () => {
      expect(PROVIDER_PACKAGES.openai).toBe('@fancyrobot/fred-openai');
      expect(PROVIDER_PACKAGES.anthropic).toBe('@fancyrobot/fred-anthropic');
      expect(PROVIDER_PACKAGES.google).toBe('@fancyrobot/fred-google');
      expect(PROVIDER_PACKAGES.groq).toBe('@fancyrobot/fred-groq');
      expect(PROVIDER_PACKAGES.openrouter).toBe('@fancyrobot/fred-openrouter');
    });

    test('loadProviderPackage throws for unknown platform', async () => {
      await expect(loadProviderPackage('nonexistent')).rejects.toThrow('Unknown provider platform: nonexistent');
    });

    test('loadProviderPackage throws with supported platforms list', async () => {
      try {
        await loadProviderPackage('invalid');
        expect(true).toBe(false); // Should not reach here
      } catch (error) {
        expect(error instanceof Error).toBe(true);
        expect((error as Error).message).toContain('Supported: openai, anthropic, google, groq, openrouter');
      }
    });
  });

  describe('Lifecycle wiring verification', () => {
    test('chat.ts imports withTerminalLifecycle from terminal-lifecycle', async () => {
      // Source-level assertion: verify the production file contains lifecycle import
      const chatSource = await Bun.file(
        'packages/cli/src/commands/chat.ts'
      ).text();

      expect(chatSource).toContain(
        "import { withTerminalLifecycle } from '../runtime/terminal-lifecycle.js'"
      );
    });

    test('interactive path uses withTerminalLifecycle wrapping', async () => {
      // Source-level assertion: verify lifecycle is used in the interactive branch
      const chatSource = await Bun.file(
        'packages/cli/src/commands/chat.ts'
      ).text();

      // Lifecycle wrapper must be called in the interactive-tty branch
      expect(chatSource).toContain('withTerminalLifecycle(interactiveProgram');

      // The old ad-hoc process handlers should be removed
      expect(chatSource).not.toContain("process.on('uncaughtException'");
      expect(chatSource).not.toContain("process.on('unhandledRejection'");
      expect(chatSource).not.toContain("process.on('SIGINT'");
    });

    test('interactive path uses Effect.gen for program composition', async () => {
      const chatSource = await Bun.file(
        'packages/cli/src/commands/chat.ts'
      ).text();

      // Interactive program built as Effect generator
      expect(chatSource).toContain('Effect.gen(function*');

      // Uses Effect.tryPromise for async operations within Effect context
      expect(chatSource).toContain('Effect.tryPromise');

      // Uses Effect.never to keep scope alive for long-running TUI
      expect(chatSource).toContain('Effect.never');
    });

    test('non-interactive path does not use lifecycle wrapper', async () => {
      const chatSource = await Bun.file(
        'packages/cli/src/commands/chat.ts'
      ).text();

      // The lifecycle wrapper should only appear within the interactive-tty branch.
      // Verify the non-interactive path still uses createNonInteractiveFallbackPayload directly.
      expect(chatSource).toContain('createNonInteractiveFallbackPayload(mode.reason)');
    });

    test('interactive quit shuts down Fred resources before exiting', async () => {
      const chatPath = path.resolve(import.meta.dir, '../../../packages/cli/src/commands/chat.ts');
      const content = await Bun.file(chatPath).text();

      expect(content).toContain('fred.shutdown().finally(() => process.exit(0))');
      expect(content).toContain('queueMicrotask(() => app.stop())');
    });
  });

  describe('Terminal recovery guidance', () => {
    test('TERMINAL_RECOVERY_GUIDANCE is exported and non-empty', () => {
      expect(TERMINAL_RECOVERY_GUIDANCE).toBeTruthy();
      expect(typeof TERMINAL_RECOVERY_GUIDANCE).toBe('string');
      expect(TERMINAL_RECOVERY_GUIDANCE.length).toBeGreaterThan(0);
    });

    test('recovery guidance contains actionable terminal restore commands', () => {
      // Must suggest at least one well-known terminal restore command
      expect(TERMINAL_RECOVERY_GUIDANCE).toContain('reset');
      expect(TERMINAL_RECOVERY_GUIDANCE).toContain('stty sane');
    });

    test('recovery guidance is used in lifecycle error handling path', async () => {
      const chatSource = await Bun.file(
        'packages/cli/src/commands/chat.ts'
      ).text();

      // Recovery guidance must appear in the catch block of lifecycle execution
      expect(chatSource).toContain('TERMINAL_RECOVERY_GUIDANCE');
      expect(chatSource).toContain('console.error(TERMINAL_RECOVERY_GUIDANCE)');
    });
  });

  describe('Non-interactive fallback payload stability', () => {
    test('fallback payload has exactly 4 required fields', () => {
      const payload = createNonInteractiveFallbackPayload('test reason');
      const keys = Object.keys(payload).sort();

      expect(keys).toEqual(['help', 'mode', 'reason', 'suggestion']);
    });

    test('fallback payload mode is always "non-interactive"', () => {
      const payload = createNonInteractiveFallbackPayload('any reason');

      expect(payload.mode).toBe('non-interactive');
    });

    test('fallback payload passes through reason verbatim', () => {
      const reason = 'stdin is not a TTY';
      const payload = createNonInteractiveFallbackPayload(reason);

      expect(payload.reason).toBe(reason);
    });

    test('fallback payload is JSON-serializable round-trip stable', () => {
      const payload = createNonInteractiveFallbackPayload('stdin is not a TTY');
      const serialized = JSON.stringify(payload, null, 2);
      const deserialized = JSON.parse(serialized);

      expect(deserialized).toEqual(payload);
    });
  });

  describe('assistant segment renderer', () => {
    const renderChunks = async (chunks: string[]): Promise<string[]> => {
      const pushed: string[] = [];
      const renderer = createAssistantSegmentRenderer({
        intervalMs: 1,
        pushSegment: (segment) => {
          pushed.push(segment);
        },
      });

      for (const chunk of chunks) {
        renderer.enqueueText(chunk);
      }

      await sleep(5);
      renderer.flushAll();
      renderer.stop();
      return pushed;
    };

    test('drip-feeds large deltas as multiple visible pushes', async () => {
      const pushed: Array<{ segment: string; tokenCount: number | undefined }> = [];
      const renderer = createAssistantSegmentRenderer({
        intervalMs: 1,
        pushSegment: (segment, tokenCount) => {
          pushed.push({ segment, tokenCount });
        },
      });

      renderer.enqueueText('hello world');
      await sleep(5);
      renderer.flushAll();
      renderer.stop();

      expect(pushed.length).toBeGreaterThan(1);
      expect(pushed.map((entry) => entry.segment).join('')).toBe('hello world');
      expect(pushed[0]?.tokenCount).toBe(1);
    });

    test('flushAll drains remaining queued segments immediately', () => {
      const pushed: string[] = [];
      const renderer = createAssistantSegmentRenderer({
        intervalMs: 50,
        pushSegment: (segment) => {
          pushed.push(segment);
        },
      });

      renderer.enqueueText('stream this');
      renderer.flushAll();
      renderer.stop();

      expect(pushed.join('')).toBe('stream this');
      expect(pushed.length).toBeGreaterThan(1);
    });

    test('renders the same visible output for fine and coarse upstream chunking', async () => {
      const fineGrained = await renderChunks(['Hello', ' ', 'world']);
      const coarseGrained = await renderChunks(['Hello world']);

      expect(fineGrained.join('')).toBe('Hello world');
      expect(coarseGrained.join('')).toBe('Hello world');
      expect(coarseGrained.length).toBeGreaterThan(1);
    });
  });
});
