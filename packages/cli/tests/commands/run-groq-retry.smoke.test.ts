/**
 * Smoke tests for Groq retry diagnostics in `fred run --json`.
 *
 * These tests simulate the full error propagation chain:
 *   Groq provider (transient HTTP failure)
 *     -> AgentFactory retry boundary (extracts _retryDiagnostics)
 *       -> run command catch block (emits structured JSON)
 *
 * No actual HTTP calls are made; errors are injected via mock FredClient instances.
 */

import { describe, expect, test } from 'bun:test';
import {
  createFred,
  type AgentConfig,
  type AgentInstance,
  type AgentResponse,
  type FredClient,
} from '@fancyrobot/fred';
import { Effect } from 'effect';
import { handleRunCommand } from '../../src/commands/run';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createCapturingIO() {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      stdout: (msg: string) => output.push(msg),
      stderr: (msg: string) => errors.push(msg),
    },
    output,
    errors,
  };
}

async function createMockFredWithProcessMessage(
  agentId: string,
  processMessage: (message: string) => Promise<AgentResponse>,
): Promise<FredClient> {
  const fred = await createFred();
  const config: AgentConfig = {
    id: agentId,
    model: 'llama-3.3-70b-versatile',
    platform: 'groq',
  };
  const agent: AgentInstance = {
    id: agentId,
    config,
    run: () => Effect.succeed({ content: '' }),
    processMessage: () => Effect.succeed({ content: '' }),
  };
  return {
    ...fred,
    agents: {
      ...fred.agents,
      get: async (id) => id === agentId ? agent : null,
      list: async () => [agent],
    },
    messages: { process: processMessage },
  };
}

function parseJsonOutput(output: string[]): Record<string, unknown> {
  expect(output).toHaveLength(1);
  return JSON.parse(output[0]!);
}

/* ------------------------------------------------------------------ */
/*  Smoke: Transient failure then success (simulated)                 */
/* ------------------------------------------------------------------ */

describe('run-groq-retry smoke tests', () => {
  test('503 transient failure produces structured diagnostics in JSON payload', async () => {
    const captured = createCapturingIO();

    // Simulate Groq provider exhausting retries on 503
    const diagnostics = {
      provider: 'groq',
      retryable: true,
      attempts: 4,
      maxRetries: 3,
      lastStatusCode: 503,
      failureCategory: 'transient' as const,
    };
    const error = Object.assign(
      new Error('HTTP request failed after 4 attempt(s) (transient)'),
      { _retryDiagnostics: diagnostics },
    );

    const fred = await createMockFredWithProcessMessage('groq-agent', async () => {
      throw error;
    });

    const exitCode = await handleRunCommand(
      [],
      { agent: 'groq-agent', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0); // No stderr leakage in JSON mode

    const doc = parseJsonOutput(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('4 attempt(s)');

    expect(doc.meta).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        retryDiagnostics: diagnostics,
        category: 'transient',
        suggestion: expect.stringContaining('Retry the request'),
      }),
    }));
  });

  test('401 non-retryable failure produces fail-fast diagnostics in JSON payload', async () => {
    const captured = createCapturingIO();

    const diagnostics = {
      provider: 'groq',
      retryable: false,
      attempts: 1,
      maxRetries: 3,
      lastStatusCode: 401,
      failureCategory: 'non-retryable' as const,
    };
    const error = Object.assign(new Error('HTTP request failed: non-retryable 401 error'), {
      _retryDiagnostics: diagnostics,
    });

    const fred = await createMockFredWithProcessMessage('groq-agent', async () => {
      throw error;
    });

    const exitCode = await handleRunCommand(
      [],
      { agent: 'groq-agent', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const doc = parseJsonOutput(captured.output);
    expect(doc.meta).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        retryDiagnostics: diagnostics,
        category: 'configuration',
        suggestion: expect.stringContaining('Check API key'),
      }),
    }));
  });

  test('429 rate-limit failure produces transient diagnostics with rate-limit category', async () => {
    const captured = createCapturingIO();

    const diagnostics = {
      provider: 'groq',
      retryable: true,
      attempts: 4,
      maxRetries: 3,
      lastStatusCode: 429,
      failureCategory: 'rate-limit' as const,
    };
    const error = Object.assign(new Error('Rate limit exceeded after 4 attempt(s)'), {
      _retryDiagnostics: diagnostics,
    });

    const fred = await createMockFredWithProcessMessage('groq-agent', async () => {
      throw error;
    });

    const exitCode = await handleRunCommand(
      [],
      { agent: 'groq-agent', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const doc = parseJsonOutput(captured.output);
    expect(doc.meta).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        retryDiagnostics: diagnostics,
        category: 'transient',
      }),
    }));
  });

  test('successful request after mock retry produces no diagnostics', async () => {
    const captured = createCapturingIO();

    // Simulate successful response (no retries needed)
    const fred = await createMockFredWithProcessMessage('groq-agent', async () => ({
      content: 'Hello from Groq!',
      toolCalls: [],
    }));

    const exitCode = await handleRunCommand(
      [],
      { agent: 'groq-agent', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const doc = parseJsonOutput(captured.output);
    expect(doc.ok).toBe(true);
    expect(doc.content).toBe('Hello from Groq!');
    expect(doc.meta).toBeUndefined(); // No diagnostics on success
  });

  test('non-JSON mode with retry diagnostics still outputs plain error', async () => {
    const captured = createCapturingIO();

    const diagnostics = {
      provider: 'groq',
      retryable: true,
      attempts: 4,
      maxRetries: 3,
      lastStatusCode: 503,
      failureCategory: 'transient' as const,
    };
    const error = Object.assign(new Error('Transient failure'), { _retryDiagnostics: diagnostics });

    const fred = await createMockFredWithProcessMessage('groq-agent', async () => {
      throw error;
    });

    const exitCode = await handleRunCommand(
      [],
      { agent: 'groq-agent', input: 'hello' }, // No --json flag
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.output).toHaveLength(0); // No stdout in text error mode
    expect(captured.errors.length).toBeGreaterThan(0);
    expect(captured.errors[0]).toContain('Transient failure');
  });
});
