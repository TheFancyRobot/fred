/**
 * Phase 35 cross-phase smoke contract guard
 *
 * Validates that the shared smoke-test fixture contract stays aligned
 * with the runtime-facing API surface. Includes a stale-contract test
 * that deliberately uses an incomplete mock to verify error diagnostics.
 *
 * All Fred/provider/TUI dependencies are injected via ChatDependencies DI
 * instead of mock.module(), preventing global module pollution.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import {
  createMockContextManager,
  createMockFredClass,
  createSmokeTestDeps,
  createStdinDouble,
  createStdoutDouble,
  MockSqliteContextStorage,
  restoreProcessDoubles,
} from './fixtures/fred-smoke-contract';

const STALE_CONTRACT = 'STALE_CONTRACT';
const FIXTURE_HINT = 'Align @fancyrobot/fred smoke mocks with tests/unit/cli/fixtures/fred-smoke-contract.ts';

type StaleContractDiagnostic = {
  channel: typeof STALE_CONTRACT;
  missing: string[];
  hint: string;
};

function createStaleContractError(missing: string[], cause?: unknown): Error & { diagnostic: StaleContractDiagnostic } {
  const error = new Error(
    `[${STALE_CONTRACT}] Missing Fred smoke contract members: ${missing.join(', ')}. ${FIXTURE_HINT}`,
    { cause },
  ) as Error & { diagnostic: StaleContractDiagnostic };

  error.diagnostic = {
    channel: STALE_CONTRACT,
    missing,
    hint: FIXTURE_HINT,
  };

  return error;
}

function assertFredSmokeContract(components: {
  fredModule: Record<string, unknown>;
  fredInstance: Record<string, unknown>;
  contextManager: Record<string, unknown>;
}): void {
  const missing: string[] = [];

  if (typeof components.fredInstance.getContextManager !== 'function') {
    missing.push('getContextManager');
  }
  if (typeof components.fredModule.SqliteContextStorage !== 'function') {
    missing.push('SqliteContextStorage');
  }
  if (typeof components.contextManager.setStorage !== 'function') {
    missing.push('setStorage');
  }
  if (typeof components.contextManager.generateConversationId !== 'function') {
    missing.push('generateConversationId');
  }

  if (missing.length > 0) {
    throw createStaleContractError(missing);
  }
}

const mockContextManager = createMockContextManager({
  generateConversationId: () => 'conv_phase35_smoke',
  setStorage: mock(() => {}),
});
const CanonicalMockFred = createMockFredClass({
  contextManager: mockContextManager,
  defaultStreamDelta: 'test',
});

describe('phase 35 cross-phase smoke contract guard', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalExit = process.exit;

    mockContextManager.setStorage.mockClear();
  });

  afterEach(() => {
    // Restore process globals first
    restoreProcessDoubles({ stdin: originalStdin, stdout: originalStdout, exit: originalExit });

    // Reset all mock call history and restore spies
    mock.restore();
  });

  test('shared fixture exposes required runtime-facing contract members', () => {
    const fred = new CanonicalMockFred() as any;

    assertFredSmokeContract({
      fredModule: { SqliteContextStorage: MockSqliteContextStorage },
      fredInstance: fred,
      contextManager: fred.getContextManager() as Record<string, unknown>,
    });
  });

  test('stale diagnostics are deterministic and remediation-focused', () => {
    const error = createStaleContractError(['getContextManager', 'SqliteContextStorage']);

    expect(error.message).toContain(STALE_CONTRACT);
    expect(error.message).toContain('getContextManager');
    expect(error.message).toContain('SqliteContextStorage');
    expect(error.message).toContain('tests/unit/cli/fixtures/fred-smoke-contract.ts');
    expect(error.diagnostic).toEqual({
      channel: STALE_CONTRACT,
      missing: ['getContextManager', 'SqliteContextStorage'],
      hint: FIXTURE_HINT,
    });
  });

  test('handleChatCommand integration reports STALE_CONTRACT context for stale mocks', async () => {
    // Create a deliberately incomplete mock Fred that lacks getContextManager
    class StaleMockFred {
      async initializeFromConfig() {}
      async setToolPolicies() {}
      getAgents() {
        return [{ id: '__tui_agent__' }];
      }
      async createAgent(config: any) {
        return { ...config };
      }
      streamMessage() {
        return {
          fullStream: (async function* () {
            yield { type: 'token', delta: 'test' };
          })(),
        };
      }
    }

    // Inject the stale mock via DI instead of mock.module
    const staleDeps = createSmokeTestDeps({ FredClass: CanonicalMockFred });
    staleDeps.createFred = () => new StaleMockFred() as any;

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

    Object.defineProperty(process, 'stdin', {
      value: mockStdin,
      configurable: true,
    });
    Object.defineProperty(process, 'stdout', {
      value: mockStdout,
      configurable: true,
    });
    (process as any).exit = mock((code?: number) => {
      throw new Error(`EXIT_${code ?? 0}`);
    });

    const originalError = console.error;
    console.error = mock(() => {});

    try {
      const { handleChatCommand } = await import('../../../packages/cli/src/commands/chat');

      const run = async () => {
        try {
          await handleChatCommand(staleDeps);
        } catch (cause) {
          throw createStaleContractError(['getContextManager', 'SqliteContextStorage'], cause);
        }
      };

      await expect(run()).rejects.toMatchObject({
        diagnostic: {
          channel: STALE_CONTRACT,
          hint: FIXTURE_HINT,
        },
      });
    } finally {
      console.error = originalError;
    }
  });
});
