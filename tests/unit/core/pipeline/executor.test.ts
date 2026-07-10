import { describe, it, expect, mock } from 'bun:test';
import { Effect } from 'effect';
import {
  ExecutorService,
  ExecutorServiceLive,
  type AgentManagerLike,
  type ExtendedExecutionOptions,
} from '../../../../packages/core/src/pipeline/executor';
import type { PipelineConfigV2 } from '../../../../packages/core/src/pipeline/pipeline';
import type { PipelineContext } from '../../../../packages/core/src/pipeline/context';
import type { CheckpointManager } from '../../../../packages/core/src/pipeline/checkpoint/manager';

function createMockAgent(id = 'test-agent') {
  return {
    id,
    processMessage: mock((input: string) =>
      Effect.succeed({
        content: `Processed: ${input}`,
        toolCalls: [],
      })
    ),
  };
}

function createMockAgentManager(): AgentManagerLike {
  const agent = createMockAgent();
  return {
    getAgent: mock((id: string) => (id === 'test-agent' ? agent : undefined)) as any,
    hasAgent: mock((id: string) => id === 'test-agent'),
  };
}

function createMockCheckpointManager(): CheckpointManager & {
  saveCheckpoint: ReturnType<typeof mock>;
  generateRunId: ReturnType<typeof mock>;
} {
  return {
    generateRunId: mock(() => 'generated-run-id'),
    saveCheckpoint: mock(async () => {}),
    getLatestCheckpoint: mock(async () => null),
    updateStatus: mock(async () => {}),
    markCompleted: mock(async () => {}),
    markFailed: mock(async () => {}),
    getCheckpoint: mock(async () => null),
    deleteRun: mock(async () => {}),
    deleteExpired: mock(async () => 0),
    close: mock(async () => {}),
  } as any;
}

function createSimplePipelineConfig(stepCount = 2): PipelineConfigV2 {
  return {
    id: 'test-pipeline',
    steps: Array.from({ length: stepCount }, (_, i) => ({
      type: 'function' as const,
      name: `step-${i}`,
      fn: async () => `result-${i}`,
    })),
  };
}

function createTestContext(overrides: Partial<PipelineContext> = {}): PipelineContext {
  return {
    pipelineId: 'test-pipeline',
    input: 'test input',
    outputs: { 'step-0': 'result-0', 'step-1': 'result-1' },
    history: [],
    metadata: { key: 'value' },
    ...overrides,
  };
}

async function runExecutor(
  config: PipelineConfigV2,
  input: string,
  options: ExtendedExecutionOptions
) {
  return Effect.runPromise(
    ExecutorService.pipe(
      Effect.flatMap((svc) => svc.executePipelineV2(config, input, options)),
      Effect.provide(ExecutorServiceLive)
    )
  );
}

describe('ExecutorService - run id and checkpoint behavior', () => {
  it('returns a failed result when failFast is disabled', async () => {
    const result = await runExecutor({
      id: 'non-fail-fast',
      failFast: false,
      steps: [{
        name: 'fails',
        type: 'function',
        fn: () => {
          throw new Error('expected failure');
        },
      }],
    }, 'test input', {
      agentManager: createMockAgentManager(),
      runId: 'run-failed',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('failed');
    expect(result.error?.message).toBe('expected failure');
    expect(result.runId).toBe('run-failed');
  });

  it('generates runId and returns it in result', async () => {
    const result = await runExecutor(createSimplePipelineConfig(1), 'test input', {
      agentManager: createMockAgentManager(),
    });

    expect(result.success).toBe(true);
    expect(result.runId).toBeDefined();
  });

  it('uses checkpointManager.generateRunId when available', async () => {
    const checkpointManager = createMockCheckpointManager();

    const result = await runExecutor(createSimplePipelineConfig(1), 'test input', {
      agentManager: createMockAgentManager(),
      checkpointManager,
    });

    expect(result.runId).toBe('generated-run-id');
    expect(checkpointManager.generateRunId).toHaveBeenCalled();
  });

  it('writes checkpoint after each step when enabled', async () => {
    const checkpointManager = createMockCheckpointManager();

    const result = await runExecutor(createSimplePipelineConfig(3), 'test input', {
      agentManager: createMockAgentManager(),
      checkpointManager,
    });

    expect(result.success).toBe(true);
    expect(checkpointManager.saveCheckpoint).toHaveBeenCalledTimes(3);
  });

  it('does not write checkpoint when checkpoint config disables it', async () => {
    const checkpointManager = createMockCheckpointManager();
    const config: PipelineConfigV2 = {
      ...createSimplePipelineConfig(2),
      checkpoint: { enabled: false },
    };

    await runExecutor(config, 'test input', {
      agentManager: createMockAgentManager(),
      checkpointManager,
    });

    expect(checkpointManager.saveCheckpoint).not.toHaveBeenCalled();
  });
});

describe('ExecutorService - step execution flows', () => {
  it('executes agent steps through yield* composition', async () => {
    const agent = createMockAgent();
    const agentManager: AgentManagerLike = {
      getAgent: mock((id: string) => (id === 'test-agent' ? agent : undefined)) as any,
      hasAgent: mock(() => true),
    };

    const config: PipelineConfigV2 = {
      id: 'agent-pipeline',
      steps: [{ type: 'agent', name: 'agent-step', agentId: 'test-agent' }],
    };

    const result = await runExecutor(config, 'hello', { agentManager });
    expect(result.success).toBe(true);
    expect(result.finalOutput).toMatchObject({ content: 'Processed: hello' });
    expect(agent.processMessage).toHaveBeenCalled();
  });

  it('retries failed function step and succeeds', async () => {
    let attempts = 0;
    const config: PipelineConfigV2 = {
      id: 'retry-pipeline',
      steps: [{
        type: 'function',
        name: 'retry-step',
        retry: { maxRetries: 2, backoffMs: 1 },
        fn: async () => {
          attempts += 1;
          if (attempts < 3) throw new Error('transient');
          return 'ok';
        },
      }],
    };

    const result = await runExecutor(config, 'input', { agentManager: createMockAgentManager() });
    expect(result.success).toBe(true);
    expect(result.finalOutput).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('handles conditional and pipeline-ref steps', async () => {
    const config: PipelineConfigV2 = {
      id: 'composite-pipeline',
      steps: [
        {
          type: 'conditional',
          name: 'branch',
          condition: async () => true,
          whenTrue: [{ type: 'function', name: 'branch-step', fn: async () => 'branch-result' }],
        },
        {
          type: 'pipeline',
          name: 'nested',
          pipelineId: 'nested-pipeline',
        },
      ],
    };

    const result = await runExecutor(config, 'input', {
      agentManager: createMockAgentManager(),
      pipelineManager: {
        getPipeline: () => ({ execute: async () => ({ content: 'nested-result', toolCalls: [] } as any) }),
      },
    });

    expect(result.success).toBe(true);
    expect((result.context.outputs.branch as any).conditionResult).toBe(true);
    expect(result.finalOutput).toMatchObject({ content: 'nested-result' });
  });
});

describe('ExecutorService - hooks, pause, abort, and resume', () => {
  it('merges metadata returned by hooks', async () => {
    const config = createSimplePipelineConfig(1);
    const hookManager = {
      executeHooks: mock(async () => {}),
      executeHooksAndMerge: mock(async (hookName: string) => {
        if (hookName === 'beforePipeline') {
          return { metadata: { fromHook: true } };
        }
        return {};
      }),
    };

    const result = await runExecutor(config, 'input', {
      agentManager: createMockAgentManager(),
      hookManager,
    });

    expect(result.success).toBe(true);
    expect(result.context.metadata.fromHook).toBe(true);
  });

  it('aborts when beforeStep hook returns abort', async () => {
    const config = createSimplePipelineConfig(1);
    const hookManager = {
      executeHooks: mock(async () => {}),
      executeHooksAndMerge: mock(async (hookName: string) => {
        if (hookName === 'beforeStep') return { abort: true };
        return {};
      }),
    };

    const result = await runExecutor(config, 'input', {
      agentManager: createMockAgentManager(),
      hookManager,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('aborted');
    expect(result.abortedBy).toBe('beforeStep hook');
  });

  it('pauses when a step returns a pause request and persists paused checkpoint', async () => {
    const checkpointManager = createMockCheckpointManager();
    const config: PipelineConfigV2 = {
      id: 'pause-pipeline',
      steps: [{
        type: 'function',
        name: 'pause-step',
        fn: async () => ({ pause: true, prompt: 'Need approval', ttlMs: 5000 }),
      }],
    };

    const result = await runExecutor(config, 'input', {
      agentManager: createMockAgentManager(),
      checkpointManager,
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('paused');
    expect(result.pauseRequest?.prompt).toBe('Need approval');
    expect(checkpointManager.saveCheckpoint).toHaveBeenCalledTimes(1);
    expect(checkpointManager.saveCheckpoint.mock.calls[0][0]).toMatchObject({ status: 'paused' });
  });

  it('resumes from startStep with restored context', async () => {
    let capturedContext: PipelineContext | undefined;
    const config: PipelineConfigV2 = {
      id: 'resume-pipeline',
      steps: [
        { type: 'function', name: 'step-0', fn: async () => 'skip-me' },
        {
          type: 'function',
          name: 'step-1',
          fn: async (ctx: PipelineContext) => {
            capturedContext = ctx;
            return 'resume-ok';
          },
        },
      ],
    };

    const restoredContext = createTestContext({
      input: 'restored input',
      outputs: { 'step-0': 'restored-result-0' },
      metadata: { restored: true },
    });

    const result = await runExecutor(config, 'ignored', {
      agentManager: createMockAgentManager(),
      startStep: 1,
      restoredContext,
    });

    expect(result.success).toBe(true);
    expect(capturedContext?.input).toBe('restored input');
    expect(capturedContext?.outputs['step-0']).toBe('restored-result-0');
    expect(capturedContext?.metadata.restored).toBe(true);
  });
});

describe('ExecutorService - error propagation and boundary guard', () => {
  it('fails with PipelineExecutionError carrying step and cause', async () => {
    const config: PipelineConfigV2 = {
      id: 'error-pipeline',
      steps: [{
        type: 'agent',
        name: 'failing-agent',
        agentId: 'test-agent',
      }],
    };

    const failingAgent = {
      id: 'test-agent',
      processMessage: mock(() => Effect.fail(new Error('agent test-agent failed'))),
    };

    const agentManager: AgentManagerLike = {
      getAgent: mock(() => failingAgent) as any,
      hasAgent: mock(() => true),
    };

    const exit = await Effect.runPromiseExit(
      ExecutorService.pipe(
        Effect.flatMap((svc) => svc.executePipelineV2(config, 'input', { agentManager })),
        Effect.provide(ExecutorServiceLive)
      )
    );

    expect(exit._tag).toBe('Failure');
    if (exit._tag === 'Failure') {
      expect(exit.cause._tag).toBe('Fail');
      if (exit.cause._tag === 'Fail') {
        expect(exit.cause.error).toMatchObject({
          _tag: 'PipelineExecutionError',
          pipelineId: 'error-pipeline',
          step: 0,
          cause: expect.objectContaining({ message: expect.stringContaining('test-agent') }),
        });
      }
    }
  });

  it('keeps runPromise/runFork out of executor internals', async () => {
    const source = await Bun.file('packages/core/src/pipeline/executor.ts').text();
    const runForkMatches = source.match(/Effect\.runFork/g) ?? [];
    const runPromiseMatches = source.match(/Effect\.runPromise/g) ?? [];
    const runCallbackMatches = source.match(/Effect\.runCallback/g) ?? [];

    expect(runForkMatches.length).toBe(0);
    expect(runPromiseMatches.length).toBe(0);
    expect(runCallbackMatches.length).toBeGreaterThanOrEqual(1);
    expect(source).toContain('@deprecated');
  });
});
