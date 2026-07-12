import { afterEach, describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import { createFred, type FredClient } from '../../../packages/core/src/index';
import {
  HookManagerService,
  PipelineService,
  ProviderRegistryService,
} from '../../../packages/core/src/services';
import type { GraphWorkflowConfig } from '../../../packages/core/src/pipeline/graph';
import type { PipelineConfigV2 } from '../../../packages/core/src/pipeline/pipeline';

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

describe('Phase 46 API prerequisites', () => {
  it('registers hooks in the client runtime', async () => {
    const fred = track(await createFred());
    let hookCalled = false;

    await fred.hooks.register('beforeMessageReceived', () => {
      hookCalled = true;
      return {};
    });

    await fred.effects.run(
      Effect.flatMap(HookManagerService, (hooks) =>
        hooks.executeHooks('beforeMessageReceived', {
          type: 'beforeMessageReceived',
          data: 'hello',
        } as any)
      ),
    );

    expect(hookCalled).toBe(true);
  });

  it('defines V2 pipeline configs in the V2 registry', async () => {
    const fred = track(await createFred());
    const config: PipelineConfigV2 = {
      id: 'v2-pipeline',
      steps: [{ type: 'function', name: 'noop', fn: () => 'ok' }],
    };

    await fred.workflows.define(config);

    expect(await fred.effects.run(
      Effect.flatMap(PipelineService, (pipelines) => pipelines.hasPipelineV2(config.id)),
    )).toBe(true);
  });

  it('defines graph workflows in the graph registry', async () => {
    const fred = track(await createFred());
    const config: GraphWorkflowConfig = {
      id: 'graph-snapshot',
      type: 'graph',
      entryNode: 'start',
      nodes: [{ id: 'start', type: 'function', fn: () => 'ok' }],
      edges: [],
    };

    await fred.workflows.define(config);

    expect(await fred.effects.run(
      Effect.flatMap(PipelineService, (pipelines) => pipelines.hasGraphWorkflow(config.id)),
    )).toBe(true);
  });

  it('rejects an unknown graph workflow id', async () => {
    const fred = track(await createFred());
    await expect(fred.workflows.run('missing-graph', 'hello')).rejects.toThrow();
  });
});
