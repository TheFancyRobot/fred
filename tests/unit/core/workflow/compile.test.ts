import { describe, expect, it } from 'bun:test';
import {
  compileGraphWorkflow,
  compilePipelineV1,
  compilePipelineV2,
  compileWorkflow,
} from '../../../../packages/core/src/workflow/compile';
import { validateWorkflowIR, WorkflowValidationError } from '../../../../packages/core/src/workflow/validate';
import { findNode, outEdges, type WorkflowIR } from '../../../../packages/core/src/workflow/ir';

describe('workflow compilers', () => {
  it('lowers a V1 agent list to a linear graph', () => {
    const ir = compilePipelineV1({ id: 'chain', agents: ['a', 'b'] });

    expect(ir.source).toBe('v1');
    expect(ir.entry).toBe('chain:agent:0');
    expect(ir.nodes.map((node) => node.kind)).toEqual(['agent', 'agent']);
    expect(ir.edges).toEqual([{ from: 'chain:agent:0', to: 'chain:agent:1' }]);
  });

  it('lowers V2 conditional nesting to guarded edges without a conditional node kind', () => {
    const ir = compilePipelineV2({
      id: 'branching',
      steps: [
        {
          name: 'branch',
          type: 'conditional',
          condition: (context) => context.input === 'yes',
          whenTrue: [{ name: 'yes', type: 'function', fn: () => 'accepted' }],
          whenFalse: [{ name: 'no', type: 'function', fn: () => 'declined' }],
        },
        { name: 'finish', type: 'function', fn: (context) => context.outputs.branch },
      ],
    });

    expect(ir.source).toBe('v2');
    expect(ir.nodes.every((node) => ['agent', 'function', 'subworkflow'].includes(node.kind))).toBe(true);
    expect(ir.nodes.filter((node) => node.internal).length).toBe(3);
    expect(findNode(ir, 'branch')?.role).toBe('condition-result');
    expect(ir.edges.some((edge) => edge.when?.type === 'predicate')).toBe(true);
    expect(outEdges(ir, 'branch')).toEqual([{ from: 'branch', to: 'finish' }]);
  });

  it('expresses graph fork and join through fan-out edges and join policy', () => {
    const ir = compileGraphWorkflow({
      id: 'parallel',
      type: 'graph',
      entryNode: 'fork',
      nodes: [
        { id: 'fork', type: 'fork', branches: ['left', 'right'] },
        { id: 'left', type: 'function', fn: () => ({ left: true }) },
        { id: 'right', type: 'function', fn: () => ({ right: true }) },
        { id: 'join', type: 'join', sources: ['left', 'right'], mergeStrategy: 'shallow-merge' },
      ],
      edges: [
        { from: 'left', to: 'join' },
        { from: 'right', to: 'join' },
      ],
    });

    expect(findNode(ir, 'fork')?.kind).toBe('function');
    expect(findNode(ir, 'fork')?.role).toBe('fork');
    expect(outEdges(ir, 'fork').map((edge) => edge.to).sort()).toEqual(['left', 'right']);
    expect(findNode(ir, 'join')?.join).toEqual({
      type: 'all',
      merge: 'shallow-merge',
      sources: ['left', 'right'],
    });
  });

  it('returns validated native IR unchanged', () => {
    const native: WorkflowIR = {
      id: 'native',
      entry: 'start',
      nodes: [{ id: 'start', kind: 'function', fn: () => 'ok' }],
      edges: [],
      source: 'native',
    };
    expect(compileWorkflow(native)).toBe(native);
  });
});

describe('WorkflowIR validation', () => {
  it('rejects cycles using the shared graph validator structure', () => {
    const cyclic: WorkflowIR = {
      id: 'cyclic',
      entry: 'a',
      nodes: [
        { id: 'a', kind: 'function', fn: () => 'a' },
        { id: 'b', kind: 'function', fn: () => 'b' },
      ],
      edges: [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
      ],
    };
    expect(() => validateWorkflowIR(cyclic)).toThrow(WorkflowValidationError);
    expect(() => validateWorkflowIR(cyclic)).toThrow(/contains a cycle/);
  });

  it('rejects unreachable nodes', () => {
    const unreachable: WorkflowIR = {
      id: 'unreachable',
      entry: 'a',
      nodes: [
        { id: 'a', kind: 'function', fn: () => 'a' },
        { id: 'orphan', kind: 'function', fn: () => 'orphan' },
      ],
      edges: [],
    };
    expect(() => validateWorkflowIR(unreachable)).toThrow(/unreachable nodes: orphan/);
  });
});
