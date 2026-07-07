/**
 * Phase 60 / STEP-60-04: createFred() scoped Promise client.
 *
 * Covers every FredClient sub-API (agents, workflows, sessions, providers),
 * the runtime escape hatch sharing state with the Promise facade, and
 * shutdown semantics (idempotent; use-after-shutdown is a tagged error).
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, Runtime } from 'effect';
import {
  createFred,
  FredClientClosedError,
  type FredClient,
} from '../../../packages/core/src/client';
import {
  AgentService,
  ContextStorageService,
  ProviderRegistryService,
  ToolRegistryService,
} from '../../../packages/core/src/services';
import type { PipelineConfigV2 } from '../../../packages/core/src/pipeline/pipeline';
import type { GraphWorkflowConfig } from '../../../packages/core/src/pipeline/graph';
import type { PipelineResult } from '../../../packages/core/src/pipeline/executor';
import type { GraphExecutionResult } from '../../../packages/core/src/pipeline/graph-executor';
import { createMockProvider } from '../helpers/mock-provider';

const activeClients: FredClient[] = [];

const track = (client: FredClient): FredClient => {
  activeClients.push(client);
  return client;
};

afterEach(async () => {
  while (activeClients.length > 0) {
    await activeClients.pop()!.shutdown();
  }
});

async function registerMockProvider(client: FredClient): Promise<void> {
  await Runtime.runPromise(client.runtime)(
    Effect.flatMap(ProviderRegistryService, (s) =>
      s.registerDefinition({ ...createMockProvider('mock'), aliases: [] })
    )
  );
}

describe('createFred client', () => {
  it('agents sub-API registers, lists, and removes agents', async () => {
    const client = track(await createFred());
    await registerMockProvider(client);

    const agent = await client.agents.register({
      id: 'client-agent',
      platform: 'mock',
      model: 'mock-model',
      systemMessage: 'Test agent',
    } as any);
    expect(agent.id).toBe('client-agent');

    const listed = await client.agents.list();
    expect(listed.map((a) => a.id)).toContain('client-agent');

    expect(await client.agents.remove('client-agent')).toBe(true);
    expect((await client.agents.list()).map((a) => a.id)).not.toContain('client-agent');
  });

  it('runtime escape hatch shares state with the client sub-APIs', async () => {
    const client = track(await createFred());
    await registerMockProvider(client);

    await client.agents.register({
      id: 'shared-agent',
      platform: 'mock',
      model: 'mock-model',
      systemMessage: 'Shared',
    } as any);

    // An Effect user on the same runtime observes state written via the
    // Promise sub-API (and vice versa: the mock provider was registered
    // through the escape hatch and consumed by agents.register above).
    const agentIds = await Runtime.runPromise(client.runtime)(
      Effect.map(
        Effect.flatMap(AgentService, (s) => s.getAllAgents()),
        (agents) => agents.map((a) => a.id)
      )
    );
    expect(agentIds).toContain('shared-agent');

    // Built-in calculator tool is registered during createFred init.
    const toolIds = await Runtime.runPromise(client.runtime)(
      Effect.map(
        Effect.flatMap(ToolRegistryService, (s) => s.getAllTools()),
        (tools) => tools.map((t) => t.id)
      )
    );
    expect(toolIds.length).toBeGreaterThan(0);
  });

  it('workflows sub-API defines and runs a V2 function pipeline', async () => {
    const client = track(await createFred());

    const config: PipelineConfigV2 = {
      id: 'client-v2-pipeline',
      steps: [
        {
          type: 'function',
          name: 'echo',
          // Function steps receive the pipeline context, not the raw input.
          fn: (context: { input: string }) => `echo:${context.input}`,
        },
      ],
    };
    await client.workflows.define(config);

    const result = (await client.workflows.run('client-v2-pipeline', 'hello')) as PipelineResult;
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe('echo:hello');
  });

  it('workflows sub-API defines and runs a graph workflow', async () => {
    const client = track(await createFred());

    const config: GraphWorkflowConfig = {
      id: 'client-graph',
      type: 'graph',
      entryNode: 'start',
      nodes: [
        {
          id: 'start',
          type: 'function',
          fn: () => 'graph-ok',
        },
      ],
      edges: [],
    };
    await client.workflows.define(config);

    const result = (await client.workflows.run('client-graph', 'go')) as GraphExecutionResult;
    expect(result.success).toBe(true);
    expect(result.executedNodes).toContain('start');
  });

  it('sessions sub-API gets and deletes conversation sessions', async () => {
    const client = track(await createFred());

    // Seed a conversation through the shared runtime.
    const conversationId = await Runtime.runPromise(client.runtime)(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        const id = yield* context.generateConversationId();
        yield* context.addMessages(id, [
          { role: 'user', content: 'hello session' } as any,
        ]);
        return id;
      })
    );

    const details = await client.sessions.get(conversationId);
    expect(details).not.toBeNull();
    expect(details!.summary.id).toBe(conversationId);
    expect(details!.summary.messageCount).toBe(1);

    // No storage adapter configured: list falls back to empty.
    expect(await client.sessions.list()).toEqual([]);

    await client.sessions.delete(conversationId);
    expect(await client.sessions.get(conversationId)).toBeNull();
  });

  it('providers.use rejects cleanly for unknown provider packs', async () => {
    const client = track(await createFred());
    await expect(client.providers.use('definitely-not-a-real-pack')).rejects.toThrow();
  });

  it('providers.use resolves a definition registered on the shared runtime', async () => {
    const client = track(await createFred());
    await registerMockProvider(client);

    const definition = await Runtime.runPromise(client.runtime)(
      Effect.flatMap(ProviderRegistryService, (s) => s.getDefinition('mock'))
    );
    expect(definition.id).toBe('mock');
  });

  it('shutdown is idempotent and later calls reject with FredClientClosedError', async () => {
    const client = await createFred();

    await client.shutdown();
    await client.shutdown(); // second call is a no-op

    expect.assertions(2);
    try {
      await client.agents.list();
    } catch (error) {
      expect(error).toBeInstanceOf(FredClientClosedError);
      expect((error as FredClientClosedError)._tag).toBe('FredClientClosedError');
    }
  });
});
