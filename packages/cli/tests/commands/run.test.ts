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
import { RUN_JSON_CHANNEL_VIOLATION_EXIT_CODE, RunJsonChannel } from '../../src/runtime/json-channel';

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

interface MockAgentConfig {
  id: string;
  response?: AgentResponse | null;
}

const makeMockAgent = (id: string): AgentInstance => {
  const config: AgentConfig = { id, model: 'test-model', platform: 'test' };
  return {
    id,
    config,
    run: () => Effect.succeed({ content: '' }),
    processMessage: () => Effect.succeed({ content: '' }),
  };
};

async function createMockFred(
  agents: MockAgentConfig[] = [],
  processMessage?: (message: string, options?: Parameters<FredClient['messages']['process']>[1]) => Promise<AgentResponse>,
): Promise<FredClient> {
  const fred = await createFred();
  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const instances = agents.map((agent) => makeMockAgent(agent.id));
  return {
    ...fred,
    agents: {
      ...fred.agents,
      get: async (id) => agentMap.has(id) ? makeMockAgent(id) : null,
      list: async () => instances,
    },
    messages: {
      process: processMessage ?? (async () => {
        const first = agents[0];
        if (!first?.response) throw new Error('No response from agent.');
        return first.response;
      }),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('run command', () => {
  test('returns response content on success', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'Hello from agent!' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello' },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toBe('Hello from agent!');
    expect(captured.errors).toHaveLength(0);
  });

  test('returns structured JSON with --json flag', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'JSON response', toolCalls: [] } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.agent).toBe('assistant');
    expect(payload.content).toBe('JSON response');
    expect(payload.toolCalls).toEqual([]);
  });

  test('errors when --agent is missing', async () => {
    const captured = createCapturingIO();

    const exitCode = await handleRunCommand(
      [],
      { input: 'hello' },
      { io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors[0]).toContain('--agent');
    expect(captured.errors[0]).toContain('required');
  });

  test('errors when --input is missing (TTY mode)', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'response' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant' },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors[0]).toContain('No input provided');
  });

  test('errors when agent is not found', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'helper', response: { content: 'response' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'nonexistent', input: 'hello' },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors[0]).toContain('not found');
    expect(captured.errors[0]).toContain('nonexistent');
  });

  test('errors when agent returns null response', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: null },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello' },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors[0]).toContain('No response');
  });

  test('shows tool calls on stderr with --verbose', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      {
        id: 'assistant',
        response: {
          content: 'The result is 4',
          toolCalls: [
            { toolId: 'calculator', args: { expression: '2+2' }, result: '4' },
          ],
        },
      },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'what is 2+2?', verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    // Content on stdout
    expect(captured.output[0]).toBe('The result is 4');
    // Tool calls on stderr
    expect(captured.errors[0]).toContain('[tool: calculator]');
    expect(captured.errors[0]).toContain('2+2');
  });

  test('reads input from stdin when piped', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'Piped response' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant' },
      {
        fred,
        io: captured.io,
        stdin: async () => 'piped input message',
      },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toBe('Piped response');
  });

  test('--json includes toolCalls array even when empty', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'No tools used' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.toolCalls).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  JSON Channel Contract Tests                                       */
/* ------------------------------------------------------------------ */

describe('run command --json channel contract', () => {
  /**
   * Helper: parse exactly one JSON document from stdout array.
   * Asserts the array has exactly one entry and it parses cleanly.
   */
  function parseOneJsonDoc(output: string[]): Record<string, unknown> {
    expect(output).toHaveLength(1);
    const doc = JSON.parse(output[0]!);
    expect(typeof doc).toBe('object');
    return doc;
  }

  /* ---- Success path ---- */

  test('JSON success emits exactly one stdout doc and zero stderr', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'Hello!', toolCalls: [] } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hi', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(true);
    expect(doc.agent).toBe('assistant');
    expect(doc.content).toBe('Hello!');
    expect(doc.toolCalls).toEqual([]);
  });

  /* ---- Error paths ---- */

  test('JSON error: --agent missing emits one stdout JSON doc, zero stderr', async () => {
    const captured = createCapturingIO();

    const exitCode = await handleRunCommand(
      [],
      { input: 'hello', json: true },
      { io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('--agent');
  });

  test('JSON error: missing input emits one stdout JSON doc, zero stderr', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'response' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('No input provided');
  });

  test('JSON error: unknown agent emits one stdout JSON doc, zero stderr', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'helper', response: { content: 'response' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'nonexistent', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('not found');
    expect(doc.error).toContain('nonexistent');
  });

  test('JSON error: null response emits one stdout JSON doc, zero stderr', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: null },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('No response');
  });

  test('JSON error: runtime throw emits one stdout JSON doc, zero stderr', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'ok' } },
    ]);
    // Override processMessage to throw
    fred.messages.process = async () => {
      throw new Error('LLM provider timeout');
    };

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('LLM provider timeout');
  });

  /* ---- Startup warnings ---- */

  test('JSON mode: startup warnings serialize under meta.warnings', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'response' } },
    ]);

    // Simulate config initialization warning by directly using the channel
    // We test via initializeFred indirectly: the warn path is exercised
    // when config loading fails. But since we inject fred directly, we need
    // a more direct test.
    //
    // Test the RunJsonChannel directly for warning accumulation:
    const directCaptured = createCapturingIO();
    const channel = new RunJsonChannel(directCaptured.io, true);
    channel.warn('Config file not found');
    channel.warn('Plugin X failed to load');
    const exitCode = channel.emitSuccess({
      agent: 'assistant',
      content: 'response',
    });

    expect(exitCode).toBe(0);
    expect(directCaptured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(directCaptured.output);
    expect(doc.ok).toBe(true);
    expect(doc.meta).toEqual(expect.objectContaining({
      warnings: ['Config file not found', 'Plugin X failed to load'],
    }));
  });

  test('JSON mode: warnings included in error payload too', async () => {
    const captured = createCapturingIO();
    const channel = new RunJsonChannel(captured.io, true);
    channel.warn('Partial config loaded');
    const exitCode = channel.emitError('Agent not found', 1);

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.meta).toEqual(expect.objectContaining({ warnings: ['Partial config loaded'] }));
  });

  /* ---- Verbose tool-call diagnostics in JSON mode ---- */

  test('JSON mode: verbose tool calls fold into meta.verbose', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      {
        id: 'assistant',
        response: {
          content: 'Result is 4',
          toolCalls: [
            { toolId: 'calculator', args: { expression: '2+2' }, result: '4' },
          ],
        },
      },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'what is 2+2?', json: true, verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(true);
    // Verbose diagnostics captured in meta.stderr (channel.diagnostic lines)
    expect(doc.meta).toEqual(expect.objectContaining({
      stderr: [expect.stringContaining('[tool: calculator]')],
      verbose: expect.objectContaining({
        toolCalls: [expect.objectContaining({ toolId: 'calculator' })],
      }),
    }));
  });

  test('JSON mode: non-verbose success has no meta field', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'Simple response' } },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.meta).toBeUndefined();
  });

  /* ---- Contract violation ---- */

  test('RunJsonChannel: second emit returns violation exit code', () => {
    const captured = createCapturingIO();
    const channel = new RunJsonChannel(captured.io, true);

    const first = channel.emitSuccess({ agent: 'a', content: 'first' });
    expect(first).toBe(0);
    expect(captured.output).toHaveLength(1);

    // Second emit is a contract violation
    const second = channel.emitError('should not appear', 1);
    expect(second).toBe(RUN_JSON_CHANNEL_VIOLATION_EXIT_CODE);
    // Still only one document emitted
    expect(captured.output).toHaveLength(1);
    expect(captured.errors).toHaveLength(0);
  });

  test('RunJsonChannel: violation exit code is 78', () => {
    expect(RUN_JSON_CHANNEL_VIOLATION_EXIT_CODE).toBe(78);
  });

  /* ---- Text mode unchanged ---- */

  test('text mode: errors still go to stderr (not stdout)', async () => {
    const captured = createCapturingIO();

    const exitCode = await handleRunCommand(
      [],
      { input: 'hello' },  // no --agent, no --json
      { io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.output).toHaveLength(0);
    expect(captured.errors.length).toBeGreaterThan(0);
    expect(captured.errors[0]).toContain('--agent');
  });

  test('text mode: verbose tool calls still go to stderr', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      {
        id: 'assistant',
        response: {
          content: 'The result is 4',
          toolCalls: [
            { toolId: 'calculator', args: { expression: '2+2' }, result: '4' },
          ],
        },
      },
    ]);

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'what is 2+2?', verbose: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toBe('The result is 4');
    expect(captured.errors[0]).toContain('[tool: calculator]');
  });
});

/* ------------------------------------------------------------------ */
/*  Structured Retry Diagnostics Tests                                */
/* ------------------------------------------------------------------ */

describe('run command --json retry diagnostics', () => {
  function parseOneJsonDoc(output: string[]): Record<string, unknown> {
    expect(output).toHaveLength(1);
    const doc = JSON.parse(output[0]!);
    expect(typeof doc).toBe('object');
    return doc;
  }

  test('JSON error: transient provider failure includes retryDiagnostics in meta.details', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'ok' } },
    ]);

    const diagnostics = {
      provider: 'groq',
      retryable: true,
      attempts: 4,
      maxRetries: 3,
      lastStatusCode: 503,
      failureCategory: 'transient',
    };
    const error = Object.assign(new Error('HTTP request failed after 4 attempt(s) (transient)'), {
      _retryDiagnostics: diagnostics,
    });
    fred.messages.process = async () => { throw error; };

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors).toHaveLength(0);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('HTTP request failed after 4 attempt(s)');

    expect(doc.meta).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        retryDiagnostics: diagnostics,
        category: 'transient',
        suggestion: expect.stringContaining('Retry the request'),
      }),
    }));
  });

  test('JSON error: non-retryable 401 includes configuration diagnostics', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'ok' } },
    ]);

    const diagnostics = {
      provider: 'groq',
      retryable: false,
      attempts: 1,
      maxRetries: 3,
      lastStatusCode: 401,
      failureCategory: 'non-retryable',
    };
    const error = Object.assign(new Error('HTTP request failed: non-retryable 401 error'), {
      _retryDiagnostics: diagnostics,
    });
    fred.messages.process = async () => { throw error; };

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.meta).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        retryDiagnostics: expect.objectContaining({ retryable: false, lastStatusCode: 401 }),
        category: 'configuration',
        suggestion: expect.stringContaining('Check API key'),
      }),
    }));
  });

  test('JSON error: plain error without diagnostics has no meta.details', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'ok' } },
    ]);

    fred.messages.process = async () => { throw new Error('Generic failure'); };

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.ok).toBe(false);
    expect(doc.error).toContain('Generic failure');
    expect(doc.meta).toBeUndefined();
  });

  test('JSON error: rate-limit 429 includes transient diagnostics', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'ok' } },
    ]);

    const diagnostics = {
      provider: 'groq',
      retryable: true,
      attempts: 4,
      maxRetries: 3,
      lastStatusCode: 429,
      failureCategory: 'rate-limit',
    };
    const error = Object.assign(new Error('Rate limited'), { _retryDiagnostics: diagnostics });
    fred.messages.process = async () => { throw error; };

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello', json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    const doc = parseOneJsonDoc(captured.output);
    expect(doc.meta).toEqual(expect.objectContaining({
      details: expect.objectContaining({
        retryDiagnostics: expect.objectContaining({ failureCategory: 'rate-limit' }),
        category: 'transient',
        suggestion: expect.stringContaining('rate-limit'),
      }),
    }));
  });

  test('text mode: error with diagnostics still outputs plain error', async () => {
    const captured = createCapturingIO();
    const fred = await createMockFred([
      { id: 'assistant', response: { content: 'ok' } },
    ]);

    const diagnostics = {
      provider: 'groq',
      retryable: true,
      attempts: 4,
      maxRetries: 3,
      failureCategory: 'transient',
    };
    const error = Object.assign(new Error('HTTP request failed after 4 attempt(s)'), {
      _retryDiagnostics: diagnostics,
    });
    fred.messages.process = async () => { throw error; };

    const exitCode = await handleRunCommand(
      [],
      { agent: 'assistant', input: 'hello' }, // no --json
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.output).toHaveLength(0);
    expect(captured.errors[0]).toContain('HTTP request failed');
  });
});
