import { describe, expect, it } from 'bun:test';
import {
  compileGraphWorkflow,
  compilePipelineV2,
  compileWorkflow,
} from '../../../../packages/core/src/workflow/compile';
import { validateWorkflowIR, WorkflowValidationError } from '../../../../packages/core/src/workflow/validate';
import { findNode, outEdges, type WorkflowIR } from '../../../../packages/core/src/workflow/ir';

describe('workflow compilers', () => {
  it('rejects unchecked legacy definitions with migration guidance', () => {
    expect(() => compileWorkflow({ id: 'legacy', agents: ['a'] } as never)).toThrow(
      /steps array.*Legacy agent-list pipelines are no longer supported/,
    );
  });

  it('rejects workflow definitions whose required fields are inherited', () => {
    const inheritedDefinitions = [
      Object.create({ id: 'inherited-v2', steps: [] }),
      Object.create({
        id: 'inherited-graph',
        type: 'graph',
        entryNode: 'done',
        nodes: [],
        edges: [],
      }),
      Object.create({
        id: 'inherited-native',
        entry: 'done',
        nodes: [],
        edges: [],
      }),
    ];
    for (const inherited of inheritedDefinitions) {
      expect(() => compileWorkflow(inherited as never)).toThrow(
        /Unsupported workflow definition/,
      );
    }
  });

  it('rejects unsupported runtime WorkflowIR source tags', () => {
    expect(() => compileWorkflow({
      id: 'removed-source',
      source: 'v1',
      entry: 'done',
      nodes: [{ id: 'done', kind: 'function', fn: () => 'done' }],
      edges: [],
    } as never)).toThrow(/Unsupported WorkflowIR source "v1"/);
  });

  it('lowers V2 conditional nesting to guarded edges without a conditional node kind', () => {
    const ir = compilePipelineV2({
      id: 'branching',
      steps: [
        {
          name: 'branch',
          type: 'conditional',
          retry: { maxRetries: 2, backoffMs: 1 },
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
    const conditionNode = ir.nodes.find((node) => node.role === 'condition');
    const resultNode = findNode(ir, 'branch');
    expect(conditionNode?.hookPolicy).toBe('before');
    expect(resultNode?.role).toBe('condition-result');
    expect(resultNode?.hookPolicy).toBe('after');
    expect(ir.nodes.filter((node) => node.internal && !node.role).every(
      (node) => node.hookPolicy === 'none',
    )).toBe(true);
    expect(ir.retryScopes).toEqual([
      expect.objectContaining({
        entry: conditionNode?.id,
        exit: 'branch',
        retry: { maxRetries: 2, backoffMs: 1 },
      }),
    ]);
    expect(ir.retryScopes?.[0]?.nodeIds).toEqual(expect.arrayContaining([
      conditionNode?.id,
      'branch',
    ]));
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
