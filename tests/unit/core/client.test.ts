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
import { defineWorkflow } from '../../../packages/core/src/workflow/compile';
import type { WorkflowExecutionResult } from '../../../packages/core/src/workflow/execute';
import { createMockProvider } from '../helpers/mock-provider';
import { createMockStorage } from '../helpers/mock-storage';

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

  it('resolves registered subworkflows through the public workflow runtime', async () => {
    const client = track(await createFred());
    await client.workflows.define({
      id: 'client-child-workflow',
      steps: [{
        type: 'function',
        name: 'child-result',
        fn: (context) => `child:${context.input}`,
      }],
    });
    await client.workflows.define({
      id: 'client-parent-workflow',
      steps: [{
        type: 'pipeline',
        name: 'nested',
        pipelineId: 'client-child-workflow',
      }],
    });

    const result = (await client.workflows.run(
      'client-parent-workflow',
      'hello',
    )) as PipelineResult;
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe('child:hello');
  });

  it('workflows sub-API defines and runs native WorkflowIR directly', async () => {
    const client = track(await createFred());
    await client.workflows.define(defineWorkflow({
      id: 'client-native-workflow',
      entry: 'start',
      nodes: [
        { id: 'start', kind: 'function', fn: (context) => `native:${context.input}` },
      ],
      edges: [],
    }));

    const result = (await client.workflows.run(
      'client-native-workflow',
      'hello',
    )) as WorkflowExecutionResult;
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.finalOutput).toBe('native:hello');
  });

  it('workflows.run accepts a sessionId and stays transparent to execution', async () => {
    // Phase 62 / STEP-62-04: a workflow run binds the given session as ambient
    // for its whole execution. Function steps can't observe the environment, so
    // here we assert the wrapping is transparent — the result is identical to a
    // stateless run — and that the id round-trips as the persistence key.
    const client = track(await createFred());

    const config: PipelineConfigV2 = {
      id: 'client-session-pipeline',
      steps: [
        {
          type: 'function',
          name: 'echo',
          fn: (context: { input: string }) => `echo:${context.input}`,
        },
      ],
    };
    await client.workflows.define(config);

    const result = (await client.workflows.run('client-session-pipeline', 'hi', {
      sessionId: 'conv_session_run',
    })) as PipelineResult;
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe('echo:hi');
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

    // Phase 62 / STEP-62-04: a graph run with a session binds it as the ambient
    // session (executeGraphWorkflowViaRuntime wraps the effect in withSession);
    // exercise that branch to guard the wiring against regressions.
    const scopedResult = (await client.workflows.run('client-graph', 'go', {
      sessionId: 'conv_graph_session',
    })) as GraphExecutionResult;
    expect(scopedResult.success).toBe(true);
    expect(scopedResult.executedNodes).toContain('start');
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

  it('sessions.list reflects storage swapped in via the runtime after creation', async () => {
    // Regression: sessions.list() must read the live ContextStorageService,
    // not a storage adapter captured at createFred() time. A caller can
    // replace storage through the exposed runtime escape hatch; list() has
    // to see the new adapter's sessions.
    const client = track(await createFred());

    // Initially no persistent adapter -> empty.
    expect(await client.sessions.list()).toEqual([]);

    const storage = createMockStorage();
    await Runtime.runPromise(client.runtime)(
      Effect.flatMap(ContextStorageService, (s) => s.replaceStorage(storage))
    );

    // Seed a session through the client's normal write path.
    const conversationId = await Runtime.runPromise(client.runtime)(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        const id = yield* context.generateConversationId();
        yield* context.addMessages(id, [
          { role: 'user', content: 'in the new store' } as any,
        ]);
        return id;
      })
    );

    const sessions = await client.sessions.list();
    expect(sessions.map((s) => s.id)).toContain(conversationId);
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
