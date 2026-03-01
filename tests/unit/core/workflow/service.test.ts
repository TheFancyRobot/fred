import { describe, expect, it, spyOn } from 'bun:test';
import { Effect, Layer } from 'effect';
import { WorkflowService, WorkflowServiceLive } from '../../../../packages/core/src/workflow/service';
import { AgentService } from '../../../../packages/core/src/agent/service';

describe('WorkflowService', () => {
  const createMockAgentService = (knownAgents: string[]): typeof AgentService.Service => ({
    createAgent: () => Effect.fail({ _tag: 'AgentCreationError' as const } as any),
    getAgent: (id: string) =>
      knownAgents.includes(id)
        ? Effect.succeed({ id } as any)
        : Effect.fail({ _tag: 'AgentNotFoundError' as const, id } as any),
    getAgentOptional: (id: string) => Effect.succeed(knownAgents.includes(id) ? ({ id } as any) : undefined),
    hasAgent: (id: string) => Effect.succeed(knownAgents.includes(id)),
    removeAgent: () => Effect.succeed(true),
    getAllAgents: () => Effect.succeed(knownAgents.map((id) => ({ id } as any))),
    clear: () => Effect.void,
    setTracer: () => Effect.void,
    setDefaultSystemMessage: () => Effect.void,
    setGlobalVariablesResolver: () => Effect.void,
    matchAgentByUtterance: () => Effect.succeed(null),
    getMCPMetrics: () => Effect.succeed({}),
    registerShutdownHooks: () => Effect.void,
  });

  const runWithWorkflowService = <A, E>(
    effect: Effect.Effect<A, E, WorkflowService>,
    knownAgents: string[] = []
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(WorkflowServiceLive),
        Effect.provide(Layer.succeed(AgentService, createMockAgentService(knownAgents)))
      )
    );

  it('stores and retrieves workflows', async () => {
    const result = await runWithWorkflowService(
      Effect.gen(function* () {
        const workflows = yield* WorkflowService;
        yield* workflows.addWorkflow('primary', {
          defaultAgent: 'writer',
          agents: ['writer', 'reviewer'],
        });
        return yield* workflows.getWorkflow('primary');
      }),
      ['writer', 'reviewer']
    );

    expect(result).toEqual({
      name: 'primary',
      defaultAgent: 'writer',
      agents: ['writer', 'reviewer'],
    });
  });

  it('lists workflow names in registration order', async () => {
    const result = await runWithWorkflowService(
      Effect.gen(function* () {
        const workflows = yield* WorkflowService;
        yield* workflows.addWorkflow('alpha', {
          defaultAgent: 'alpha-agent',
          agents: ['alpha-agent'],
        });
        yield* workflows.addWorkflow('beta', {
          defaultAgent: 'beta-agent',
          agents: ['beta-agent'],
        });
        return yield* workflows.listWorkflows();
      }),
      ['alpha-agent', 'beta-agent']
    );

    expect(result).toEqual(['alpha', 'beta']);
  });

  it('reports workflow existence', async () => {
    const result = await runWithWorkflowService(
      Effect.gen(function* () {
        const workflows = yield* WorkflowService;
        yield* workflows.addWorkflow('exists', {
          defaultAgent: 'agent-1',
          agents: ['agent-1'],
        });

        const present = yield* workflows.hasWorkflow('exists');
        const absent = yield* workflows.hasWorkflow('missing');
        return { present, absent };
      }),
      ['agent-1']
    );

    expect(result).toEqual({ present: true, absent: false });
  });

  it('warns when configured agents are missing', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

    await runWithWorkflowService(
      Effect.gen(function* () {
        const workflows = yield* WorkflowService;
        yield* workflows.addWorkflow('with-missing-agents', {
          defaultAgent: 'missing-default',
          agents: ['present-agent', 'missing-agent'],
        });
      }),
      ['present-agent']
    );

    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]?.[0]).toContain('Default agent "missing-default"');
    expect(warnSpy.mock.calls[1]?.[0]).toContain('Agent "missing-agent"');

    warnSpy.mockRestore();
  });
});
