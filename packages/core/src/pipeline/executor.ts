/**
 * Compatibility adapter for the historical V2 pipeline executor API.
 *
 * Execution now belongs to `workflow/execute.ts`; this module only compiles the
 * V2 surface to WorkflowIR and maps the unified result/error shapes back to the
 * public legacy contract.
 */
import { Cause, Context, Effect, Exit, Layer } from 'effect';
import type { AgentInstance, AgentMessage, AgentResponse } from '../agent/agent';
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

/** Minimal agent manager interface retained for public compatibility. */
export interface AgentManagerLike {
  getAgent(id: string): AgentInstance | undefined;
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
    getPipeline: (id: string) => { execute: (message: string) => Promise<AgentResponse> } | undefined;
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

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function fallbackContext(
  config: PipelineConfigV2,
  input: string,
  options: ExtendedExecutionOptions,
): PipelineContext {
  if (options.restoredContext) return options.restoredContext;
  return {
    pipelineId: config.id,
    input,
    outputs: {},
    history: normalizeMessages(options.history ?? []),
    metadata: {},
    conversationId: options.conversationId,
  };
}

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
  return executeWorkflowEffect(workflow, input, toWorkflowOptions(options)).pipe(
    Effect.map(toPipelineResult),
    Effect.catchTag('WorkflowNodeExecutionError', (error) => {
      const step = workflow.nodes.find((node) => node.id === error.nodeId)?.sourceIndex ?? 0;
      const pipelineError = new PipelineExecutionError({
        pipelineId: config.id,
        step,
        cause: toError(error.cause),
      });
      if (config.failFast === false) {
        return Effect.succeed({
          success: false,
          status: 'failed' as const,
          context: fallbackContext(config, input, options),
          error: toError(error.cause),
          runId: options.runId,
        });
      }
      return Effect.fail(pipelineError);
    }),
  );
}

export const ExecutorServiceLive = Layer.succeed(ExecutorService, {
  executePipelineV2: executePipelineV2Effect,
});

/** @deprecated Use `ExecutorService.executePipelineV2` for Effect-native composition. */
export async function executePipelineV2(
  config: PipelineConfigV2,
  input: string,
  options: ExtendedExecutionOptions,
): Promise<PipelineResult> {
  return new Promise((resolve, reject) => {
    Effect.runCallback(
      executePipelineV2Effect(config, input, options).pipe(
        Effect.catchTag('PipelineExecutionError', (error) =>
          Effect.succeed({
            success: false,
            status: 'failed' as const,
            context: fallbackContext(config, input, options),
            error: toError(error.cause),
            runId: options.runId,
          }),
        ),
      ),
      {
        onExit: (exit) => {
          if (Exit.isSuccess(exit)) {
            resolve(exit.value);
            return;
          }
          reject(Cause.squash(exit.cause));
        },
      },
    );
  });
}

export type { AgentMessage };
