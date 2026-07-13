/**
 * Compatibility adapter for the historical V2 pipeline executor API.
 *
 * Execution now belongs to `workflow/execute.ts`; this module only compiles the
 * V2 surface to WorkflowIR and maps the unified result/error shapes back to the
 * public legacy contract.
 */
import { Context, Effect, Layer } from 'effect';
import type { AgentMessage, AgentResponse, AnyAgentInstance } from '../agent/agent';
import { normalizeMessages } from '../messages';
import type { Tracer } from '../tracing';
import type { HookEvent, HookType } from '../hooks/types';
import type { CheckpointManager } from './checkpoint/manager';
import type { PipelineContext } from './context';
import { PipelineExecutionError } from './errors';
import type { PipelineConfigV2 } from './pipeline';
import { compilePipelineV2 } from '../workflow/compile';
import {
  executeWorkflowEffect,
  type WorkflowExecutionOptions,
  type WorkflowExecutionResult,
} from '../workflow/execute';
import {
  WorkflowInputValidationError,
  WorkflowOutputValidationError,
} from '../workflow/errors';

/** Minimal agent manager interface retained for public compatibility. */
export interface AgentManagerLike {
  getAgent(id: string): AnyAgentInstance | undefined;
  hasAgent(id: string): boolean;
}

/** Minimal hook manager interface retained for public compatibility. */
export interface HookManagerLike {
  executeHooks(hookName: HookType, event: HookEvent): Promise<void>;
  executeHooksAndMerge(
    hookName: HookType,
    event: HookEvent,
  ): Promise<{ abort?: boolean; skip?: boolean; metadata?: Record<string, unknown> }>;
}

export interface PipelineResult {
  success: boolean;
  status?: 'completed' | 'failed' | 'paused' | 'aborted';
  context: PipelineContext;
  executedNodes: string[];
  finalOutput?: unknown;
  error?: Error;
  abortedBy?: string;
  runId?: string;
  pauseRequest?: {
    prompt: string;
    choices?: string[];
    schema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

export interface ExecutorOptions {
  agentManager: AgentManagerLike;
  hookManager?: HookManagerLike;
  tracer?: Tracer;
  pipelineManager?: {
    getPipeline: (id: string) => { execute: (input: unknown) => Promise<AgentResponse> } | undefined;
  };
  checkpointManager?: CheckpointManager;
}

export interface ExtendedExecutionOptions extends ExecutorOptions {
  conversationId?: string;
  history?: Array<{ role: string; content: string }>;
  runId?: string;
  startStep?: number;
  restoredContext?: PipelineContext;
}

export interface ExecutorService {
  executePipelineV2(
    config: PipelineConfigV2,
    input: string,
    options: ExtendedExecutionOptions,
  ): Effect.Effect<PipelineResult, PipelineExecutionError>;
}

export const ExecutorService = Context.GenericTag<ExecutorService>('ExecutorService');

function toWorkflowOptions(options: ExtendedExecutionOptions): WorkflowExecutionOptions {
  return {
    agentManager: options.agentManager,
    hookManager: options.hookManager,
    tracer: options.tracer,
    pipelineManager: options.pipelineManager,
    checkpointManager: options.checkpointManager,
    conversationId: options.conversationId,
    history: normalizeMessages(options.history ?? []),
    runId: options.runId,
    startStep: options.startStep,
    restoredContext: options.restoredContext,
  };
}

function toPipelineResult(result: WorkflowExecutionResult): PipelineResult {
  return {
    success: result.success,
    status: result.status,
    context: result.context,
    executedNodes: result.executedNodes,
    finalOutput: result.finalOutput,
    error: result.error,
    abortedBy: result.abortedBy,
    runId: result.runId,
    pauseRequest: result.pauseRequest,
  };
}

export function executePipelineV2Effect(
  config: PipelineConfigV2,
  input: string,
  options: ExtendedExecutionOptions,
): Effect.Effect<PipelineResult, PipelineExecutionError> {
  const workflow = compilePipelineV2(config);
  const runId = options.runId ?? options.checkpointManager?.generateRunId() ?? crypto.randomUUID();
  const executionOptions = { ...options, runId };
  return executeWorkflowEffect(workflow, input, toWorkflowOptions(executionOptions)).pipe(
    Effect.mapError((error) => {
      if (
        error instanceof WorkflowInputValidationError
        || error instanceof WorkflowOutputValidationError
      ) {
        return new PipelineExecutionError({
          pipelineId: config.id,
          step: 0,
          cause: error,
        });
      }
      return error;
    }),
    Effect.flatMap((result) => {
      if (!result.success && result.status === 'failed' && config.failFast !== false) {
        const step = workflow.nodes.find((node) => node.id === result.failedNodeId)?.sourceIndex ?? 0;
        return Effect.fail(new PipelineExecutionError({
          pipelineId: config.id,
          step,
          cause: result.error ?? new Error('Pipeline execution failed'),
        }));
      }
      return Effect.succeed(toPipelineResult(result));
    }),
  );
}

export const ExecutorServiceLive = Layer.succeed(ExecutorService, {
  executePipelineV2: executePipelineV2Effect,
});

export type { AgentMessage };
