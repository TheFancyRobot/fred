/**
 * Graph Workflow Validation
 *
 * Validates graph workflow configurations to ensure they form valid DAGs
 * with proper structure and required default branches at decision points.
 */

import Graph from 'graphology';
import { hasCycle } from 'graphology-dag';
import type { GraphWorkflowConfig, AnyGraphNode, GraphEdge } from './graph';

export interface DirectedGraphShape {
  readonly id: string;
  readonly nodeIds: readonly string[];
  readonly edges: readonly { readonly from: string; readonly to: string }[];
  readonly entry: string;
}

/**
 * Shared structural DAG validation used by both graph configs and WorkflowIR.
 * Returns the first issue so each caller can preserve its public error type.
 */
export function findDirectedGraphIssue(
  shape: DirectedGraphShape,
  options: { readonly label: string; readonly requireReachable?: boolean },
): string | undefined {
  const nodeIds = new Set<string>();
  const duplicates: string[] = [];
  for (const nodeId of shape.nodeIds) {
    if (nodeIds.has(nodeId)) duplicates.push(nodeId);
    nodeIds.add(nodeId);
  }
  if (duplicates.length > 0) {
    return `${options.label} ${shape.id} has duplicate node IDs: ${duplicates.join(', ')}`;
  }
  if (shape.nodeIds.length === 0) {
    return `${options.label} ${shape.id} must contain at least one node`;
  }
  if (!nodeIds.has(shape.entry)) {
    return `${options.label} ${shape.id} entry node '${shape.entry}' does not exist in nodes array`;
  }
  for (const edge of shape.edges) {
    if (!nodeIds.has(edge.from)) {
      return `${options.label} ${shape.id} edge references non-existent source node: ${edge.from}`;
    }
    if (!nodeIds.has(edge.to)) {
      return `${options.label} ${shape.id} edge references non-existent target node: ${edge.to}`;
    }
  }

  const graph = new Graph({ type: 'directed' });
  for (const nodeId of shape.nodeIds) graph.addNode(nodeId);
  for (const edge of shape.edges) {
    if (!graph.hasEdge(edge.from, edge.to)) graph.addDirectedEdge(edge.from, edge.to);
  }
  if (hasCycle(graph)) return `${options.label} ${shape.id} contains a cycle (DAG required)`;

  if (options.requireReachable) {
    const visited = new Set<string>();
    const queue = [shape.entry];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined || visited.has(current)) continue;
      visited.add(current);
      for (const edge of shape.edges) {
        if (edge.from === current && !visited.has(edge.to)) queue.push(edge.to);
      }
    }
    const unreachable = shape.nodeIds.filter((nodeId) => !visited.has(nodeId));
    if (unreachable.length > 0) {
      return `${options.label} ${shape.id} has unreachable nodes: ${unreachable.join(', ')}`;
    }
  }

  return undefined;
}

/**
 * Validation error for graph workflows
 */
export class GraphValidationError extends Error {
  constructor(message: string, public workflowId: string) {
    super(message);
    this.name = 'GraphValidationError';
  }
}

/**
 * Validate a graph workflow configuration.
 *
 * Checks:
 * - Entry node exists
 * - All node IDs are unique
 * - All edge references point to valid nodes
 * - Graph is a DAG (no cycles)
 * - Fork/join nodes reference valid targets
 * - Each decision point has a default branch
 * - Handoff targets reference valid agent nodes
 *
 * @param config - Graph workflow configuration to validate
 * @throws GraphValidationError if validation fails
 */
export function validateGraphWorkflow(config: GraphWorkflowConfig): void {
  const { id, nodes, edges, entryNode, handoffs } = config;
  const structuralIssue = findDirectedGraphIssue(
    { id, nodeIds: nodes.map((node) => node.id), edges, entry: entryNode },
    { label: 'Graph workflow' },
  );
  if (structuralIssue) throw new GraphValidationError(structuralIssue, id);

  const nodeIds = new Set(nodes.map((node) => node.id));

  // Validate fork and join nodes
  for (const node of nodes) {
    if (node.type === 'fork') {
      for (const branchId of node.branches) {
        if (!nodeIds.has(branchId)) {
          throw new GraphValidationError(
            `Graph workflow ${id} fork node '${node.id}' references non-existent branch: ${branchId}`,
            id
          );
        }
      }
    } else if (node.type === 'join') {
      for (const sourceId of node.sources) {
        if (!nodeIds.has(sourceId)) {
          throw new GraphValidationError(
            `Graph workflow ${id} join node '${node.id}' references non-existent source: ${sourceId}`,
            id
          );
        }
      }
    }
  }

  // Validate default branches at decision points
  // Build adjacency map: nodeId -> outgoing edges
  const outgoingEdges = new Map<string, GraphEdge[]>();
  for (const edge of edges) {
    const existing = outgoingEdges.get(edge.from) || [];
    existing.push(edge);
    outgoingEdges.set(edge.from, existing);
  }

  // Check each node with multiple outgoing edges
  for (const [nodeId, nodeEdges] of outgoingEdges.entries()) {
    if (nodeEdges.length > 1) {
      // At least one edge must be default or have no condition
      const hasDefault = nodeEdges.some(edge => edge.default === true);
      const hasUnconditional = nodeEdges.some(edge => !edge.condition);

      if (!hasDefault && !hasUnconditional) {
        throw new GraphValidationError(
          `Graph workflow ${id} node '${nodeId}' has multiple branches but no default edge`,
          id
        );
      }
    }
  }

  // Validate handoff targets if defined
  if (handoffs) {
    // Get all agent node IDs
    const agentNodeIds = new Set(
      nodes.filter(node => node.type === 'agent').map(node => node.id)
    );

    for (const [source, targets] of Object.entries(handoffs)) {
      // Source may be external, so we just warn if not in nodes
      // But targets must exist as agent nodes in this workflow
      for (const target of targets) {
        if (!agentNodeIds.has(target)) {
          // For now, just warn - target may be in a different workflow
          // In production, you might want to make this configurable
          console.warn(
            `Graph workflow ${id} handoff from '${source}' to '${target}' - target not found as agent node in workflow`
          );
        }
      }
    }
  }
}
