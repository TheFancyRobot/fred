/**
 * Effect-native workflow service tests.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import { Effect } from 'effect';
import { createFred, type FredClient } from '../../../../packages/core/src/index';
import {
  ProviderRegistryService,
  WorkflowService,
} from '../../../../packages/core/src/services';
import { createMockProvider } from '../../helpers/mock-provider';

const withClient = async <A>(
  agentIds: readonly string[],
  use: (client: FredClient) => Promise<A>,
): Promise<A> => {
  const client = await createFred();
  try {
    await client.effects.run(
      Effect.flatMap(ProviderRegistryService, (providers) =>
        providers.registerDefinition({ ...createMockProvider('mock'), aliases: [] })
      ),
    );
    for (const id of agentIds) {
      await client.agents.register({
        id,
        platform: 'mock',
        model: 'mock-model',
        systemMessage: 'test',
      } as any);
    }
    return await use(client);
  } finally {
    await client.shutdown();
  }
};

describe('WorkflowService', () => {
  it('starts with no workflows', async () => {
    await withClient([], async (client) => {
      expect(await client.effects.run(
        Effect.flatMap(WorkflowService, (workflows) => workflows.listWorkflows()),
      )).toEqual([]);
    });
  });

  it('stores and retrieves a workflow', async () => {
    await withClient(['agent-1', 'agent-2'], async (client) => {
      await client.effects.run(
        Effect.flatMap(WorkflowService, (workflows) => workflows.addWorkflow('test-workflow', {
          defaultAgent: 'agent-1',
          agents: ['agent-1', 'agent-2'],
        })),
      );

      const workflow = await client.effects.run(
        Effect.flatMap(WorkflowService, (workflows) => workflows.getWorkflow('test-workflow')),
      );
      expect(workflow).toEqual({
        name: 'test-workflow',
        defaultAgent: 'agent-1',
        agents: ['agent-1', 'agent-2'],
      });
    });
  });

  it('preserves optional routing configuration', async () => {
    await withClient(['agent-1'], async (client) => {
      await client.effects.run(
        Effect.flatMap(WorkflowService, (workflows) => workflows.addWorkflow('routed', {
          defaultAgent: 'agent-1',
          agents: ['agent-1'],
          routing: { defaultAgent: 'agent-1', rules: [] },
        })),
      );

      const workflow = await client.effects.run(
        Effect.flatMap(WorkflowService, (workflows) => workflows.getWorkflow('routed')),
      );
      expect(workflow?.routing?.defaultAgent).toBe('agent-1');
    });
  });

  it('lists and detects registered workflows', async () => {
    await withClient(['agent-1', 'agent-2'], async (client) => {
      await client.effects.run(Effect.gen(function* () {
        const workflows = yield* WorkflowService;
        yield* workflows.addWorkflow('workflow-1', {
          defaultAgent: 'agent-1',
          agents: ['agent-1'],
        });
        yield* workflows.addWorkflow('workflow-2', {
          defaultAgent: 'agent-2',
          agents: ['agent-2'],
        });
      }));

      const result = await client.effects.run(Effect.gen(function* () {
        const workflows = yield* WorkflowService;
        return {
          names: yield* workflows.listWorkflows(),
          first: yield* workflows.hasWorkflow('workflow-1'),
          missing: yield* workflows.hasWorkflow('missing'),
        };
      }));
      expect(result.names.sort()).toEqual(['workflow-1', 'workflow-2']);
      expect(result.first).toBe(true);
      expect(result.missing).toBe(false);
    });
  });

  it('warns for missing default and listed agents without rejecting registration', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withClient(['agent-1'], async (client) => {
        await client.effects.run(
          Effect.flatMap(WorkflowService, (workflows) => workflows.addWorkflow('workflow-1', {
            defaultAgent: 'missing-default',
            agents: ['agent-1', 'missing-1', 'missing-2'],
          })),
        );
        expect(await client.effects.run(
          Effect.flatMap(WorkflowService, (workflows) => workflows.hasWorkflow('workflow-1')),
        )).toBe(true);
      });

      expect(warnSpy).toHaveBeenCalledTimes(3);
      expect(warnSpy.mock.calls.map(([message]) => message).join('\n')).toContain('missing-default');
      expect(warnSpy.mock.calls.map(([message]) => message).join('\n')).toContain('missing-1');
      expect(warnSpy.mock.calls.map(([message]) => message).join('\n')).toContain('missing-2');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('does not warn when every referenced agent exists', async () => {
    const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await withClient(['agent-1', 'agent-2'], async (client) => {
        await client.effects.run(
          Effect.flatMap(WorkflowService, (workflows) => workflows.addWorkflow('workflow-1', {
            defaultAgent: 'agent-1',
            agents: ['agent-1', 'agent-2'],
          })),
        );
      });
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });
});
