/**
 * Phase 63 / STEP-63-02: WorkflowIR structural accessors + type guards.
 *
 * The IR itself is types-only; these tests pin the pure graph accessors that
 * compile.ts / execute.ts / the validator all share, so traversal semantics are
 * defined and verified in one place.
 */
import { describe, expect, it } from 'bun:test';
import {
  findNode,
  inEdges,
  isAgentNode,
  isFunctionNode,
  isSubworkflowNode,
  outEdges,
  type IRNode,
  type WorkflowIR,
} from '../../../../packages/core/src/workflow/ir';

const ir: WorkflowIR = {
  id: 'wf',
  entry: 'router',
  source: 'native',
  nodes: [
    { id: 'router', kind: 'function', fn: () => ({ route: 'left' }), expose: ['route'] },
    { id: 'left', kind: 'agent', agentId: 'a' },
    { id: 'right', kind: 'agent', agentId: 'b' },
    {
      id: 'sink',
      kind: 'subworkflow',
      workflowId: 'nested',
      join: { type: 'all', merge: 'array', sources: ['left', 'right'] },
    },
  ],
  edges: [
    { from: 'router', to: 'left', when: { type: 'branch', condition: { field: 'router.route', operator: 'equals', value: 'left' } } },
    { from: 'router', to: 'right', default: true },
    { from: 'left', to: 'sink' },
    { from: 'right', to: 'sink' },
  ],
};

describe('WorkflowIR accessors', () => {
  it('findNode resolves by id and returns undefined for unknown ids', () => {
    expect(findNode(ir, 'router')?.kind).toBe('function');
    expect(findNode(ir, 'nope')).toBeUndefined();
  });

  it('outEdges returns a node’s out-edges in declaration order', () => {
    expect(outEdges(ir, 'router').map((e) => e.to)).toEqual(['left', 'right']);
    expect(outEdges(ir, 'sink')).toEqual([]);
  });

  it('inEdges returns a node’s in-edges in declaration order', () => {
    expect(inEdges(ir, 'sink').map((e) => e.from)).toEqual(['left', 'right']);
    expect(inEdges(ir, 'router')).toEqual([]);
  });
});

describe('WorkflowIR node type guards', () => {
  it('discriminate the three executable node kinds', () => {
    const byId = (id: string) => findNode(ir, id) as IRNode;
    expect(isFunctionNode(byId('router'))).toBe(true);
    expect(isAgentNode(byId('left'))).toBe(true);
    expect(isSubworkflowNode(byId('sink'))).toBe(true);

    expect(isAgentNode(byId('router'))).toBe(false);
    expect(isFunctionNode(byId('left'))).toBe(false);
  });
});
