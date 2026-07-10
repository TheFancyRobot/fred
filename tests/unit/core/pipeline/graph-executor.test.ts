import { describe, expect, it } from 'bun:test';
import { Effect } from 'effect';
import {
  executeGraphWorkflowEffect,
  type GraphExecutorOptions,
} from '../../../../packages/core/src/pipeline/graph-executor';

const options: GraphExecutorOptions = {
  agentManager: {
    getAgent: () => undefined,
    hasAgent: () => false,
  },
};

describe('graph executor compatibility adapter', () => {
  it('preserves partial outputs and executed nodes when a later node fails', async () => {
    const result = await Effect.runPromise(executeGraphWorkflowEffect({
      id: 'partial-graph',
      type: 'graph',
      entryNode: 'completed',
      nodes: [
        { id: 'completed', type: 'function', fn: () => 'partial result' },
        {
          id: 'fails',
          type: 'function',
          fn: () => {
            throw new Error('expected graph failure');
          },
        },
      ],
      edges: [{ from: 'completed', to: 'fails' }],
    }, 'input', options));

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('expected graph failure');
    expect(result.outputs).toEqual({ completed: 'partial result' });
    expect(result.context.outputs).toEqual({ completed: 'partial result' });
    expect(result.executedNodes).toEqual(['completed']);
  });
});
