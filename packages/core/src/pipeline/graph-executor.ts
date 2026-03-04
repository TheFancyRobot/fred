/**
 * Graph Workflow Executor
 *
 * Executes DAG workflows with:
 * - Topological ordering
 * - Branch condition evaluation
 * - Fork/join parallelism
 * - Hook integration
 * - Result aggregation
 * - Agent handoff with unlimited chaining
 */

import { DirectedGraph } from 'graphology';
import { topologicalSort } from 'graphology-dag';
import type {
  GraphWorkflowConfig,
  GraphEdge,
  GraphNode,
  BranchCondition,
  AnyGraphNode,
  ForkNode,
  JoinNode,
} from './graph';
import type { PipelineContext } from './context';
import type { AgentManagerLike, ExecutorOptions, HookManagerLike } from './executor';
import type { Tracer } from '../tracing';
import { SpanKind } from '../tracing';
import type { HookEvent, StepHookEventData, PipelineHookEventData } from '../hooks/types';
import { isHandoffSignal, type HandoffSignal } from './handoff-tool';
import { prepareHandoffContext } from './handoff';
import type { AgentResponse } from '../agent/agent';
import { Context, Effect, Layer } from 'effect';
import { annotateSpan } from '../observability/otel';
import { getCurrentCorrelationContext, getCurrentSpanIds } from '../observability/context';

/**
 * Graph execution result
 */
export interface GraphExecutionResult {
  /** Whether execution completed successfully */
  success: boolean;
  /** Final accumulated context */
  context: PipelineContext;
  /** All node outputs by node ID */
  outputs: Record<string, unknown>;
  /** Node IDs in execution order */
  executedNodes: string[];
  /** Error if execution failed */
  error?: Error;
  /** Hook that requested abort */
  abortedBy?: string;
}

export type GraphExecutionError = Error;

export interface GraphExecutorService {
  executeGraphWorkflow(
    config: GraphWorkflowConfig,
    input: string,
    options: GraphExecutorOptions
  ): Effect.Effect<GraphExecutionResult, GraphExecutionError>;
}

export const GraphExecutorService = Context.GenericTag<GraphExecutorService>('GraphExecutorService');

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function runAsync<A>(thunk: () => PromiseLike<A> | A): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: () => Promise.resolve(thunk()),
    catch: toError,
  });
}

/**
 * Graph executor options (extends ExecutorOptions)
 */
export interface GraphExecutorOptions extends ExecutorOptions {
  agentManager: AgentManagerLike;
  hookManager?: HookManagerLike;
  tracer?: Tracer;
  pipelineManager?: {
    getPipeline: (id: string) => { execute: (msg: string) => Promise<any> } | undefined;
    executePipelineV2?: (config: any, input: string, options: any) => Promise<any>;
  };
}

/**
 * Evaluate a branch condition against the pipeline context.
 *
 * @param condition - The condition to evaluate
 * @param context - Pipeline context with accumulated outputs
 * @returns true if condition matches, false otherwise
 */
export function evaluateCondition(condition: BranchCondition, context: PipelineContext): boolean {
  // Extract field value using dot notation (e.g., "stepName.status")
  const parts = condition.field.split('.');
  let value: any = context.outputs;

  for (const part of parts) {
    if (value === null || value === undefined) {
      value = undefined;
      break;
    }
    value = value[part];
  }

  switch (condition.operator) {
    case 'exists':
      return value !== undefined && value !== null;

    case 'equals':
      return value === condition.value;

    case 'notEquals':
      return value !== condition.value;

    case 'gt':
      return typeof value === 'number' && typeof condition.value === 'number' && value > condition.value;

    case 'lt':
      return typeof value === 'number' && typeof condition.value === 'number' && value < condition.value;

    default:
      return false;
  }
}

/**
 * Select next nodes to execute based on current node's outgoing edges.
 * Implements first-match-wins for conditions.
 *
 * @param currentNode - ID of the current node
 * @param edges - All graph edges
 * @param context - Pipeline context for condition evaluation
 * @returns Array of next node IDs to execute
 */
export function selectNextNodes(
  currentNode: string,
  edges: GraphEdge[],
  context: PipelineContext
): string[] {
  // Find all outgoing edges from current node
  const outgoingEdges = edges.filter(edge => edge.from === currentNode);

  if (outgoingEdges.length === 0) {
    return []; // Terminal node
  }

  // First-match-wins: evaluate conditions in order
  for (const edge of outgoingEdges) {
    if (edge.condition && evaluateCondition(edge.condition, context)) {
      return [edge.to];
    }
  }

  // No condition matched, use default edge
  const defaultEdge = outgoingEdges.find(edge => edge.default);
  if (defaultEdge) {
    return [defaultEdge.to];
  }

  // No condition matched and no default, return all unconditional edges
  const unconditionalEdges = outgoingEdges.filter(edge => !edge.condition && !edge.default);
  return unconditionalEdges.map(edge => edge.to);
}

/**
 * Execute a graph workflow.
 *
 * @param config - Graph workflow configuration
 * @param input - User input message
 * @param options - Executor options
 * @returns Graph execution result
 */
export function executeGraphWorkflowEffect(
  config: GraphWorkflowConfig,
  input: string,
  options: GraphExecutorOptions
): Effect.Effect<GraphExecutionResult, GraphExecutionError> {
  const { agentManager, hookManager, tracer, pipelineManager } = options;

  // Build graphology graph for topological ordering
  const graph = new DirectedGraph();

  // Add all nodes
  for (const node of config.nodes) {
    graph.addNode(node.id, { data: node });
  }

  // Add all edges
  for (const edge of config.edges) {
    if (!graph.hasEdge(edge.from, edge.to)) {
      graph.addDirectedEdge(edge.from, edge.to, { data: edge });
    }
  }

  // Create pipeline context
  const context: PipelineContext = {
    pipelineId: config.id,
    input,
    outputs: {},
    history: [],
    metadata: {},
  };

  const executedNodes: string[] = [];
  const nodeOutputs: Record<string, unknown> = {};

  // Create tracing span
  const graphSpan = tracer?.startSpan(`graph.execute.${config.id}`, {
    kind: SpanKind.INTERNAL,
    attributes: {
      'graph.id': config.id,
      'graph.nodeCount': config.nodes.length,
      'graph.edgeCount': config.edges.length,
      'input.length': input.length,
    },
  });

  // Annotate graph span with Fred identifiers
  const graphAnnotation = annotateSpan({
    runId: context.metadata.runId as string | undefined,
    conversationId: context.conversationId,
    workflowId: config.id,
  });

  return Effect.gen(function* () {
    // Run annotation effect (fire and forget - best effort)
    yield* Effect.fork(graphAnnotation.pipe(Effect.ignore));

  const pipelineData: PipelineHookEventData = {
    pipelineId: config.id,
    input,
    context,
  };

    try {
    // Execute beforePipeline hooks with correlation context
    if (hookManager) {
      const correlationCtx = getCurrentCorrelationContext();
      const spanIds = getCurrentSpanIds();
      const beforeEvent: HookEvent = {
        type: 'beforePipeline',
        data: pipelineData,
        // Populate correlation fields
        runId: context.metadata.runId as string | undefined || correlationCtx?.runId,
        conversationId: context.conversationId || correlationCtx?.conversationId,
        intentId: correlationCtx?.intentId,
        timestamp: new Date().toISOString(),
        traceId: spanIds.traceId || correlationCtx?.traceId,
        spanId: spanIds.spanId || correlationCtx?.spanId,
        parentSpanId: spanIds.parentSpanId || correlationCtx?.parentSpanId,
        pipelineId: config.id,
      };
      const beforeResult = yield* runAsync(() => hookManager.executeHooksAndMerge('beforePipeline', beforeEvent));

      if (beforeResult.metadata) {
        context.metadata = { ...context.metadata, ...beforeResult.metadata };
      }

      if ((beforeResult as any).abort) {
        graphSpan?.setStatus('ok');
        graphSpan?.end();
        return {
          success: false,
          context,
          outputs: nodeOutputs,
          executedNodes,
          abortedBy: 'beforePipeline hook',
        };
      }
    }

    // Fire config-specific beforePipeline hooks
    if (config.hooks?.beforePipeline) {
      for (const handler of config.hooks.beforePipeline) {
        const result = yield* runAsync(() => handler({ type: 'beforePipeline', data: pipelineData }));
        if ((result as any)?.abort) {
          graphSpan?.setStatus('ok');
          graphSpan?.end();
          return {
            success: false,
            context,
            outputs: nodeOutputs,
            executedNodes,
            abortedBy: 'graph beforePipeline hook',
          };
        }
      }
    }

    // Track which nodes are reachable (active) from entry point
    const activeNodes = new Set<string>();
    const readyQueue: string[] = [config.entryNode];
    activeNodes.add(config.entryNode);

    // Track fork/join state
    const joinNodeSources = new Map<string, Set<string>>(); // joinId -> completed source IDs
    const pendingJoins = new Map<string, JoinNode>(); // joinId -> JoinNode config

    // Initialize join tracking
    for (const node of config.nodes) {
      if (node.type === 'join') {
        joinNodeSources.set(node.id, new Set());
        pendingJoins.set(node.id, node);
      }
    }

    // Execute nodes from ready queue
    while (readyQueue.length > 0) {
      const nodeId = readyQueue.shift()!;
      const node = config.nodes.find(n => n.id === nodeId);

      if (!node) {
        throw new Error(`Node "${nodeId}" not found in graph`);
      }

      // Handle fork nodes
      if (node.type === 'fork') {
        const forkNode = node as ForkNode;

        // Add fork event to span with correlation
        const runId = context.metadata.runId as string | undefined;
        graphSpan?.addEvent('graph.fork', {
          'fork.nodeId': nodeId,
          'fork.branches': forkNode.branches.join(','),
          'fork.branchCount': forkNode.branches.length,
          ...(runId ? { 'fred.runId': runId } : {}),
        });

        void runId;

        // Execute all branches in parallel
        const branchEffects = forkNode.branches.map((branchId) => Effect.gen(function* () {
          // Create isolated context for each branch
          const branchContext: PipelineContext = {
            ...context,
            outputs: { ...context.outputs },
            history: [...context.history],
            metadata: { ...context.metadata },
          };

          const branchNode = config.nodes.find(n => n.id === branchId);
          if (!branchNode) {
            throw new Error(`Branch node "${branchId}" not found`);
          }

          if (branchNode.type === 'fork' || branchNode.type === 'join') {
            throw new Error(`Fork branches cannot directly contain fork/join nodes`);
          }

          // Execute branch node
          const branchResult = yield* executeNode(
            branchNode as GraphNode,
            branchContext,
            options,
            config,
            hookManager
          );

          return { branchId, result: branchResult, context: branchContext };
        }));

        const branchResults = yield* Effect.all(branchEffects, { concurrency: 'unbounded' });

        // Record branch outputs
        for (const { branchId, result, context: branchCtx } of branchResults) {
          nodeOutputs[branchId] = result;
          context.outputs[branchId] = result;
          executedNodes.push(branchId);
          activeNodes.add(branchId);

          // Mark branch as complete for any downstream join nodes
          for (const [joinId, joinNode] of pendingJoins) {
            if (joinNode.sources.includes(branchId)) {
              joinNodeSources.get(joinId)!.add(branchId);
            }
          }
        }

        executedNodes.push(nodeId);

        // Check if any join nodes are ready
        for (const [joinId, joinNode] of pendingJoins) {
          const completedSources = joinNodeSources.get(joinId)!;
          const allSourcesComplete = joinNode.sources.every(src => completedSources.has(src));

          if (allSourcesComplete && !activeNodes.has(joinId)) {
            readyQueue.push(joinId);
            activeNodes.add(joinId);
          }
        }

        continue;
      }

      // Handle join nodes
      if (node.type === 'join') {
        const joinNode = node as JoinNode;

        // Add join event to span with correlation
        const runId = context.metadata.runId as string | undefined;
        graphSpan?.addEvent('graph.join', {
          'join.nodeId': nodeId,
          'join.sources': joinNode.sources.join(','),
          'join.sourceCount': joinNode.sources.length,
          'join.strategy': joinNode.mergeStrategy,
          ...(runId ? { 'fred.runId': runId } : {}),
        });

        void runId;

        // Merge outputs from source nodes
        const sourceOutputs = joinNode.sources.map(srcId => nodeOutputs[srcId]);

        let mergedOutput: unknown;
        if (joinNode.mergeStrategy === 'shallow-merge') {
          // Shallow merge: last write wins
          mergedOutput = sourceOutputs.reduce((acc, output) => {
            if (typeof output === 'object' && output !== null && !Array.isArray(output)) {
              return { ...(acc as Record<string, unknown>), ...(output as Record<string, unknown>) };
            }
            return output; // Non-object outputs just use last value
          }, {} as Record<string, unknown>);
        } else {
          // Array strategy: collect all outputs
          mergedOutput = sourceOutputs;
        }

        nodeOutputs[nodeId] = mergedOutput;
        context.outputs[nodeId] = mergedOutput;
        executedNodes.push(nodeId);

        // Select next nodes
        const nextNodes = selectNextNodes(nodeId, config.edges, context);
        for (const nextId of nextNodes) {
          if (!activeNodes.has(nextId)) {
            readyQueue.push(nextId);
            activeNodes.add(nextId);
          }
        }

        continue;
      }

      // Execute regular node (agent, function, conditional, pipeline)
      const runId = context.metadata.runId as string | undefined;
      const nodeSpan = tracer?.startSpan(`graph.node.${nodeId}`, {
        kind: SpanKind.INTERNAL,
        attributes: {
          'node.id': nodeId,
          'node.type': node.type,
          'graph.id': config.id,
          // Add correlation attributes
          ...(runId ? { 'fred.runId': runId } : {}),
          ...(context.conversationId ? { 'fred.conversationId': context.conversationId } : {}),
        },
      });

      // Annotate node span with Fred identifiers
      const nodeAnnotation = annotateSpan({
        runId: context.metadata.runId as string | undefined,
        conversationId: context.conversationId,
        workflowId: config.id,
        stepName: nodeId,
      });

      yield* Effect.fork(nodeAnnotation.pipe(Effect.ignore));

      try {
        const result = yield* executeNode(
          node as GraphNode,
          context,
          options,
          config,
          hookManager
        );

        nodeOutputs[nodeId] = result;
        context.outputs[nodeId] = result;
        executedNodes.push(nodeId);

        nodeSpan?.setStatus('ok');
        nodeSpan?.end();

        // Select next nodes based on edges and conditions
        const nextNodes = selectNextNodes(nodeId, config.edges, context);

        // Add branch decision event if conditional edges exist
        const outgoingEdges = config.edges.filter(e => e.from === nodeId);
        if (outgoingEdges.some(e => e.condition)) {
          graphSpan?.addEvent('graph.branch_decision', {
            'branch.sourceNode': nodeId,
            'branch.takenNodes': JSON.stringify(nextNodes),
          });

          // Record taken branches
          for (const next of nextNodes) {
            const edge = outgoingEdges.find(e => e.to === next);
            graphSpan?.addEvent('graph.branch_taken', {
              'branch.sourceNode': nodeId,
              'branch.targetNode': next,
              'branch.condition': edge?.condition ? JSON.stringify(edge.condition) : 'default',
              'branch.taken': true,
            });

            nodeSpan?.addEvent('graph.branch_taken', {
              'branch.targetNode': next,
              'branch.taken': true,
            });
          }

          // Record not-taken branches
          const notTakenEdges = outgoingEdges.filter(e => !nextNodes.includes(e.to));
          for (const edge of notTakenEdges) {
            graphSpan?.addEvent('graph.branch_not_taken', {
              'branch.sourceNode': nodeId,
              'branch.targetNode': edge.to,
              'branch.condition': edge.condition ? JSON.stringify(edge.condition) : 'default',
              'branch.taken': false,
            });

            nodeSpan?.addEvent('graph.branch_not_taken', {
              'branch.targetNode': edge.to,
              'branch.taken': false,
            });
          }

          void (context.metadata.runId as string | undefined);
        }

        for (const nextId of nextNodes) {
          if (!activeNodes.has(nextId)) {
            readyQueue.push(nextId);
            activeNodes.add(nextId);
          }
        }

        // Mark this node as complete for any downstream join nodes
        for (const [joinId, joinNode] of pendingJoins) {
          if (joinNode.sources.includes(nodeId)) {
            joinNodeSources.get(joinId)!.add(nodeId);

            // Check if join is now ready
            const completedSources = joinNodeSources.get(joinId)!;
            const allSourcesComplete = joinNode.sources.every(src => completedSources.has(src));

            if (allSourcesComplete && !activeNodes.has(joinId)) {
              readyQueue.push(joinId);
              activeNodes.add(joinId);
            }
          }
        }
      } catch (error) {
        nodeSpan?.setStatus('error', error instanceof Error ? error.message : String(error));
        nodeSpan?.end();
        throw error;
      }
    }

    // Execute afterPipeline hooks with correlation context
    if (hookManager) {
      const afterData = { ...pipelineData, context };
      const afterCorrelationCtx = getCurrentCorrelationContext();
      const afterSpanIds = getCurrentSpanIds();
      const afterEvent: HookEvent = {
        type: 'afterPipeline',
        data: afterData,
        // Populate correlation fields
        runId: context.metadata.runId as string | undefined || afterCorrelationCtx?.runId,
        conversationId: context.conversationId || afterCorrelationCtx?.conversationId,
        intentId: afterCorrelationCtx?.intentId,
        timestamp: new Date().toISOString(),
        traceId: afterSpanIds.traceId || afterCorrelationCtx?.traceId,
        spanId: afterSpanIds.spanId || afterCorrelationCtx?.spanId,
        parentSpanId: afterSpanIds.parentSpanId || afterCorrelationCtx?.parentSpanId,
        pipelineId: config.id,
      };
      yield* runAsync(() => hookManager.executeHooksAndMerge('afterPipeline', afterEvent));
    }

    // Fire config-specific afterPipeline hooks
    if (config.hooks?.afterPipeline) {
      for (const handler of config.hooks.afterPipeline) {
        yield* runAsync(() => handler({
          type: 'afterPipeline',
          data: { ...pipelineData, context },
        }));
      }
    }

    graphSpan?.setStatus('ok');
    graphSpan?.end();

    return {
      success: true,
      context,
      outputs: nodeOutputs,
      executedNodes,
    };
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));

    // Fire onPipelineError hooks
    if (hookManager) {
      const errorEvent: HookEvent = {
        type: 'onPipelineError',
        data: { ...pipelineData, error: err },
      };
      yield* runAsync(() => hookManager.executeHooks('onPipelineError', errorEvent)).pipe(Effect.ignore);
    }

    graphSpan?.setStatus('error', err.message);
    graphSpan?.end();

    return {
      success: false,
      context,
      outputs: nodeOutputs,
      executedNodes,
      error: err,
    };
    }
  });
}

export const GraphExecutorServiceLive = Layer.succeed(GraphExecutorService, {
  executeGraphWorkflow: (config, input, options) => executeGraphWorkflowEffect(config, input, options),
});

/**
 * @deprecated Use `GraphExecutorService.executeGraphWorkflow` for Effect-native composition.
 */
export async function executeGraphWorkflow(
  config: GraphWorkflowConfig,
  input: string,
  options: GraphExecutorOptions
): Promise<GraphExecutionResult> {
  return Effect.runPromise(executeGraphWorkflowEffect(config, input, options));
}

/**
 * Execute a single graph node.
 * Helper function that delegates to appropriate executor based on node type.
 */
function executeNode(
  node: GraphNode,
  context: PipelineContext,
  options: GraphExecutorOptions,
  config: GraphWorkflowConfig,
  hookManager?: HookManagerLike
): Effect.Effect<unknown, Error> {
  const { agentManager, pipelineManager, tracer } = options;
  return Effect.gen(function* () {
    // Create step event data for hooks
    const stepData: StepHookEventData = {
      pipelineId: config.id,
      input: context.input,
      context,
      step: {
        name: node.name || node.id,
        type: node.type,
        index: 0,
      },
    };

    if (hookManager) {
      const correlationCtx = getCurrentCorrelationContext();
      const spanIds = getCurrentSpanIds();
      const beforeEvent: HookEvent = {
        type: 'beforeStep',
        data: stepData,
        runId: context.metadata.runId as string | undefined || correlationCtx?.runId,
        conversationId: context.conversationId || correlationCtx?.conversationId,
        intentId: correlationCtx?.intentId,
        agentId: (node.type === 'agent' ? node.agentId : undefined) || correlationCtx?.agentId,
        timestamp: new Date().toISOString(),
        traceId: spanIds.traceId || correlationCtx?.traceId,
        spanId: spanIds.spanId || correlationCtx?.spanId,
        parentSpanId: spanIds.parentSpanId || correlationCtx?.parentSpanId,
        pipelineId: config.id,
        stepName: node.name || node.id,
      };
      const beforeResult = yield* runAsync(() => hookManager.executeHooksAndMerge('beforeStep', beforeEvent));

      if (beforeResult.metadata) {
        context.metadata = { ...context.metadata, ...beforeResult.metadata };
      }

      if (beforeResult.skip) {
        return undefined;
      }

      if ((beforeResult as any).abort) {
        return yield* Effect.fail(new Error('Execution aborted by beforeStep hook'));
      }
    }

    if (config.hooks?.beforeStep) {
      for (const handler of config.hooks.beforeStep) {
        const hookResult = yield* runAsync(() => handler({ type: 'beforeStep', data: stepData }));
        if (hookResult?.skip) {
          return undefined;
        }
        if (hookResult && 'abort' in hookResult && (hookResult as any).abort) {
          return yield* Effect.fail(new Error('Execution aborted by graph beforeStep hook'));
        }
      }
    }

    let result: unknown;

    switch (node.type) {
      case 'agent': {
        const agent = agentManager.getAgent(node.agentId);
        if (!agent) {
          return yield* Effect.fail(new Error(`Agent "${node.agentId}" not found`));
        }
        const agentResult = yield* agent.processMessage(context.input, context.history).pipe(
          Effect.mapError(toError)
        );

        if (isHandoffSignal(agentResult)) {
          result = yield* handleHandoff(
            agentResult,
            node.agentId,
            context,
            config,
            options,
            hookManager
          );
        } else {
          result = agentResult;
        }
        break;
      }

      case 'function': {
        result = yield* runAsync(() => node.fn(context));
        break;
      }

      case 'conditional': {
        const conditionResult = yield* runAsync(() => node.condition(context));
        result = { conditionResult };
        break;
      }

      case 'pipeline': {
        if (!pipelineManager) {
          return yield* Effect.fail(new Error('Pipeline manager required for pipeline nodes'));
        }
        const nestedPipeline = pipelineManager.getPipeline(node.pipelineId);
        if (!nestedPipeline) {
          return yield* Effect.fail(new Error(`Nested pipeline "${node.pipelineId}" not found`));
        }
        result = yield* runAsync(() => nestedPipeline.execute(context.input));
        break;
      }

      default:
        return yield* Effect.fail(new Error(`Unknown node type: ${(node as any).type}`));
    }

    void (context.metadata.runId as string | undefined);

    if (hookManager) {
      const afterData: StepHookEventData = { ...stepData, result };
      const afterCorrelationCtx = getCurrentCorrelationContext();
      const afterSpanIds = getCurrentSpanIds();
      const afterEvent: HookEvent = {
        type: 'afterStep',
        data: afterData,
        runId: context.metadata.runId as string | undefined || afterCorrelationCtx?.runId,
        conversationId: context.conversationId || afterCorrelationCtx?.conversationId,
        intentId: afterCorrelationCtx?.intentId,
        agentId: (node.type === 'agent' ? node.agentId : undefined) || afterCorrelationCtx?.agentId,
        timestamp: new Date().toISOString(),
        traceId: afterSpanIds.traceId || afterCorrelationCtx?.traceId,
        spanId: afterSpanIds.spanId || afterCorrelationCtx?.spanId,
        parentSpanId: afterSpanIds.parentSpanId || afterCorrelationCtx?.parentSpanId,
        pipelineId: config.id,
        stepName: node.name || node.id,
      };
      const afterResult = yield* runAsync(() => hookManager.executeHooksAndMerge('afterStep', afterEvent));

      if (afterResult.metadata) {
        context.metadata = { ...context.metadata, ...afterResult.metadata };
      }

      if ((afterResult as any).abort) {
        return yield* Effect.fail(new Error('Execution aborted by afterStep hook'));
      }
    }

    if (config.hooks?.afterStep) {
      for (const handler of config.hooks.afterStep) {
        const handlerResult = yield* runAsync(() => handler({
          type: 'afterStep',
          data: { ...stepData, result },
        }));
        if ((handlerResult as any)?.abort) {
          return yield* Effect.fail(new Error('Execution aborted by graph afterStep hook'));
        }
      }
    }

    return result;
  });
}

/**
 * Handle agent handoff request.
 *
 * Executes target agent with full context transfer and supports chaining.
 * Handoffs are terminating - source agent does not resume.
 *
 * @param handoffRequest - The handoff request from source agent
 * @param sourceAgentId - ID of the agent initiating handoff
 * @param context - Current pipeline context
 * @param config - Graph workflow configuration
 * @param options - Executor options
 * @param hookManager - Optional hook manager
 * @returns Result from target agent (or handoff chain)
 */
function handleHandoff(
  handoffRequest: HandoffSignal,
  sourceAgentId: string,
  context: PipelineContext,
  config: GraphWorkflowConfig,
  options: GraphExecutorOptions,
  hookManager?: HookManagerLike
): Effect.Effect<unknown, Error> {
  const { agentManager, tracer } = options;
  const { targetAgent, reason } = handoffRequest;
  return Effect.gen(function* () {
    if (!config.handoffs?.[sourceAgentId]?.includes(targetAgent)) {
      const availableTargets = config.handoffs?.[sourceAgentId] || [];
      const error = `Handoff to '${targetAgent}' not allowed. Available: ${availableTargets.join(', ')}`;

      return {
        type: 'handoff_error',
        error,
        availableTargets,
      };
    }

    const handoffContext = prepareHandoffContext(
      { targetAgent, reason },
      context,
      {
        sourceAgent: sourceAgentId,
        allowedTargets: config.handoffs[sourceAgentId],
      }
    );

    if (hookManager) {
      const handoffStepData: StepHookEventData = {
        pipelineId: config.id,
        input: context.input,
        context,
        step: {
          name: `handoff-${sourceAgentId}-to-${targetAgent}`,
          type: 'agent',
          index: 0,
        },
        result: {
          type: 'handoff',
          handoffFrom: sourceAgentId,
          handoffTo: targetAgent,
          handoffReason: reason,
        },
      };

      const afterEvent: HookEvent = {
        type: 'afterStep',
        data: handoffStepData,
      };

      yield* runAsync(() => hookManager.executeHooksAndMerge('afterStep', afterEvent));
    }

    context.history = handoffContext.history;
    context.outputs = { ...context.outputs, ...handoffContext.outputs };

    const handoffChain = (context.metadata.handoffChain as string[] | undefined) || [];
    const updatedChain = [...handoffChain, sourceAgentId];

    context.metadata = {
      ...context.metadata,
      ...handoffContext.metadata,
      handoffFrom: sourceAgentId,
      handoffTo: targetAgent,
      handoffReason: reason,
      handoffChain: updatedChain,
    };

    const handoffSpan = tracer?.startSpan(`graph.handoff.${sourceAgentId}-to-${targetAgent}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'handoff.from': sourceAgentId,
        'handoff.to': targetAgent,
        'handoff.reason': reason || '',
        'handoff.chainDepth': handoffChain.length,
      },
    });

    const targetAgentInstance = agentManager.getAgent(targetAgent);
    if (!targetAgentInstance) {
      handoffSpan?.setStatus('error', `Target agent "${targetAgent}" not found for handoff`);
      handoffSpan?.end();
      return yield* Effect.fail(new Error(`Target agent "${targetAgent}" not found for handoff`));
    }

    const targetResult = yield* targetAgentInstance.processMessage(
      context.input,
      context.history
    ).pipe(Effect.mapError(toError));

    if (isHandoffSignal(targetResult)) {
      handoffSpan?.setAttributes({
        'handoff.chained': true,
        'handoff.nextTarget': targetResult.targetAgent,
      });
      handoffSpan?.end();

      return yield* handleHandoff(
        targetResult,
        targetAgent,
        context,
        config,
        options,
        hookManager
      );
    }

    handoffSpan?.setStatus('ok');
    handoffSpan?.end();
    return targetResult;
  }).pipe(
    Effect.catchAll((error) => {
      const err = toError(error);
      return Effect.fail(err);
    })
  );
}
