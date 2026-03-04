/**
 * Pipeline Executor
 *
 * Core execution engine for V2 pipelines with:
 * - Sequential step execution
 * - Hook integration (beforePipeline, afterPipeline, beforeStep, afterStep, onStepError)
 * - Retry with exponential backoff
 * - Flow control (abort/skip)
 */

import {
  type PipelineStep,
  type AgentStep,
  type FunctionStep,
  type ConditionalStep,
  type PipelineRefStep,
  type RetryConfig,
} from './steps';
import type { PipelineConfigV2 } from './pipeline';
import { PipelineContextManager, createPipelineContext } from './context';
import type { PipelineContext } from './context';
import type { HookEvent, StepHookEventData, PipelineHookEventData } from '../hooks/types';
import type { AgentInstance, AgentResponse } from '../agent/agent';
import type { Tracer } from '../tracing';
import { SpanKind } from '../tracing';
import type { CheckpointManager } from './checkpoint/manager';
import { detectPauseSignal, type DetectedPause } from './pause';
import { Cause, Context, Duration, Effect, Exit, Layer, Option } from 'effect';
import { annotateSpan } from '../observability/otel';
import { attachErrorToSpan } from '../observability/errors';
import { getCurrentCorrelationContext, getCurrentSpanIds, getCorrelationContext } from '../observability/context';
import { ObservabilityService } from '../observability/service';
import { PipelineExecutionError } from './errors';

/** Minimal agent manager interface for pipeline execution */
export interface AgentManagerLike {
  getAgent(id: string): AgentInstance;
  hasAgent(id: string): boolean;
}

/** Minimal hook manager interface for pipeline execution */
export interface HookManagerLike {
  executeHooks(hookName: string, event: any): Promise<void>;
  executeHooksAndMerge(hookName: string, event: any): Promise<any>;
}

/**
 * Pipeline execution result
 */
export interface PipelineResult {
  success: boolean;
  status?: 'completed' | 'failed' | 'paused' | 'aborted';
  context: PipelineContext;
  finalOutput?: unknown;
  error?: Error;
  abortedBy?: string; // Hook that requested abort
  runId?: string; // Run ID for checkpoint tracking
  pauseRequest?: {
    prompt: string;
    choices?: string[];
    schema?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  };
}

/**
 * Executor options
 */
export interface ExecutorOptions {
  agentManager: AgentManagerLike;
  hookManager?: HookManagerLike;
  tracer?: Tracer;
  pipelineManager?: {
    getPipeline: (id: string) => { execute: (msg: string) => Promise<AgentResponse> } | undefined;
  };
  checkpointManager?: CheckpointManager;
}

/**
 * Extended execution options for resume support.
 */
export interface ExtendedExecutionOptions extends ExecutorOptions {
  conversationId?: string;
  history?: Array<{ role: string; content: string }>;
  runId?: string;                  // Custom run ID (auto-generated if not provided)
  startStep?: number;              // Start from specific step (for resume)
  restoredContext?: PipelineContext; // Restored context from checkpoint
}

/**
 * Effect-based executor dependency interface.
 */
export interface ExecutorService {
  executePipelineV2(
    config: PipelineConfigV2,
    input: string,
    options: ExtendedExecutionOptions
  ): Effect.Effect<PipelineResult, PipelineExecutionError>;
}

export const ExecutorService = Context.GenericTag<ExecutorService>('ExecutorService');

/**
 * Execute a single step with retry logic.
 */
function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function runAsync<A>(thunk: () => PromiseLike<A> | A): Effect.Effect<A, Error> {
  return Effect.tryPromise({
    try: () => Promise.resolve(thunk()),
    catch: toError,
  });
}

function executeStepWithRetry(
  step: PipelineStep,
  context: PipelineContext,
  options: ExecutorOptions,
  retryCount: number = 0
): Effect.Effect<unknown, Error> {
  const { agentManager, pipelineManager } = options;

  return Effect.gen(function* () {
    switch (step.type) {
      case 'agent': {
        const agent = agentManager.getAgent(step.agentId);
        if (!agent) {
          return yield* Effect.fail(new Error(`Agent "${step.agentId}" not found`));
        }
        return yield* agent.processMessage(context.input, context.history).pipe(
          Effect.mapError(toError)
        );
      }

      case 'function': {
        return yield* runAsync(() => step.fn(context));
      }

      case 'conditional': {
        const conditionResult = yield* runAsync(() => step.condition(context));
        const stepsToRun = conditionResult ? step.whenTrue : step.whenFalse;

        const branchInfo = {
          conditionResult,
          takenPath: conditionResult ? 'whenTrue' : 'whenFalse',
          notTakenPath: conditionResult ? 'whenFalse' : 'whenTrue',
        };

        if (!stepsToRun || stepsToRun.length === 0) {
          return { conditionResult, skipped: true, branchInfo };
        }

        let nestedResult: unknown;
        for (const nestedStep of stepsToRun) {
          nestedResult = yield* executeStepWithRetry(nestedStep, context, options, 0);
        }
        return { conditionResult, result: nestedResult, branchInfo };
      }

      case 'pipeline': {
        if (!pipelineManager) {
          return yield* Effect.fail(new Error('Pipeline manager required for nested pipeline steps'));
        }
        const nestedPipeline = pipelineManager.getPipeline(step.pipelineId);
        if (!nestedPipeline) {
          return yield* Effect.fail(new Error(`Nested pipeline "${step.pipelineId}" not found`));
        }
        return yield* Effect.tryPromise({
          try: () => Promise.resolve(nestedPipeline.execute(context.input)),
          catch: toError,
        });
      }

      default:
        return yield* Effect.fail(new Error(`Unknown step type: ${(step as any).type}`));
    }
  });
}

/**
 * Execute step with retry and hook integration.
 */
function executeStepWithHooks(
  step: PipelineStep,
  stepIndex: number,
  contextManager: PipelineContextManager,
  config: PipelineConfigV2,
  options: ExecutorOptions,
  runId?: string
): Effect.Effect<{ result: unknown; skipped: boolean; aborted: boolean; abortReason?: string; paused?: DetectedPause }, Error> {
  const { hookManager, tracer } = options;
  return Effect.gen(function* () {
    const context = contextManager.getStepContext(step.contextView);

    const correlationCtx = getCurrentCorrelationContext();
    const spanIds = getCurrentSpanIds();

    const stepData: StepHookEventData = {
      pipelineId: config.id,
      input: context.input,
      context,
      step: {
        name: step.name,
        type: step.type,
        index: stepIndex,
      },
    };

    if (hookManager) {
      const beforeEvent: HookEvent = {
        type: 'beforeStep',
        data: stepData,
        runId: runId || correlationCtx?.runId,
        conversationId: context.conversationId || correlationCtx?.conversationId,
        intentId: correlationCtx?.intentId,
        agentId: (step.type === 'agent' ? (step as AgentStep).agentId : undefined) || correlationCtx?.agentId,
        timestamp: new Date().toISOString(),
        traceId: spanIds.traceId || correlationCtx?.traceId,
        spanId: spanIds.spanId || correlationCtx?.spanId,
        parentSpanId: spanIds.parentSpanId || correlationCtx?.parentSpanId,
        pipelineId: config.id,
        stepName: step.name,
      };
      const beforeResult = yield* runAsync(() => hookManager.executeHooksAndMerge('beforeStep', beforeEvent));

      if (beforeResult.metadata) {
        contextManager.mergeMetadata(beforeResult.metadata);
      }

      if (beforeResult.skip) {
        return { result: undefined, skipped: true, aborted: false };
      }

      if (beforeResult.abort) {
        return { result: undefined, skipped: false, aborted: true, abortReason: 'beforeStep hook' };
      }
    }

    if (config.hooks?.beforeStep) {
      for (const handler of config.hooks.beforeStep) {
        const result = yield* runAsync(() => handler({ type: 'beforeStep', data: stepData }));
        if (result?.skip) {
          return { result: undefined, skipped: true, aborted: false };
        }
        if (result?.abort) {
          return { result: undefined, skipped: false, aborted: true, abortReason: 'pipeline beforeStep hook' };
        }
      }
    }

    const stepSpan = tracer?.startSpan(`pipeline.step.${step.name}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'step.name': step.name,
        'step.type': step.type,
        'step.index': stepIndex,
        'pipeline.id': config.id,
        ...(runId ? { 'fred.runId': runId } : {}),
        ...(context.conversationId ? { 'fred.conversationId': context.conversationId } : {}),
        ...(correlationCtx?.intentId ? { 'fred.intentId': correlationCtx.intentId } : {}),
        ...(context.metadata.workflowId ? { 'fred.workflowId': context.metadata.workflowId as string } : {}),
      },
    });

    const spanAnnotation = annotateSpan({
      runId,
      conversationId: context.conversationId,
      workflowId: context.metadata.workflowId as string | undefined,
      stepName: step.name,
    });

    yield* Effect.fork(spanAnnotation.pipe(Effect.ignore));

    let result: unknown;
    let lastError: Error | undefined;
    const stepStartTime = Date.now();
    const maxRetries = step.retry?.maxRetries ?? 0;
    const backoffMs = step.retry?.backoffMs ?? 100;
    const maxBackoffMs = step.retry?.maxBackoffMs ?? 10000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const retryAnnotation = annotateSpan({ attempt });
        yield* Effect.fork(retryAnnotation.pipe(Effect.ignore));
        stepSpan?.addEvent(`retry.attempt.${attempt}`, {
          'retry.attempt': attempt,
          'retry.maxRetries': maxRetries,
        });
      }

      const attemptResult = yield* executeStepWithRetry(step, context, options, attempt).pipe(Effect.either);
      if (attemptResult._tag === 'Right') {
        result = attemptResult.right;
        lastError = undefined;
        if (attempt > 0) {
          stepSpan?.addEvent('retry.success', { 'retry.attempt': attempt });
        }
        break;
      }

      {
        lastError = toError(attemptResult.left);
        if (attempt > 0) {
          stepSpan?.addEvent('retry.error', {
            'retry.attempt': attempt,
            'error.message': lastError.message,
          });
        }

        if (stepSpan) {
          attachErrorToSpan(stepSpan, lastError, {
            includeStack: false,
          });
        }

        if (hookManager) {
          const errorData: StepHookEventData = {
            ...stepData,
            error: lastError,
            retryCount: attempt,
          };
          const errorSpanIds = getCurrentSpanIds();
          const errorEvent: HookEvent = {
            type: 'onStepError',
            data: errorData,
            runId: runId || correlationCtx?.runId,
            conversationId: context.conversationId || correlationCtx?.conversationId,
            intentId: correlationCtx?.intentId,
            agentId: (step.type === 'agent' ? (step as AgentStep).agentId : undefined) || correlationCtx?.agentId,
            timestamp: new Date().toISOString(),
            traceId: errorSpanIds.traceId || correlationCtx?.traceId,
            spanId: errorSpanIds.spanId || correlationCtx?.spanId,
            parentSpanId: errorSpanIds.parentSpanId || correlationCtx?.parentSpanId,
            pipelineId: config.id,
            stepName: step.name,
          };
          const errorResult = yield* runAsync(() => hookManager.executeHooksAndMerge('onStepError', errorEvent));

          if (errorResult.abort) {
            stepSpan?.end();
            return { result: undefined, skipped: false, aborted: true, abortReason: 'onStepError hook' };
          }
        }

        if (config.hooks?.onStepError) {
          for (const handler of config.hooks.onStepError) {
            const hookResult = yield* runAsync(() => handler({
                type: 'onStepError',
                data: { ...stepData, error: lastError, retryCount: attempt },
              }));
            if (hookResult?.abort) {
              stepSpan?.end();
              return { result: undefined, skipped: false, aborted: true, abortReason: 'pipeline onStepError hook' };
            }
          }
        }

        if (attempt < maxRetries) {
          const delay = Math.min(backoffMs * Math.pow(2, attempt), maxBackoffMs);
          yield* Effect.sleep(Duration.millis(delay));
        }
      }
    }

    if (lastError) {
      if (stepSpan) {
        attachErrorToSpan(stepSpan, lastError, {
          includeStack: false,
        });
        stepSpan.end();
      }
      return yield* Effect.fail(lastError);
    }

    const pauseDetected = detectPauseSignal(result);
    if (pauseDetected) {
      stepSpan?.setStatus('ok');
      stepSpan?.end();
      return { result, skipped: false, aborted: false, paused: pauseDetected };
    }

    if (step.type === 'conditional' && typeof result === 'object' && result !== null) {
      const branchInfo = (result as any).branchInfo;
      if (branchInfo) {
        const { conditionResult, takenPath, notTakenPath } = branchInfo;

        stepSpan?.addEvent('pipeline.branch_taken', {
          'branch.condition': step.name,
          'branch.result': conditionResult,
          'branch.path': takenPath,
          'branch.taken': true,
        });

        stepSpan?.addEvent('pipeline.branch_not_taken', {
          'branch.condition': step.name,
          'branch.result': conditionResult,
          'branch.path': notTakenPath,
          'branch.taken': false,
        });

        if (runId) {
          const observability = yield* Effect.serviceOption(ObservabilityService);
          if (Option.isSome(observability)) {
            const recordBranchEffect = Effect.gen(function* () {
              const ctx = yield* getCorrelationContext;
              yield* observability.value.logStructured({
                level: 'debug',
                message: 'Pipeline branch decision',
                metadata: {
                  pipelineId: config.id,
                  stepName: step.name,
                  conditionResult,
                  takenPath,
                  notTakenPath,
                  ...ctx,
                },
              });
            });

            yield* Effect.fork(recordBranchEffect.pipe(Effect.ignore));
          }
        }
      }
    }

    contextManager.recordStepOutput(step.name, result);

    if (runId) {
      const observability = yield* Effect.serviceOption(ObservabilityService);
      if (Option.isSome(observability)) {
        const stepEndTime = Date.now();
        const recordStepEffect = Effect.gen(function* () {
          const ctx = yield* getCorrelationContext;
          yield* observability.value.recordRunStepSpan(runId, {
            stepName: step.name,
            startTime: stepStartTime,
            endTime: stepEndTime,
            status: 'success',
            metadata: {
              pipelineId: config.id,
              stepType: step.type,
              stepIndex,
              ...ctx,
            },
          });
        });

        yield* Effect.fork(recordStepEffect.pipe(Effect.ignore));
      }
    }

    if (hookManager) {
      const afterData: StepHookEventData = { ...stepData, result };
      const afterSpanIds = getCurrentSpanIds();
      const afterEvent: HookEvent = {
        type: 'afterStep',
        data: afterData,
        runId: runId || correlationCtx?.runId,
        conversationId: context.conversationId || correlationCtx?.conversationId,
        intentId: correlationCtx?.intentId,
        agentId: (step.type === 'agent' ? (step as AgentStep).agentId : undefined) || correlationCtx?.agentId,
        timestamp: new Date().toISOString(),
        traceId: afterSpanIds.traceId || correlationCtx?.traceId,
        spanId: afterSpanIds.spanId || correlationCtx?.spanId,
        parentSpanId: afterSpanIds.parentSpanId || correlationCtx?.parentSpanId,
        pipelineId: config.id,
        stepName: step.name,
      };
      const afterResult = yield* runAsync(() => hookManager.executeHooksAndMerge('afterStep', afterEvent));

      if (afterResult.metadata) {
        contextManager.mergeMetadata(afterResult.metadata);
      }

      if (afterResult.abort) {
        stepSpan?.setStatus('ok');
        stepSpan?.end();
        return { result, skipped: false, aborted: true, abortReason: 'afterStep hook' };
      }
    }

    if (config.hooks?.afterStep) {
      for (const handler of config.hooks.afterStep) {
        const handlerResult = yield* runAsync(() => handler({
            type: 'afterStep',
            data: { ...stepData, result },
          }));
        if (handlerResult?.abort) {
          stepSpan?.setStatus('ok');
          stepSpan?.end();
          return { result, skipped: false, aborted: true, abortReason: 'pipeline afterStep hook' };
        }
      }
    }

    stepSpan?.setStatus('ok');
    stepSpan?.end();

    return { result, skipped: false, aborted: false };
  });
}

/**
 * Execute a V2 pipeline.
 */
export function executePipelineV2Effect(
  config: PipelineConfigV2,
  input: string,
  options: ExtendedExecutionOptions
): Effect.Effect<PipelineResult, PipelineExecutionError> {
  const { hookManager, tracer, checkpointManager } = options;
  let currentStep = options.startStep ?? 0;

  return Effect.gen(function* () {
    const runId = options.runId ?? checkpointManager?.generateRunId() ?? crypto.randomUUID();
    const startStep = options.startStep ?? 0;
    const checkpointEnabled = config.checkpoint?.enabled !== false && checkpointManager !== undefined;
    const checkpointTtlMs = config.checkpoint?.ttlMs;

    let contextManager: PipelineContextManager;
    if (options.restoredContext) {
      contextManager = createPipelineContext({
        pipelineId: config.id,
        input: options.restoredContext.input,
        history: options.restoredContext.history,
        conversationId: options.conversationId ?? options.restoredContext.conversationId,
      });
      for (const [stepName, output] of Object.entries(options.restoredContext.outputs)) {
        contextManager.recordStepOutput(stepName, output);
      }
      contextManager.mergeMetadata(options.restoredContext.metadata);
    } else {
      contextManager = createPipelineContext({
        pipelineId: config.id,
        input,
        history: options.history as any,
        conversationId: options.conversationId,
      });
    }

    const pipelineSpan = tracer?.startSpan(`pipeline.execute.${config.id}`, {
      kind: SpanKind.INTERNAL,
      attributes: {
        'pipeline.id': config.id,
        'pipeline.stepCount': config.steps.length,
        'input.length': input.length,
      },
    });

    const pipelineAnnotation = annotateSpan({
      runId,
      conversationId: options.conversationId,
      workflowId: contextManager.getFullContext().metadata.workflowId as string | undefined,
    });
    yield* Effect.fork(pipelineAnnotation.pipe(Effect.ignore));

    const pipelineData: PipelineHookEventData = {
      pipelineId: config.id,
      input,
      context: contextManager.getFullContext(),
    };

    try {
      if (hookManager) {
        const pipelineCorrelationCtx = getCurrentCorrelationContext();
        const pipelineSpanIds = getCurrentSpanIds();
        const beforeEvent: HookEvent = {
          type: 'beforePipeline',
          data: pipelineData,
          runId: runId || pipelineCorrelationCtx?.runId,
          conversationId: options.conversationId || pipelineCorrelationCtx?.conversationId,
          intentId: pipelineCorrelationCtx?.intentId,
          timestamp: new Date().toISOString(),
          traceId: pipelineSpanIds.traceId || pipelineCorrelationCtx?.traceId,
          spanId: pipelineSpanIds.spanId || pipelineCorrelationCtx?.spanId,
          parentSpanId: pipelineSpanIds.parentSpanId || pipelineCorrelationCtx?.parentSpanId,
          pipelineId: config.id,
        };
        const beforeResult = yield* runAsync(() => hookManager.executeHooksAndMerge('beforePipeline', beforeEvent));

        if (beforeResult.metadata) {
          contextManager.mergeMetadata(beforeResult.metadata);
        }

        if (beforeResult.abort) {
          pipelineSpan?.setStatus('ok');
          pipelineSpan?.end();
          return {
            success: false,
            status: 'aborted',
            context: contextManager.getFullContext(),
            abortedBy: 'beforePipeline hook',
            runId,
          };
        }
      }

      if (config.hooks?.beforePipeline) {
        for (const handler of config.hooks.beforePipeline) {
          const result = yield* runAsync(() => handler({ type: 'beforePipeline', data: pipelineData }));
          if (result?.abort) {
            pipelineSpan?.setStatus('ok');
            pipelineSpan?.end();
            return {
              success: false,
              status: 'aborted',
              context: contextManager.getFullContext(),
              abortedBy: 'pipeline beforePipeline hook',
              runId,
            };
          }
        }
      }

      let finalOutput: unknown;
      for (let i = 0; i < config.steps.length; i++) {
        if (i < startStep) {
          continue;
        }

        currentStep = i;
        const step = config.steps[i];
        const { result, skipped, aborted, abortReason, paused } = yield* executeStepWithHooks(
          step,
          i,
          contextManager,
          config,
          options,
          runId
        );

        if (aborted) {
          pipelineSpan?.setStatus('ok');
          pipelineSpan?.end();
          return {
            success: false,
            status: 'aborted',
            context: contextManager.getFullContext(),
            abortedBy: abortReason,
            runId,
          };
        }

        if (paused) {
          if (checkpointManager) {
            yield* Effect.tryPromise({
              try: () => checkpointManager.saveCheckpoint({
                runId,
                pipelineId: config.id,
                step: i,
                stepName: step.name,
                status: 'paused',
                context: contextManager.getFullContext(),
                expiresAt: paused.ttlMs
                  ? new Date(Date.now() + paused.ttlMs)
                  : undefined,
                pauseMetadata: paused.metadata,
              }),
              catch: (error) => {
                console.warn('[Checkpoint] Failed to save pause checkpoint:', error);
                return toError(error);
              },
            }).pipe(Effect.ignore);
          }

          pipelineSpan?.setStatus('ok');
          pipelineSpan?.end();
          return {
            success: false,
            status: 'paused',
            context: contextManager.getFullContext(),
            runId,
            pauseRequest: {
              prompt: paused.signal.prompt,
              choices: paused.signal.choices,
              schema: paused.signal.schema,
              metadata: paused.signal.metadata,
            },
          };
        }

        if (!skipped) {
          finalOutput = result;
        }

        if (checkpointEnabled && !skipped && !aborted) {
          yield* Effect.tryPromise({
            try: () => checkpointManager!.saveCheckpoint({
              runId,
              pipelineId: config.id,
              step: i,
              stepName: step.name,
              status: 'in_progress',
              context: contextManager.getFullContext(),
              expiresAt: checkpointTtlMs
                ? new Date(Date.now() + checkpointTtlMs)
                : undefined,
            }),
            catch: (error) => {
              console.warn(`[Checkpoint] Failed to save checkpoint for run ${runId} at step ${i}:`, error);
              return toError(error);
            },
          }).pipe(Effect.ignore);
        }
      }

      if (hookManager) {
        const afterData = { ...pipelineData, context: contextManager.getFullContext() };
        const afterPipelineSpanIds = getCurrentSpanIds();
        const afterPipelineCorrelationCtx = getCurrentCorrelationContext();
        const afterEvent: HookEvent = {
          type: 'afterPipeline',
          data: afterData,
          runId: runId || afterPipelineCorrelationCtx?.runId,
          conversationId: options.conversationId || afterPipelineCorrelationCtx?.conversationId,
          intentId: afterPipelineCorrelationCtx?.intentId,
          timestamp: new Date().toISOString(),
          traceId: afterPipelineSpanIds.traceId || afterPipelineCorrelationCtx?.traceId,
          spanId: afterPipelineSpanIds.spanId || afterPipelineCorrelationCtx?.spanId,
          parentSpanId: afterPipelineSpanIds.parentSpanId || afterPipelineCorrelationCtx?.parentSpanId,
          pipelineId: config.id,
        };
        yield* runAsync(() => hookManager.executeHooksAndMerge('afterPipeline', afterEvent));
      }

      if (config.hooks?.afterPipeline) {
        for (const handler of config.hooks.afterPipeline) {
          yield* runAsync(() => handler({
              type: 'afterPipeline',
              data: { ...pipelineData, context: contextManager.getFullContext() },
            }));
        }
      }

      pipelineSpan?.setStatus('ok');
      pipelineSpan?.end();

      return {
        success: true,
        status: 'completed',
        context: contextManager.getFullContext(),
        finalOutput,
        runId,
      };
    } catch (error) {
      const err = toError(error);

      if (hookManager) {
        const errorEvent: HookEvent = {
          type: 'onPipelineError',
          data: { ...pipelineData, error: err },
        };
        yield* Effect.tryPromise({
          try: () => hookManager.executeHooks('onPipelineError', errorEvent),
          catch: toError,
        }).pipe(Effect.ignore);
      }

      if (pipelineSpan) {
        attachErrorToSpan(pipelineSpan, err, {
          includeStack: false,
        });
        pipelineSpan.end();
      }

      if (config.failFast === false) {
        return {
          success: false,
          status: 'failed',
          context: contextManager.getFullContext(),
          error: err,
          runId,
        };
      }

      return yield* Effect.fail(new PipelineExecutionError({
        pipelineId: config.id,
        step: currentStep,
        cause: err,
      }));
    }
  }).pipe(
    Effect.map((result) => result as PipelineResult),
    Effect.mapError((error) => error instanceof PipelineExecutionError
      ? error
      : new PipelineExecutionError({
          pipelineId: config.id,
          step: currentStep,
          cause: error,
        }))
  );
}

export const ExecutorServiceLive = Layer.succeed(ExecutorService, {
  executePipelineV2: (config, input, options) => executePipelineV2Effect(config, input, options),
});

/**
 * @deprecated Use `ExecutorService.executePipelineV2` for Effect-native composition.
 */
export async function executePipelineV2(
  config: PipelineConfigV2,
  input: string,
  options: ExtendedExecutionOptions
): Promise<PipelineResult> {
  const fallbackContext = options.restoredContext ?? createPipelineContext({
    pipelineId: config.id,
    input,
    history: options.history as any,
    conversationId: options.conversationId,
  }).getFullContext();

  return new Promise((resolve, reject) => {
    Effect.runCallback(
      executePipelineV2Effect(config, input, options).pipe(
        Effect.catchTag('PipelineExecutionError', (error) =>
          Effect.succeed({
            success: false,
            status: 'failed' as const,
            context: fallbackContext,
            error: toError(error.cause),
            runId: options.runId,
          })
        )
      ),
      {
        onExit: (exit) => {
        if (Exit.isSuccess(exit)) {
          resolve(exit.value as PipelineResult);
          return;
        }
        reject(Cause.squash(exit.cause));
        },
      }
    );
  });
}
