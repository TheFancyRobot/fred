/**
 * Smoke tests for Groq retry diagnostics in `fred run --json`.
 *
 * These tests simulate the full error propagation chain:
 *   Groq provider (transient HTTP failure)
 *     -> AgentFactory retry boundary (extracts _retryDiagnostics)
 *       -> run command catch block (emits structured JSON)
 *
 * No actual HTTP calls are made; errors are injected via mock Fred instances.
 */

import { describe, expect, test } from 'bun:test';
import { Fred } from '@fancyrobot/fred';
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

function createMockFredWithProcessMessage(
  agentId: string,
  processMessageFn: (message: string) => Promise<any>,
): Fred {
  const fred = new Fred();
  (fred as any).getAgent = (id: string) =>
    id === agentId
      ? { id: agentId, config: { model: 'llama-3.3-70b-versatile', platform: 'groq' } }
      : undefined;
  (fred as any).getAgents = () => [
    { id: agentId, config: { model: 'llama-3.3-70b-versatile', platform: 'groq' } },
  ];
  (fred as any).processMessage = processMessageFn;
  return fred;
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
    const error = new Error(
      'HTTP request failed after 4 attempt(s) (transient)',
    );
    (error as any)._retryDiagnostics = diagnostics;

    const fred = createMockFredWithProcessMessage('groq-agent', async () => {
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

    const meta = doc.meta as any;
    expect(meta).toBeDefined();
    expect(meta.details).toBeDefined();
    expect(meta.details.retryDiagnostics.provider).toBe('groq');
    expect(meta.details.retryDiagnostics.retryable).toBe(true);
    expect(meta.details.retryDiagnostics.attempts).toBe(4);
    expect(meta.details.retryDiagnostics.maxRetries).toBe(3);
    expect(meta.details.retryDiagnostics.lastStatusCode).toBe(503);
    expect(meta.details.retryDiagnostics.failureCategory).toBe('transient');
    expect(meta.details.category).toBe('transient');
    expect(meta.details.suggestion).toContain('Retry the request');
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
    const error = new Error('HTTP request failed: non-retryable 401 error');
    (error as any)._retryDiagnostics = diagnostics;

    const fred = createMockFredWithProcessMessage('groq-agent', async () => {
      throw error;
    });

    const exitCode = await handleRunCommand(
      [],
      { agent: 'groq-agent', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const doc = parseJsonOutput(captured.output);
    const meta = doc.meta as any;

    expect(meta.details.retryDiagnostics.retryable).toBe(false);
    expect(meta.details.retryDiagnostics.attempts).toBe(1);
    expect(meta.details.retryDiagnostics.lastStatusCode).toBe(401);
    expect(meta.details.category).toBe('configuration');
    expect(meta.details.suggestion).toContain('Check API key');
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
    const error = new Error('Rate limit exceeded after 4 attempt(s)');
    (error as any)._retryDiagnostics = diagnostics;

    const fred = createMockFredWithProcessMessage('groq-agent', async () => {
      throw error;
    });

    const exitCode = await handleRunCommand(
      [],
      { agent: 'groq-agent', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const doc = parseJsonOutput(captured.output);
    const meta = doc.meta as any;

    expect(meta.details.retryDiagnostics.failureCategory).toBe('rate-limit');
    expect(meta.details.retryDiagnostics.lastStatusCode).toBe(429);
    expect(meta.details.category).toBe('transient');
  });

  test('successful request after mock retry produces no diagnostics', async () => {
    const captured = createCapturingIO();

    // Simulate successful response (no retries needed)
    const fred = createMockFredWithProcessMessage('groq-agent', async () => ({
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
    const error = new Error('Transient failure');
    (error as any)._retryDiagnostics = diagnostics;

    const fred = createMockFredWithProcessMessage('groq-agent', async () => {
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
