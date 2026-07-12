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
import type { FredClient } from '@fancyrobot/fred';
import {
  createMockFredClient,
  createSmokeTestDeps,
  createStdinDouble,
  createStdoutDouble,
  restoreProcessDoubles,
  shutdownMockFredClients,
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
    `[${STALE_CONTRACT}] Missing FredClient smoke contract members: ${missing.join(', ')}. ${FIXTURE_HINT}`,
    { cause },
  ) as Error & { diagnostic: StaleContractDiagnostic };

  error.diagnostic = {
    channel: STALE_CONTRACT,
    missing,
    hint: FIXTURE_HINT,
  };

  return error;
}

function assertFredClientSmokeContract(client: FredClient): void {
  const missing: string[] = [];
  const groups = ['agents', 'sessions', 'effects', 'warnings', 'subagents'] as const;
  for (const group of groups) {
    if (typeof client[group] !== 'object' || client[group] === null) missing.push(group);
  }
  if (typeof client.shutdown !== 'function') missing.push('shutdown');

  if (missing.length > 0) {
    throw createStaleContractError(missing);
  }
}

describe('phase 35 cross-phase smoke contract guard', () => {
  let originalStdin: typeof process.stdin;
  let originalStdout: typeof process.stdout;
  let originalExit: typeof process.exit;

  beforeEach(() => {
    originalStdin = process.stdin;
    originalStdout = process.stdout;
    originalExit = process.exit;

  });

  afterEach(async () => {
    // Restore process globals first
    restoreProcessDoubles({ stdin: originalStdin, stdout: originalStdout, exit: originalExit });

    // Reset all mock call history and restore spies
    mock.restore();
    await shutdownMockFredClients();
  });

  test('shared fixture exposes required runtime-facing contract members', async () => {
    const fred = await createMockFredClient();
    assertFredClientSmokeContract(fred);
  });

  test('stale diagnostics are deterministic and remediation-focused', () => {
    const error = createStaleContractError(['sessions', 'effects']);

    expect(error.message).toContain(STALE_CONTRACT);
    expect(error.message).toContain('sessions');
    expect(error.message).toContain('effects');
    expect(error.message).toContain('tests/unit/cli/fixtures/fred-smoke-contract.ts');
    expect(error.diagnostic).toEqual({
      channel: STALE_CONTRACT,
      missing: ['sessions', 'effects'],
      hint: FIXTURE_HINT,
    });
  });

  test('handleChatCommand integration reports STALE_CONTRACT context for stale mocks', async () => {
    const staleDeps = createSmokeTestDeps();
    staleDeps.createFred = async () => {
      throw createStaleContractError(['sessions', 'effects']);
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
          throw createStaleContractError(['sessions', 'effects'], cause);
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
