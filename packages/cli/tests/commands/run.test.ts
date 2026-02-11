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

interface MockAgentConfig {
  id: string;
  response?: { content: string; toolCalls?: Array<{ toolId: string; args: Record<string, any>; result?: any }> } | null;
}

function createMockFred(agents: MockAgentConfig[] = []): Fred {
  const fred = new Fred();
  const agentMap = new Map(agents.map((a) => [a.id, a]));

  (fred as any).getAgent = (id: string) => {
    const mock = agentMap.get(id);
    if (!mock) return undefined;
    return { id: mock.id, config: { model: 'test-model', platform: 'test' } };
  };

  (fred as any).getAgents = () =>
    agents.map((a) => ({ id: a.id, config: { model: 'test-model', platform: 'test' } }));

  (fred as any).processMessage = async (_message: string, _options?: any) => {
    // Use the first agent's response (run command targets a specific agent)
    const first = agents[0];
    if (!first) return null;
    return first.response ?? null;
  };

  return fred;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('run command', () => {
  test('returns response content on success', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
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
    const fred = createMockFred([
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
    const fred = createMockFred([
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
    const fred = createMockFred([
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
    const fred = createMockFred([
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
    const fred = createMockFred([
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
    const fred = createMockFred([
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
    const fred = createMockFred([
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
