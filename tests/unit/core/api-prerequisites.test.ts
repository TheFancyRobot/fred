import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, Runtime } from 'effect';
import { Fred } from '../../../packages/core/src/index';
import { HookManagerService, PipelineService } from '../../../packages/core/src/services';
import type { GraphWorkflowConfig } from '../../../packages/core/src/pipeline/graph';
import type { PipelineConfig, PipelineConfigV2 } from '../../../packages/core/src/pipeline/pipeline';
import { createMockProvider } from '../helpers/mock-provider';

const activeFredInstances: Fred[] = [];

const trackFred = (fred: Fred): Fred => {
  activeFredInstances.push(fred);
  return fred;
};

async function registerMockAgent(fred: Fred, agentId: string): Promise<void> {
  if (!fred.hasProvider('mock')) {
    const provider = createMockProvider('mock');
    fred.registerProvider('mock', { ...provider, aliases: [] });
  }

  await fred.createAgent({
    id: agentId,
    platform: 'mock',
    model: 'mock-model',
    systemMessage: 'Mock agent',
  } as any);
}

afterEach(async () => {
  while (activeFredInstances.length > 0) {
    const fred = activeFredInstances.pop();
    if (fred) {
      await fred.shutdown();
    }
  }
});

describe('Phase 46 API prerequisites', () => {
  it('queues pre-runtime hooks and replays them after runtime initialization', async () => {
    const fred = trackFred(new Fred());
    let hookCalled = false;

    fred.registerHook('beforeMessageReceived', () => {
      hookCalled = true;
      return {};
    });

    const runtime = await fred.getRuntime();
    await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const hooks = yield* HookManagerService;
        yield* hooks.executeHooks('beforeMessageReceived', {
          type: 'beforeMessageReceived',
          data: 'hello',
        } as any);
      })
    );

    expect(hookCalled).toBe(true);
  });

  it('routes V1 createPipeline configs through the legacy pipeline registry', async () => {
    const fred = trackFred(await Fred.create());
    await registerMockAgent(fred, 'legacy-agent');

    const config: PipelineConfig = {
      id: 'legacy-pipeline',
      agents: ['legacy-agent'],
    };

    await fred.createPipeline(config);

    const runtime = await fred.getRuntime();
    const hasPipeline = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const pipelines = yield* PipelineService;
        return yield* pipelines.hasPipeline(config.id);
      })
    );

    expect(hasPipeline).toBe(true);
  });

  it('routes V2 createPipeline configs through createPipelineV2', async () => {
    const fred = trackFred(await Fred.create());

    const config: PipelineConfigV2 = {
      id: 'v2-pipeline',
      steps: [
        {
          type: 'function',
          name: 'noop',
          fn: () => 'ok',
        },
      ],
    };

    await fred.createPipeline(config as any);

    const runtime = await fred.getRuntime();
    const hasPipelineV2 = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const pipelines = yield* PipelineService;
        return yield* pipelines.hasPipelineV2(config.id);
      })
    );

    expect(hasPipelineV2).toBe(true);
  });

  it('registers graph workflows before runtime and replays them on startup', async () => {
    const fred = trackFred(new Fred());
    const config: GraphWorkflowConfig = {
      id: 'graph-snapshot',
      type: 'graph',
      entryNode: 'start',
      nodes: [
        {
          id: 'start',
          type: 'function',
          fn: () => 'ok',
        },
      ],
      edges: [],
    };

    expect(typeof (fred as any).registerGraphWorkflow).toBe('function');
    (fred as any).registerGraphWorkflow(config);

    const runtime = await fred.getRuntime();
    const hasGraph = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const pipelines = yield* PipelineService;
        return yield* pipelines.hasGraphWorkflow(config.id);
      })
    );

    expect(hasGraph).toBe(true);
  });

  it('throws a clear error when executing an unknown graph workflow id', async () => {
    const fred = trackFred(await Fred.create());
    expect(typeof (fred as any).executeGraphWorkflow).toBe('function');

    await expect((fred as any).executeGraphWorkflow('missing-graph', 'hello')).rejects.toThrow(
      'Graph workflow not found: missing-graph'
    );
  });
});
