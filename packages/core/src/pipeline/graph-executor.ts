/**
 * Compatibility adapter for the historical graph executor API.
 * Graph configs now compile to WorkflowIR and execute through the single
 * Effect-native workflow executor.
 */
import { Cause, Context, Effect, Exit, Layer } from 'effect';
import type { AgentResponse } from '../agent/agent';
import type { PipelineContext } from './context';
import type { AgentManagerLike, ExecutorOptions, HookManagerLike } from './executor';
import type { BranchCondition, GraphEdge, GraphWorkflowConfig } from './graph';
import type { Tracer } from '../tracing';
import { compileGraphWorkflow } from '../workflow/compile';
import {
  executeWorkflowEffect,
  type WorkflowExecutionResult,
} from '../workflow/execute';

export interface GraphExecutionResult {
  success: boolean;
  context: PipelineContext;
  outputs: Record<string, unknown>;
  executedNodes: string[];
  error?: Error;
  abortedBy?: string;
}

export type GraphExecutionError = Error;

export interface GraphExecutorOptions extends ExecutorOptions {
  conversationId?: string;
  agentManager: AgentManagerLike;
  hookManager?: HookManagerLike;
  tracer?: Tracer;
  pipelineManager?: {
    getPipeline: (id: string) => { execute: (message: string) => Promise<AgentResponse> } | undefined;
    executePipelineV2?: (
      config: unknown,
      input: string,
      options: unknown,
    ) => Promise<unknown>;
  };
}

export interface GraphExecutorService {
  executeGraphWorkflow(
    config: GraphWorkflowConfig,
    input: string,
    options: GraphExecutorOptions,
  ): Effect.Effect<GraphExecutionResult, GraphExecutionError>;
}

export const GraphExecutorService =
  Context.GenericTag<GraphExecutorService>('GraphExecutorService');

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

export function evaluateCondition(condition: BranchCondition, context: PipelineContext): boolean {
  const value = readPath(context.outputs, condition.field);
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
  }
}

export function selectNextNodes(
  currentNode: string,
  edges: GraphEdge[],
  context: PipelineContext,
): string[] {
  const outgoing = edges.filter((edge) => edge.from === currentNode);
  for (const edge of outgoing) {
    if (edge.condition && evaluateCondition(edge.condition, context)) return [edge.to];
  }
  const fallback = outgoing.find((edge) => edge.default);
  if (fallback) return [fallback.to];
  return outgoing.filter((edge) => !edge.condition && !edge.default).map((edge) => edge.to);
}

export function executeGraphWorkflowEffect(
  config: GraphWorkflowConfig,
  input: string,
  options: GraphExecutorOptions,
): Effect.Effect<GraphExecutionResult, GraphExecutionError> {
  const workflow = compileGraphWorkflow(config);
  return executeWorkflowEffect(workflow, input, {
    agentManager: options.agentManager,
    hookManager: options.hookManager,
    tracer: options.tracer,
    pipelineManager: options.pipelineManager,
    conversationId: options.conversationId,
  }).pipe(
    Effect.map((result: WorkflowExecutionResult): GraphExecutionResult => ({
      success: result.success,
      context: result.context,
      outputs: result.outputs,
      executedNodes: result.executedNodes,
      error: result.error,
      abortedBy: result.abortedBy,
    })),
  );
}

export const GraphExecutorServiceLive = Layer.succeed(GraphExecutorService, {
  executeGraphWorkflow: executeGraphWorkflowEffect,
});

/** @deprecated Use `GraphExecutorService.executeGraphWorkflow` for Effect-native composition. */
export async function executeGraphWorkflow(
  config: GraphWorkflowConfig,
  input: string,
  options: GraphExecutorOptions,
): Promise<GraphExecutionResult> {
  return new Promise((resolve) => {
    Effect.runCallback(executeGraphWorkflowEffect(config, input, options), {
      onExit: (exit) => {
        if (Exit.isSuccess(exit)) {
          resolve(exit.value);
          return;
        }
        resolve({
          success: false,
          context: {
            pipelineId: config.id,
            input,
            outputs: {},
            history: [],
            metadata: {},
            conversationId: options.conversationId,
          },
          outputs: {},
          executedNodes: [],
          error: toError(Cause.squash(exit.cause)),
        });
      },
    });
  });
}
