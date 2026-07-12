import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createFred, type FredClient } from '@fancyrobot/fred';
import { IntentMatcherService, ProviderRegistryService } from '@fancyrobot/fred/effect';
import { Effect } from 'effect';
import { handleListCommand } from '../../src/commands/list';

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

interface MockEntities {
  agents?: Array<{ id: string; config: { model: string; platform: string } }>;
  tools?: Array<{ id: string; name: string; description: string }>;
  intents?: Array<{
    id: string;
    action: { type: string; target: string };
    utterances: string[];
  }>;
  providers?: string[];
  workflows?: string[] | undefined;
}

async function createMockFred(entities: MockEntities = {}): Promise<FredClient> {
  const fred = await createFred();
  await fred.effects.run(Effect.flatMap(IntentMatcherService, (service) =>
    service.registerIntents(entities.intents ?? []),
  ));
  for (const id of entities.providers ?? []) {
    await fred.effects.run(Effect.flatMap(ProviderRegistryService, (service) =>
      service.registerDefinition({ id, aliases: [], models: {}, getModel: () => Effect.dieMessage('unused') }),
    ));
  }

  return {
    ...fred,
    agents: { ...fred.agents, list: async () => entities.agents ?? [] },
    tools: { ...fred.tools, list: async () => entities.tools ?? [] },
    workflows: {
      ...fred.workflows,
      list: async () => (entities.workflows ?? []).map((id) => ({ id, source: 'v2' as const })),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('list command', () => {
  let captured: ReturnType<typeof createCapturingIO>;

  beforeEach(() => {
    captured = createCapturingIO();
  });

  afterEach(() => {
    captured.output.length = 0;
    captured.errors.length = 0;
  });

  /* --- agents --- */

  describe('agents', () => {
    test('outputs table with agent details', async () => {
      const fred = await createMockFred({
        agents: [
          { id: 'agent-1', config: { model: 'gpt-4', platform: 'openai' } },
          { id: 'agent-2', config: { model: 'claude-3', platform: 'anthropic' } },
        ],
      });

      const exitCode = await handleListCommand('agents', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const out = captured.output.join('\n');
      expect(out).toContain('ID');
      expect(out).toContain('Model');
      expect(out).toContain('Platform');
      expect(out).toContain('agent-1');
      expect(out).toContain('gpt-4');
      expect(out).toContain('openai');
      expect(out).toContain('agent-2');
      expect(out).toContain('claude-3');
      expect(out).toContain('anthropic');
    });

    test('outputs JSON when --json flag set', async () => {
      const fred = await createMockFred({
        agents: [
          { id: 'agent-1', config: { model: 'gpt-4', platform: 'openai' } },
        ],
      });

      const exitCode = await handleListCommand('agents', [], { json: true }, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(captured.output[0] ?? '{}');
      expect(payload.ok).toBe(true);
      expect(payload.command).toBe('agents');
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].id).toBe('agent-1');
      expect(payload.data[0].model).toBe('gpt-4');
      expect(payload.data[0].platform).toBe('openai');
    });

    test('shows empty-state message when no agents', async () => {
      const fred = await createMockFred({ agents: [] });

      const exitCode = await handleListCommand('agents', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      expect(captured.output[0]).toBe('No agents registered.');
    });
  });

  /* --- tools --- */

  describe('tools', () => {
    test('outputs table with tool details', async () => {
      const fred = await createMockFred({
        tools: [
          { id: 'calc', name: 'Calculator', description: 'Evaluate arithmetic expressions safely' },
        ],
      });

      const exitCode = await handleListCommand('tools', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const out = captured.output.join('\n');
      expect(out).toContain('ID');
      expect(out).toContain('Name');
      expect(out).toContain('Description');
      expect(out).toContain('calc');
      expect(out).toContain('Calculator');
      expect(out).toContain('Evaluate arithmetic');
    });

    test('truncates long descriptions', async () => {
      const fred = await createMockFred({
        tools: [
          {
            id: 'long-desc',
            name: 'LongTool',
            description: 'A'.repeat(100),
          },
        ],
      });

      const exitCode = await handleListCommand('tools', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const out = captured.output.join('\n');
      // Description should be truncated to 60 chars with ellipsis
      expect(out).not.toContain('A'.repeat(100));
      expect(out).toContain('...');
    });

    test('outputs JSON for tools', async () => {
      const fred = await createMockFred({
        tools: [
          { id: 'calc', name: 'Calculator', description: 'Evaluate arithmetic' },
        ],
      });

      const exitCode = await handleListCommand('tools', [], { json: true }, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(captured.output[0] ?? '{}');
      expect(payload.ok).toBe(true);
      expect(payload.command).toBe('tools');
      expect(payload.data[0].id).toBe('calc');
      expect(payload.data[0].description).toBe('Evaluate arithmetic');
    });

    test('shows empty-state for tools', async () => {
      const fred = await createMockFred({ tools: [] });

      const exitCode = await handleListCommand('tools', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      expect(captured.output[0]).toBe('No tools registered.');
    });
  });

  /* --- intents --- */

  describe('intents', () => {
    test('outputs table with intent details and utterance count', async () => {
      const fred = await createMockFred({
        intents: [
          {
            id: 'greet',
            action: { type: 'agent', target: 'greeter' },
            utterances: ['hello', 'hi', 'hey'],
          },
        ],
      });

      const exitCode = await handleListCommand('intents', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const out = captured.output.join('\n');
      expect(out).toContain('ID');
      expect(out).toContain('Target');
      expect(out).toContain('Utterances');
      expect(out).toContain('greet');
      expect(out).toContain('greeter');
      expect(out).toContain('3 phrases');
    });

    test('outputs JSON for intents with full utterance list', async () => {
      const fred = await createMockFred({
        intents: [
          {
            id: 'greet',
            action: { type: 'agent', target: 'greeter' },
            utterances: ['hello', 'hi'],
          },
        ],
      });

      const exitCode = await handleListCommand('intents', [], { json: true }, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(captured.output[0] ?? '{}');
      expect(payload.ok).toBe(true);
      expect(payload.command).toBe('intents');
      expect(payload.data[0].id).toBe('greet');
      expect(payload.data[0].target).toBe('greeter');
      expect(payload.data[0].utteranceCount).toBe(2);
      expect(payload.data[0].utterances).toEqual(['hello', 'hi']);
    });

    test('shows empty-state for intents', async () => {
      const fred = await createMockFred({ intents: [] });

      const exitCode = await handleListCommand('intents', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      expect(captured.output[0]).toBe('No intents registered.');
    });
  });

  /* --- providers --- */

  describe('providers', () => {
    test('outputs table with provider names', async () => {
      const fred = await createMockFred({
        providers: ['openai', 'anthropic'],
      });

      const exitCode = await handleListCommand('providers', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const out = captured.output.join('\n');
      expect(out).toContain('Provider');
      expect(out).toContain('openai');
      expect(out).toContain('anthropic');
    });

    test('outputs JSON for providers', async () => {
      const fred = await createMockFred({
        providers: ['openai'],
      });

      const exitCode = await handleListCommand('providers', [], { json: true }, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(captured.output[0] ?? '{}');
      expect(payload.ok).toBe(true);
      expect(payload.command).toBe('providers');
      expect(payload.data[0].id).toBe('openai');
    });

    test('shows empty-state for providers', async () => {
      const fred = await createMockFred({ providers: [] });

      const exitCode = await handleListCommand('providers', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      expect(captured.output[0]).toBe('No providers registered.');
    });
  });

  /* --- workflows --- */

  describe('workflows', () => {
    test('outputs table with workflow names', async () => {
      const fred = await createMockFred({
        workflows: ['onboarding', 'support'],
      });

      const exitCode = await handleListCommand('workflows', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const out = captured.output.join('\n');
      expect(out).toContain('Workflow');
      expect(out).toContain('onboarding');
      expect(out).toContain('support');
    });

    test('outputs JSON for workflows', async () => {
      const fred = await createMockFred({
        workflows: ['onboarding'],
      });

      const exitCode = await handleListCommand('workflows', [], { json: true }, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      const payload = JSON.parse(captured.output[0] ?? '{}');
      expect(payload.ok).toBe(true);
      expect(payload.command).toBe('workflows');
      expect(payload.data[0].name).toBe('onboarding');
    });

    test('shows empty-state when workflows are undefined', async () => {
      const fred = await createMockFred({ workflows: undefined });

      const exitCode = await handleListCommand('workflows', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      expect(captured.output[0]).toBe('No workflows registered.');
    });

    test('shows empty-state when workflow list is empty', async () => {
      const fred = await createMockFred({ workflows: [] });

      const exitCode = await handleListCommand('workflows', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(0);
      expect(captured.output[0]).toBe('No workflows registered.');
    });
  });

  /* --- error handling --- */

  describe('error handling', () => {
    test('unknown entity type returns exit code 1', async () => {
      const fred = await createMockFred();

      const exitCode = await handleListCommand('foobar', [], {}, { fred, io: captured.io });

      expect(exitCode).toBe(1);
      expect(captured.errors[0]).toContain('Unknown entity type: foobar');
      expect(captured.errors[0]).toContain('agents, tools, intents, providers, workflows');
    });

    test('all valid commands return exit code 0', async () => {
      const fred = await createMockFred({
        agents: [{ id: 'a1', config: { model: 'm', platform: 'p' } }],
        tools: [{ id: 't1', name: 'T', description: 'd' }],
        intents: [{ id: 'i1', action: { type: 'agent', target: 'a1' }, utterances: ['hi'] }],
        providers: ['openai'],
        workflows: ['wf1'],
      });

      for (const entityType of ['agents', 'tools', 'intents', 'providers', 'workflows']) {
        captured.output.length = 0;
        captured.errors.length = 0;
        const exitCode = await handleListCommand(entityType, [], {}, { fred, io: captured.io });
        expect(exitCode).toBe(0);
      }
    });
  });
});
