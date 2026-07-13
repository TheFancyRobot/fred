import { describe, expect, it, mock } from 'bun:test';
import { Effect } from 'effect';
import type { AgentInstance, AgentResponse } from '../../../../packages/core/src/agent/agent';
import type { AgentManagerLike } from '../../../../packages/core/src/pipeline/executor';
import {
  compileGraphWorkflow,
  compilePipelineV2,
} from '../../../../packages/core/src/workflow/compile';
import { executeWorkflowEffect } from '../../../../packages/core/src/workflow/execute';

function echoAgent(id: string): AgentInstance {
  return {
    id,
    config: { id, systemMessage: '', platform: 'mock', model: 'mock' } as AgentInstance['config'],
    processMessage: (message: string): Effect.Effect<AgentResponse, Error> =>
      Effect.succeed({ content: `${id}<-${message}`, toolCalls: [] }),
  };
}

function agentManager(entries: Record<string, AgentInstance>): AgentManagerLike {
  return {
    getAgent: (id) => entries[id],
    hasAgent: (id) => id in entries,
  } as AgentManagerLike;
}

describe('unified WorkflowIR executor', () => {
  it('executes native IR agent nodes with canonical input and outputs', async () => {
    const workflow = {
      id: 'chain',
      source: 'native' as const,
      entry: 'a',
      nodes: [
        { id: 'a', name: 'a', kind: 'agent' as const, agentId: 'a' },
        { id: 'b', name: 'b', kind: 'agent' as const, agentId: 'b' },
      ],
      edges: [{ from: 'a', to: 'b' }],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'hi', {
      agentManager: agentManager({ a: echoAgent('a'), b: echoAgent('b') }),
    }));

    expect(result.success).toBe(true);
    expect(result.finalOutput).toEqual({ content: 'b<-a<-hi', toolCalls: [] });
    expect(result.context.outputs).toEqual({
      a: { content: 'a<-hi', toolCalls: [] },
      b: { content: 'b<-a<-hi', toolCalls: [] },
    });
    expect(result.context.history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'a<-hi' },
      { role: 'user', content: 'a<-hi' },
      { role: 'assistant', content: 'b<-a<-hi' },
    ]);
  });

  it('preserves V2 accumulation and hides compiler-generated conditional outputs', async () => {
    const workflow = compilePipelineV2({
      id: 'conditional',
      steps: [
        { name: 'first', type: 'function', fn: (context) => `first:${context.input}` },
        {
          name: 'branch',
          type: 'conditional',
          condition: () => true,
          whenTrue: [{ name: 'yes', type: 'function', fn: () => 'accepted' }],
          whenFalse: [{ name: 'no', type: 'function', fn: () => 'declined' }],
        },
      ],
    });
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'hi', {
      agentManager: agentManager({}),
    }));

    expect(result.context.outputs).toEqual({
      first: 'first:hi',
      branch: {
        conditionResult: true,
        result: 'accepted',
        branchInfo: {
          conditionResult: true,
          takenPath: 'whenTrue',
          notTakenPath: 'whenFalse',
        },
      },
    });
    expect(Object.keys(result.context.outputs).some((key) => key.startsWith('__fred:'))).toBe(false);
    expect(result.finalOutput).toEqual(result.context.outputs.branch);
  });

  it('preserves the last public output when an internal node executes afterward', async () => {
    const workflow = {
      id: 'internal-tail',
      source: 'native' as const,
      entry: 'answer',
      nodes: [
        { id: 'answer', kind: 'agent' as const, agentId: 'answerer' },
        { id: 'tail', kind: 'function' as const, internal: true, fn: () => 'internal' },
      ],
      edges: [{ from: 'answer', to: 'tail' }],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'question', {
      agentManager: agentManager({ answerer: echoAgent('answerer') }),
    }));

    expect(result.executedNodes).toEqual(['answer', 'tail']);
    expect(result.finalOutput).toEqual({ content: 'answerer<-question', toolCalls: [] });
  });

  it('passes native predecessor output into a nested workflow', async () => {
    const workflow = {
      id: 'native-nested-sequence',
      source: 'native' as const,
      entry: 'prepare',
      nodes: [
        { id: 'prepare', kind: 'agent' as const, agentId: 'preparer' },
        { id: 'nested', kind: 'subworkflow' as const, workflowId: 'child' },
      ],
      edges: [{ from: 'prepare', to: 'nested' }],
    };
    let nestedInput: unknown;
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({ preparer: echoAgent('preparer') }),
      workflowResolver: (_workflowId, input) => {
        nestedInput = input;
        return Effect.succeed(`child<-${String(input)}`);
      },
    }));

    expect(nestedInput).toBe('preparer<-original');
    expect(result.finalOutput).toBe('child<-preparer<-original');
  });

  it('passes V2 predecessor output into a nested workflow', async () => {
    const workflow = compilePipelineV2({
      id: 'v2-nested-sequence',
      steps: [
        { name: 'prepare', type: 'agent', agentId: 'preparer' },
        { name: 'nested', type: 'pipeline', pipelineId: 'child' },
      ],
    });
    let nestedInput: unknown;
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({ preparer: echoAgent('preparer') }),
      workflowResolver: (_workflowId, input) => {
        nestedInput = input;
        return Effect.succeed(`child<-${String(input)}`);
      },
    }));

    expect(nestedInput).toBe('preparer<-original');
    expect(result.finalOutput).toBe('child<-preparer<-original');
  });

  it('preserves structured predecessor input for a typed subworkflow', async () => {
    const structured = { name: 'Ada' };
    const workflow = compilePipelineV2({
      id: 'typed-nested-input',
      steps: [
        { name: 'prepare', type: 'function', fn: () => structured },
        { name: 'nested', type: 'pipeline', pipelineId: 'child' },
      ],
    });
    let nestedInput: unknown;
    await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({}),
      workflowResolver: (_workflowId, input) => {
        nestedInput = input;
        return Effect.succeed('done');
      },
    }));

    expect(nestedInput).toBe(structured);
  });

  it('preserves structured input through the pipeline-manager fallback', async () => {
    const structured = { left: 'draft', right: 'critique' };
    const workflow = compilePipelineV2({
      id: 'fallback-nested-input',
      steps: [
        { name: 'prepare', type: 'function', fn: () => structured },
        { name: 'nested', type: 'pipeline', pipelineId: 'child' },
      ],
    });
    let nestedInput: unknown;
    await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({}),
      pipelineManager: {
        getPipeline: () => ({
          execute: async (input) => {
            nestedInput = input;
            return { content: 'done', toolCalls: [] };
          },
        }),
      },
    }));

    expect(nestedInput).toBe(structured);
  });

  it('passes nested agent content into the next native agent', async () => {
    const workflow = {
      id: 'nested-agent-sequence',
      source: 'native' as const,
      entry: 'draft',
      nodes: [
        { id: 'draft', kind: 'subworkflow' as const, workflowId: 'drafter' },
        { id: 'review', kind: 'agent' as const, agentId: 'reviewer' },
      ],
      edges: [{ from: 'draft', to: 'review' }],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({ reviewer: echoAgent('reviewer') }),
      workflowResolver: () => Effect.succeed({ content: 'draft', toolCalls: [] }),
    }));

    expect(result.finalOutput).toEqual({ content: 'reviewer<-draft', toolCalls: [] });
  });

  it('preserves structured subworkflow output for native function consumers', async () => {
    const structured = { content: 'draft', audit: { approved: true } };
    let functionInput: unknown;
    const workflow = {
      id: 'nested-function-sequence',
      source: 'native' as const,
      entry: 'draft',
      nodes: [
        { id: 'draft', kind: 'subworkflow' as const, workflowId: 'drafter' },
        {
          id: 'inspect',
          kind: 'function' as const,
          fn: (context: { input: unknown }) => {
            functionInput = context.input;
            return 'done';
          },
        },
      ],
      edges: [{ from: 'draft', to: 'inspect' }],
    };
    await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({}),
      workflowResolver: () => Effect.succeed(structured),
    }));

    expect(functionInput).toBe(structured);
  });

  it('records the exact scheduling-time input in native agent history', async () => {
    let receivedMessage = '';
    const target = echoAgent('target');
    target.processMessage = (message) => {
      receivedMessage = message;
      return Effect.succeed({ content: `target<-${message}`, toolCalls: [] });
    };
    const workflow = {
      id: 'stable-history-input',
      source: 'native' as const,
      entry: 'source',
      nodes: [
        { id: 'source', kind: 'function' as const, fn: () => 'source output' },
        { id: 'sibling', kind: 'function' as const, fn: () => 'sibling output' },
        { id: 'target', kind: 'agent' as const, agentId: 'target' },
      ],
      edges: [
        { from: 'source', to: 'sibling' },
        { from: 'source', to: 'target' },
        { from: 'sibling', to: 'target' },
      ],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({ target }),
    }));

    expect(receivedMessage).toBe('source output');
    expect(result.context.history[0]).toEqual({ role: 'user', content: receivedMessage });
  });

  it('does not leak isolated native agent turns into shared history', async () => {
    let observerHistory: readonly unknown[] | undefined;
    const observer = echoAgent('observer');
    observer.processMessage = (message, history) => {
      observerHistory = [...history];
      return Effect.succeed({ content: `observer<-${message}`, toolCalls: [] });
    };
    const workflow = {
      id: 'isolated-agent-history',
      source: 'native' as const,
      entry: 'isolated',
      nodes: [
        {
          id: 'isolated',
          kind: 'agent' as const,
          agentId: 'isolated',
          contextView: 'isolated' as const,
        },
        { id: 'observer', kind: 'agent' as const, agentId: 'observer' },
      ],
      edges: [{ from: 'isolated', to: 'observer' }],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({ isolated: echoAgent('isolated'), observer }),
    }));

    expect(observerHistory).toEqual([]);
    expect(result.context.history).toEqual([
      { role: 'user', content: 'isolated<-original' },
      { role: 'assistant', content: 'observer<-isolated<-original' },
    ]);
  });

  it('ignores inherited object keys when resolving predecessor outputs', async () => {
    const workflow = {
      id: 'prototype-safe-input',
      source: 'native' as const,
      entry: 'target',
      nodes: [{ id: 'target', kind: 'agent' as const, agentId: 'target' }],
      edges: [{ from: 'toString', to: 'target' }],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({ target: echoAgent('target') }),
    }));

    expect(result.finalOutput).toEqual({ content: 'target<-original', toolCalls: [] });
  });

  it('stores prototype-looking node ids as safe own output properties', async () => {
    const workflow = {
      id: 'prototype-safe-output',
      source: 'native' as const,
      entry: '__proto__',
      nodes: [{ id: '__proto__', kind: 'function' as const, fn: () => ({ safe: true }) }],
      edges: [],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({}),
    }));

    expect(Object.getPrototypeOf(result.outputs)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(result.outputs, '__proto__')).toBe(true);
    expect(result.outputs['__proto__']).toEqual({ safe: true });
  });

  it('passes every completed predecessor output to a native synthesis agent', async () => {
    const workflow = {
      id: 'native-fan-in',
      source: 'native' as const,
      entry: 'start',
      nodes: [
        { id: 'start', kind: 'function' as const, fn: () => 'start' },
        { id: 'left', kind: 'function' as const, fn: () => 'left result' },
        { id: 'right', kind: 'function' as const, fn: () => ({ result: 'right result' }) },
        {
          id: 'synthesize',
          kind: 'agent' as const,
          agentId: 'synthesizer',
          join: { type: 'all' as const, merge: 'array' as const, sources: ['left', 'right'] },
        },
      ],
      edges: [
        { from: 'start', to: 'left' },
        { from: 'start', to: 'right' },
        { from: 'left', to: 'synthesize' },
        { from: 'right', to: 'synthesize' },
      ],
    };
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'original', {
      agentManager: agentManager({ synthesizer: echoAgent('synthesizer') }),
    }));

    expect(result.finalOutput).toEqual({
      content: 'synthesizer<-{"left":"left result","right":{"result":"right result"}}',
      toolCalls: [],
    });
  });

  it('selects graph branches and joins fan-out results', async () => {
    const workflow = compileGraphWorkflow({
      id: 'parallel',
      type: 'graph',
      entryNode: 'router',
      nodes: [
        { id: 'router', type: 'function', fn: () => ({ route: 'parallel' }) },
        { id: 'fork', type: 'fork', branches: ['left', 'right'] },
        { id: 'unused', type: 'function', fn: () => 'unused' },
        { id: 'left', type: 'function', fn: () => ({ left: true }) },
        { id: 'right', type: 'function', fn: () => ({ right: true }) },
        { id: 'join', type: 'join', sources: ['left', 'right'], mergeStrategy: 'shallow-merge' },
      ],
      edges: [
        { from: 'router', to: 'fork', condition: { field: 'router.route', operator: 'equals', value: 'parallel' } },
        { from: 'router', to: 'unused', default: true },
        { from: 'left', to: 'join' },
        { from: 'right', to: 'join' },
      ],
    });
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'hi', {
      agentManager: agentManager({}),
    }));

    expect(result.success).toBe(true);
    expect(result.executedNodes).toEqual(['router', 'fork', 'left', 'right', 'join']);
    expect(result.executedNodes).not.toContain('unused');
    expect(result.outputs).toEqual({
      router: { route: 'parallel' },
      left: { left: true },
      right: { right: true },
      join: { left: true, right: true },
    });
  });

  it('preserves retry, pause checkpoint, and restored-context resume behavior', async () => {
    let attempts = 0;
    const saveCheckpoint = mock(async () => {});
    const checkpointManager = {
      generateRunId: () => 'run-1',
      saveCheckpoint,
    };
    const retryWorkflow = compilePipelineV2({
      id: 'retry',
      steps: [{
        name: 'flaky',
        type: 'function',
        retry: { maxRetries: 2, backoffMs: 1 },
        fn: () => {
          attempts++;
          if (attempts < 3) throw new Error('retry');
          return 'ok';
        },
      }],
    });
    const retryResult = await Effect.runPromise(executeWorkflowEffect(retryWorkflow, 'hi', {
      agentManager: agentManager({}),
      checkpointManager: checkpointManager as never,
    }));
    expect(retryResult.finalOutput).toBe('ok');
    expect(attempts).toBe(3);

    const pauseWorkflow = compilePipelineV2({
      id: 'pause',
      steps: [{ name: 'approval', type: 'function', fn: () => ({ pause: true, prompt: 'Approve?' }) }],
    });
    const pauseResult = await Effect.runPromise(executeWorkflowEffect(pauseWorkflow, 'hi', {
      agentManager: agentManager({}),
      checkpointManager: checkpointManager as never,
    }));
    expect(pauseResult.status).toBe('paused');
    expect(pauseResult.pauseRequest?.prompt).toBe('Approve?');
    expect(saveCheckpoint).toHaveBeenCalled();

    let resumedInput = '';
    const resumeWorkflow = compilePipelineV2({
      id: 'resume',
      steps: [
        { name: 'first', type: 'function', fn: () => 'should-not-run' },
        { name: 'second', type: 'function', fn: (context) => {
          resumedInput = String(context.outputs.first);
          return 'resumed';
        } },
      ],
    });
    const resumeResult = await Effect.runPromise(executeWorkflowEffect(resumeWorkflow, 'ignored', {
      agentManager: agentManager({}),
      startStep: 1,
      restoredContext: {
        pipelineId: 'resume',
        input: 'restored',
        outputs: { first: 'saved' },
        history: [],
        metadata: {},
      },
    }));
    expect(resumeResult.finalOutput).toBe('resumed');
    expect(resumedInput).toBe('saved');
  });

  it('executes allowed handoff chains inside the same runtime', async () => {
    const source = echoAgent('source');
    source.processMessage = () => Effect.succeed({
      type: 'handoff_request',
      targetAgent: 'target',
      reason: 'specialist',
    } as never);
    const workflow = compileGraphWorkflow({
      id: 'handoff',
      type: 'graph',
      entryNode: 'source-node',
      nodes: [{ id: 'source-node', type: 'agent', agentId: 'source' }],
      edges: [],
      handoffs: { source: ['target'] },
    });
    const result = await Effect.runPromise(executeWorkflowEffect(workflow, 'help', {
      agentManager: agentManager({ source, target: echoAgent('target') }),
    }));

    expect(result.outputs['source-node']).toEqual({ content: 'target<-help', toolCalls: [] });
    expect(result.context.metadata).toMatchObject({
      handoffFrom: 'source',
      handoffTo: 'target',
      handoffReason: 'specialist',
      handoffChain: ['source'],
    });
  });
});
