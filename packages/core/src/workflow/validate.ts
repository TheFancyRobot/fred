import { findDirectedGraphIssue } from '../pipeline/graph-validator';
import type { WorkflowIR } from './ir';

/** Validation failure for the unified workflow representation. */
export class WorkflowValidationError extends Error {
  constructor(message: string, readonly workflowId: string) {
    super(message);
    this.name = 'WorkflowValidationError';
  }
}

/** Validate node identity, references, entry, DAG shape, and branch fallbacks. */
export function validateWorkflowIR(ir: WorkflowIR): void {
  const structuralIssue = findDirectedGraphIssue(
    {
      id: ir.id,
      nodeIds: ir.nodes.map((node) => node.id),
      edges: ir.edges,
      entry: ir.entry,
    },
    { label: 'Workflow', requireReachable: true },
  );
  if (structuralIssue) throw new WorkflowValidationError(structuralIssue, ir.id);

  const nodeIds = new Set(ir.nodes.map((node) => node.id));
  for (const node of ir.nodes) {
    if (node.join?.type === 'all') {
      for (const source of node.join.sources) {
        if (!nodeIds.has(source)) {
          throw new WorkflowValidationError(
            `Workflow ${ir.id} join node '${node.id}' references non-existent source: ${source}`,
            ir.id,
          );
        }
      }
    }
  }

  const outgoing = new Map<string, IREdgeLike[]>();
  for (const edge of ir.edges) {
    const current = outgoing.get(edge.from) ?? [];
    current.push(edge);
    outgoing.set(edge.from, current);
  }
  for (const [nodeId, edges] of outgoing) {
    const guarded = edges.filter((edge) => edge.when);
    if (guarded.length > 1 && guarded.length === edges.length && !edges.some((edge) => edge.default)) {
      const allPredicate = guarded.every((edge) => edge.when?.type === 'predicate');
      if (!allPredicate) {
        throw new WorkflowValidationError(
          `Workflow ${ir.id} node '${nodeId}' has multiple branches but no default edge`,
          ir.id,
        );
      }
    }
  }
}

type IREdgeLike = WorkflowIR['edges'][number];
