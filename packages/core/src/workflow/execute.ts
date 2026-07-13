import { Clock, Context, Duration, Effect, Layer } from 'effect';
import type { AgentMessage, AgentResponse } from '../agent/agent';
import type { CheckpointManager } from '../pipeline/checkpoint/manager';
import type { PipelineContext } from '../pipeline/context';
import { detectPauseSignal, type DetectedPause } from '../pipeline/pause';
import { isHandoffSignal, type HandoffError, type HandoffSignal } from '../pipeline/handoff-tool';
import type { AgentManagerLike, HookManagerLike } from '../pipeline/executor';
import type { Tracer } from '../tracing';
import { SpanKind } from '../tracing';
import type { IRNode, WorkflowIR } from './ir';
import { findNode, inEdges, outEdges } from './ir';
import {
  WorkflowInputValidationError,
  WorkflowNodeExecutionError,
  WorkflowOutputValidationError,
} from './errors';
import { decodeWorkflowInput, validateWorkflowOutput } from './contracts';

export interface WorkflowExecutionOptions {
  readonly agentManager: AgentManagerLike;
  readonly hookManager?: HookManagerLike;
  readonly tracer?: Tracer;
  readonly pipelineManager?: {
    readonly getPipeline: (
      id: string,
    ) => { readonly execute: (message: string) => Promise<AgentResponse> } | undefined;
  };
  readonly workflowResolver?: (
    workflowId: string,
    input: unknown,
  ) => Effect.Effect<unknown, unknown>;
  readonly checkpointManager?: CheckpointManager;
  readonly conversationId?: string;
  readonly history?: AgentMessage[];
  readonly runId?: string;
  readonly startStep?: number;
  readonly restoredContext?: PipelineContext;
  readonly sequentialVisibility?: boolean;
}

export interface WorkflowExecutionResult {
  readonly success: boolean;
  readonly status: 'completed' | 'failed' | 'paused' | 'aborted';
  readonly context: PipelineContext;
  readonly outputs: Record<string, unknown>;
  readonly executedNodes: string[];
  readonly finalOutput?: unknown;
  readonly error?: Error;
  readonly failedNodeId?: string;
  readonly abortedBy?: string;
  readonly runId: string;
  readonly pauseRequest?: {
    readonly prompt: string;
    readonly choices?: string[];
    readonly schema?: Record<string, unknown>;
    readonly metadata?: Record<string, unknown>;
  };
}

export interface WorkflowExecutorService {
  readonly execute: (
    workflow: WorkflowIR,
    input: unknown,
    options: WorkflowExecutionOptions,
  ) => Effect.Effect<
    WorkflowExecutionResult,
    WorkflowInputValidationError | WorkflowOutputValidationError
  >;
}

export const WorkflowExecutorService =
  Context.GenericTag<WorkflowExecutorService>('WorkflowExecutorService');

interface NodeExecution {
  readonly node: IRNode;
  readonly result: unknown;
  readonly skipped: boolean;
  readonly abortedBy?: string;
  readonly pause?: DetectedPause;
}

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function nodeFailure(
  workflowId: string,
  nodeId: string,
  cause: unknown,
  retryable = false,
): WorkflowNodeExecutionError {
  const error = toError(cause);
  return new WorkflowNodeExecutionError({
    workflowId,
    nodeId,
    message: error.message,
    cause,
    retryable,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Return conversational content from an agent response, when one is present. */
export function agentResponseContent(value: unknown): string | undefined {
  return isRecord(value) && typeof value.content === 'string' ? value.content : undefined;
}

/** Convert structured workflow input only when it crosses a conversational string boundary. */
export function workflowInputToMessage(input: unknown): string {
  if (typeof input === 'string') return input;
  try {
    const serialized = JSON.stringify(input);
    return serialized ?? String(input);
  } catch {
    return String(input);
  }
}

function messageForNode(
  workflow: WorkflowIR,
  node: IRNode,
  input: unknown,
  runtimeOutputs: Readonly<Record<string, unknown>>,
): string {
  if (workflow.source !== 'native') return workflowInputToMessage(input);

  const predecessors = inEdges(workflow, node.id)
    .map((edge) => edge.from)
    .filter((source) => source in runtimeOutputs);
  if (predecessors.length === 0) return workflowInputToMessage(input);

  if (predecessors.length > 1) {
    return workflowInputToMessage(Object.fromEntries(
      predecessors.map((source) => {
        const output = runtimeOutputs[source];
        return [source, agentResponseContent(output) ?? output];
      }),
    ));
  }

  const predecessorOutput = runtimeOutputs[predecessors[0]!];
  return agentResponseContent(predecessorOutput) ?? workflowInputToMessage(predecessorOutput);
}

export function getPublicWorkflowOutputs(
  workflow: WorkflowIR,
  outputs: Record<string, unknown>,
): Record<string, unknown> {
  const visible: Record<string, unknown> = {};
  for (const node of workflow.nodes) {
    if (!node.internal && node.recordOutput !== false && node.id in outputs) {
      visible[node.id] = outputs[node.id];
    }
  }
  return visible;
}

function readPath(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split('.')) {
    if (!isRecord(current) || !(part in current)) return undefined;
    current = current[part];
  }
  return current;
}

function evaluateBranch(
  guard: Extract<NonNullable<WorkflowIR['edges'][number]['when']>, { readonly type: 'branch' }>,
  context: PipelineContext,
): boolean {
  const value = readPath(context.outputs, guard.condition.field);
  switch (guard.condition.operator) {
    case 'exists':
      return value !== undefined && value !== null;
    case 'equals':
      return value === guard.condition.value;
    case 'notEquals':
      return value !== guard.condition.value;
    case 'gt':
      return (
        typeof value === 'number' &&
        typeof guard.condition.value === 'number' &&
        value > guard.condition.value
      );
    case 'lt':
      return (
        typeof value === 'number' &&
        typeof guard.condition.value === 'number' &&
        value < guard.condition.value
      );
  }
}

const selectNextNodes = Effect.fn('WorkflowExecutor.selectNextNodes')(function* (
  workflow: WorkflowIR,
  nodeId: string,
  context: PipelineContext,
) {
  const outgoing = outEdges(workflow, nodeId);
  for (const edge of outgoing) {
    if (!edge.when) continue;
    const guard = edge.when;
    const matched =
      guard.type === 'branch'
        ? evaluateBranch(guard, context)
        : yield* Effect.tryPromise({
            try: () => Promise.resolve(guard.predicate(context)),
            catch: (cause) => nodeFailure(workflow.id, nodeId, cause),
          });
    if (matched) return [edge.to];
  }
  const fallback = outgoing.find((edge) => edge.default);
  if (fallback) return [fallback.to];
  return outgoing.filter((edge) => !edge.when && !edge.default).map((edge) => edge.to);
});

const executeHandoff = Effect.fn('WorkflowExecutor.executeHandoff')(function* (
  signal: HandoffSignal,
  sourceAgentId: string,
  workflow: WorkflowIR,
  context: PipelineContext,
  options: WorkflowExecutionOptions,
): Effect.fn.Return<AgentResponse | HandoffError, WorkflowNodeExecutionError> {
  const allowedTargets = workflow.handoffs?.[sourceAgentId] ?? [];
  if (!allowedTargets.includes(signal.targetAgent)) {
    return {
      type: 'handoff_error',
      error: `Handoff to '${signal.targetAgent}' not allowed. Available: ${allowedTargets.join(', ')}`,
      availableTargets: [...allowedTargets],
    };
  }

  const target = options.agentManager.getAgent(signal.targetAgent);
  if (!target) {
    return yield* nodeFailure(
      workflow.id,
      sourceAgentId,
      new Error(`Target agent "${signal.targetAgent}" not found for handoff`),
      true,
    );
  }

  const chain = Array.isArray(context.metadata.handoffChain)
    ? context.metadata.handoffChain.filter((item): item is string => typeof item === 'string')
    : [];
  Object.assign(context.metadata, {
    handoffFrom: sourceAgentId,
    handoffTo: signal.targetAgent,
    handoffReason: signal.reason,
    handoffChain: [...chain, sourceAgentId],
  });

  const result = yield* target.processMessage(workflowInputToMessage(context.input), context.history, {
    workflowId: workflow.id,
    sessionId: context.conversationId,
  }).pipe(
    Effect.mapError((cause) => nodeFailure(workflow.id, sourceAgentId, cause, true)),
  );
  if (isHandoffSignal(result)) {
    return yield* executeHandoff(
      result,
      signal.targetAgent,
      workflow,
      context,
      options,
    );
  }
  return result;
});

function runNodeBody(
  workflow: WorkflowIR,
  node: IRNode,
  context: PipelineContext,
  options: WorkflowExecutionOptions,
  message: string,
): Effect.Effect<unknown, WorkflowNodeExecutionError> {
  switch (node.kind) {
    case 'agent': {
      const agent = options.agentManager.getAgent(node.agentId);
      if (!agent) {
        return nodeFailure(
          workflow.id,
          node.id,
          new Error(`Agent "${node.agentId}" not found`),
          true,
        );
      }
      return agent.processMessage(message, context.history, {
        workflowId: workflow.id,
        sessionId: context.conversationId,
      }).pipe(
        Effect.mapError((cause) => nodeFailure(workflow.id, node.id, cause, true)),
        Effect.flatMap((result) =>
          isHandoffSignal(result)
            ? executeHandoff(result, node.agentId, workflow, context, options)
            : Effect.succeed(result),
        ),
      );
    }
    case 'function':
      return Effect.tryPromise({
        try: () => Promise.resolve(node.fn(context)),
        catch: (cause) => nodeFailure(workflow.id, node.id, cause, true),
      });
    case 'subworkflow': {
      const resolved = options.workflowResolver?.(node.workflowId, context.input);
      if (resolved) {
        return resolved.pipe(
          Effect.mapError((cause) => nodeFailure(workflow.id, node.id, cause, true)),
        );
      }
      const nested = options.pipelineManager?.getPipeline(node.workflowId);
      if (!nested) {
        return nodeFailure(
          workflow.id,
          node.id,
          new Error(`Nested pipeline "${node.workflowId}" not found`),
          true,
        );
      }
      return Effect.tryPromise({
        try: () => nested.execute(workflowInputToMessage(context.input)),
        catch: (cause) => nodeFailure(workflow.id, node.id, cause, true),
      });
    }
  }
}

function nodeBodyContext(
  workflow: WorkflowIR,
  base: PipelineContext,
  runtimeOutputs: Record<string, unknown>,
  node: IRNode,
): PipelineContext {
  const needsRuntimeOutputs = node.role === 'condition-result' || node.role === 'join';
  const outputs = needsRuntimeOutputs
    ? { ...runtimeOutputs }
    : getPublicWorkflowOutputs(workflow, runtimeOutputs);
  if (node.contextView === 'isolated') {
    return { ...base, outputs: {}, history: [] };
  }
  return { ...base, outputs };
}

function stepHookContext(
  workflow: WorkflowIR,
  base: PipelineContext,
  runtimeOutputs: Record<string, unknown>,
  node: IRNode,
): PipelineContext {
  if (node.contextView === 'isolated') {
    return { ...base, outputs: {}, history: [] };
  }
  return { ...base, outputs: getPublicWorkflowOutputs(workflow, runtimeOutputs) };
}

function stepDataForNode(workflow: WorkflowIR, context: PipelineContext, node: IRNode) {
  const step = node.sourceStep ?? {
    name: node.name ?? node.id,
    type: node.role ?? node.kind,
    index: node.sourceIndex ?? 0,
  };
  return {
    pipelineId: workflow.id,
    input: context.input,
    context,
    step,
  };
}

function runsBeforeHooks(node: IRNode): boolean {
  return node.hookPolicy === undefined || node.hookPolicy === 'all' || node.hookPolicy === 'before';
}

function runsAfterHooks(node: IRNode): boolean {
  return node.hookPolicy === undefined || node.hookPolicy === 'all' || node.hookPolicy === 'after';
}

function runsErrorHooks(node: IRNode): boolean {
  return node.hookPolicy === undefined || node.hookPolicy === 'all';
}

const executeStepErrorHooks = Effect.fn('WorkflowExecutor.executeStepErrorHooks')(function* (
  workflow: WorkflowIR,
  node: IRNode,
  context: PipelineContext,
  options: WorkflowExecutionOptions,
  runId: string,
  failure: WorkflowNodeExecutionError,
  retryCount: number,
) {
  const stepData = stepDataForNode(workflow, context, node);
  const stepName = stepData.step.name;
  const hookManager = options.hookManager;
  if (hookManager) {
    const hookResult = yield* Effect.tryPromise({
      try: () => hookManager.executeHooksAndMerge('onStepError', {
        type: 'onStepError',
        data: { ...stepData, error: toError(failure.cause), retryCount },
        runId,
        conversationId: context.conversationId,
        pipelineId: workflow.id,
        stepName,
      }),
      catch: (cause) => nodeFailure(workflow.id, node.id, cause),
    });
    if (hookResult.abort) return 'onStepError hook';
  }
  for (const handler of workflow.hooks?.onStepError ?? []) {
    const hookResult = yield* Effect.tryPromise({
      try: () => Promise.resolve(handler({
        type: 'onStepError',
        data: { ...stepData, error: toError(failure.cause), retryCount },
      })),
      catch: (cause) => nodeFailure(workflow.id, node.id, cause),
    });
    if (hookResult?.abort) return 'pipeline onStepError hook';
  }
  return undefined;
});

const executeNode = Effect.fn('WorkflowExecutor.executeNode')(function* (
  workflow: WorkflowIR,
  node: IRNode,
  baseContext: PipelineContext,
  runtimeOutputs: Record<string, unknown>,
  options: WorkflowExecutionOptions,
  message: string,
  runId: string,
  skipBeforeHooks = false,
) {
  const hookContext = stepHookContext(workflow, baseContext, runtimeOutputs, node);
  const bodyContext = nodeBodyContext(workflow, baseContext, runtimeOutputs, node);
  const stepData = stepDataForNode(workflow, hookContext, node);
  const stepName = stepData.step.name;

  const hookManager = options.hookManager;
  if (!skipBeforeHooks && runsBeforeHooks(node) && hookManager) {
    const before = yield* Effect.tryPromise({
      try: () => hookManager.executeHooksAndMerge('beforeStep', {
        type: 'beforeStep',
        data: stepData,
        runId,
        conversationId: hookContext.conversationId,
        pipelineId: workflow.id,
        stepName,
      }),
      catch: (cause) => nodeFailure(workflow.id, node.id, cause),
    });
    if (isRecord(before.metadata)) {
      baseContext.metadata = { ...baseContext.metadata, ...before.metadata };
    }
    if (before.skip) return { node, result: undefined, skipped: true } satisfies NodeExecution;
    if (before.abort) {
      return { node, result: undefined, skipped: false, abortedBy: 'beforeStep hook' } satisfies NodeExecution;
    }
  }

  for (const handler of !skipBeforeHooks && runsBeforeHooks(node)
    ? workflow.hooks?.beforeStep ?? []
    : []) {
    const result = yield* Effect.tryPromise({
      try: () => Promise.resolve(handler({ type: 'beforeStep', data: stepData })),
      catch: (cause) => nodeFailure(workflow.id, node.id, cause),
    });
    if (result?.skip) return { node, result: undefined, skipped: true } satisfies NodeExecution;
    if (result?.abort) {
      return {
        node,
        result: undefined,
        skipped: false,
        abortedBy: 'pipeline beforeStep hook',
      } satisfies NodeExecution;
    }
  }

  const span = options.tracer?.startSpan(
    workflow.source === 'graph'
      ? `graph.node.${node.id}`
      : `pipeline.step.${stepName}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'pipeline.id': workflow.id,
        ...(workflow.source === 'graph' ? { 'graph.id': workflow.id } : {}),
        'node.id': node.id,
        'step.name': stepName,
        'step.type': stepData.step.type,
        'step.index': stepData.step.index,
      },
    },
  );

  const maxRetries = node.retry?.maxRetries ?? 0;
  const backoffMs = node.retry?.backoffMs ?? 100;
  const maxBackoffMs = node.retry?.maxBackoffMs ?? 10_000;
  let result: unknown;
  let failure: WorkflowNodeExecutionError | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      span?.addEvent(`retry.attempt.${attempt}`, {
        'retry.attempt': attempt,
        'retry.maxRetries': maxRetries,
      });
    }
    const exit = yield* Effect.either(
      runNodeBody(workflow, node, bodyContext, options, message),
    );
    if (exit._tag === 'Right') {
      result = exit.right;
      failure = undefined;
      break;
    }
    const currentFailure = exit.left;
    failure = currentFailure;
    if (runsErrorHooks(node)) {
      const abortedBy = yield* executeStepErrorHooks(
        workflow,
        node,
        hookContext,
        options,
        runId,
        currentFailure,
        attempt,
      );
      if (abortedBy) {
        span?.end();
        return {
          node,
          result: undefined,
          skipped: false,
          abortedBy,
        } satisfies NodeExecution;
      }
    }
    if (attempt < maxRetries) {
      yield* Effect.sleep(Duration.millis(Math.min(backoffMs * 2 ** attempt, maxBackoffMs)));
    }
  }
  if (failure) {
    span?.setStatus('error', failure.message);
    span?.end();
    return yield* failure;
  }

  const pause = detectPauseSignal(result);
  if (pause) {
    span?.setStatus('ok');
    span?.end();
    return { node, result, skipped: false, pause } satisfies NodeExecution;
  }

  // The legacy lifecycle records a step's output before afterStep hooks run.
  // Preserve that ordering while exposing only source-level outputs to hooks.
  if (node.recordOutput !== false) runtimeOutputs[node.id] = result;
  baseContext.outputs = getPublicWorkflowOutputs(workflow, runtimeOutputs);
  const afterHookContext = stepHookContext(workflow, baseContext, runtimeOutputs, node);
  const afterStepData = stepDataForNode(workflow, afterHookContext, node);

  if (runsAfterHooks(node) && hookManager) {
    const after = yield* Effect.tryPromise({
      try: () => hookManager.executeHooksAndMerge('afterStep', {
        type: 'afterStep',
        data: { ...afterStepData, result },
        runId,
        conversationId: afterHookContext.conversationId,
        pipelineId: workflow.id,
        stepName,
      }),
      catch: (cause) => nodeFailure(workflow.id, node.id, cause),
    });
    if (isRecord(after.metadata)) {
      baseContext.metadata = { ...baseContext.metadata, ...after.metadata };
    }
    if (after.abort) {
      span?.end();
      return { node, result, skipped: false, abortedBy: 'afterStep hook' } satisfies NodeExecution;
    }
  }

  for (const handler of runsAfterHooks(node) ? workflow.hooks?.afterStep ?? [] : []) {
    const after = yield* Effect.tryPromise({
      try: () => Promise.resolve(handler({
        type: 'afterStep',
        data: { ...afterStepData, result },
      })),
      catch: (cause) => nodeFailure(workflow.id, node.id, cause),
    });
    if (after?.abort) {
      span?.end();
      return {
        node,
        result,
        skipped: false,
        abortedBy: 'pipeline afterStep hook',
      } satisfies NodeExecution;
    }
  }

  span?.setStatus('ok');
  span?.end();
  return { node, result, skipped: false } satisfies NodeExecution;
});

function isReady(node: IRNode, completed: Set<string>): boolean {
  if (node.join?.type !== 'all') return true;
  return node.join.sources.every((source) => completed.has(source));
}

const saveCheckpoint = Effect.fn('WorkflowExecutor.saveCheckpoint')(function* (
  workflow: WorkflowIR,
  node: IRNode,
  context: PipelineContext,
  runtimeOutputs: Record<string, unknown>,
  options: WorkflowExecutionOptions,
  runId: string,
  status: 'in_progress' | 'paused',
  pause?: DetectedPause,
) {
  const checkpointManager = options.checkpointManager;
  const sourceIndex = node.sourceIndex;
  if (!checkpointManager || sourceIndex === undefined) return;
  const now = yield* Clock.currentTimeMillis;
  const ttl = pause?.ttlMs ?? workflow.checkpoint?.ttlMs;
  yield* Effect.tryPromise({
    try: () => checkpointManager.saveCheckpoint({
      runId,
      pipelineId: workflow.id,
      step: sourceIndex,
      stepName: node.name ?? node.id,
      status,
      context: { ...context, outputs: { ...runtimeOutputs } },
      expiresAt: ttl ? new Date(now + ttl) : undefined,
      pauseMetadata: pause?.metadata,
    }),
    catch: (cause) => nodeFailure(workflow.id, node.id, cause),
  }).pipe(Effect.ignore);
});

export const executeWorkflowEffect = Effect.fn('WorkflowExecutor.execute')(function* (
  workflow: WorkflowIR,
  input: unknown,
  options: WorkflowExecutionOptions,
) {
  const decodedInput = yield* decodeWorkflowInput(workflow, input);
  const runId = options.runId ?? options.checkpointManager?.generateRunId() ?? crypto.randomUUID();
  const restored = options.restoredContext;
  const restoredOutputs = { ...(restored?.outputs ?? {}) };
  const context: PipelineContext = restored
    ? {
        ...restored,
        outputs: getPublicWorkflowOutputs(workflow, restoredOutputs),
        history: [...restored.history],
        metadata: { ...restored.metadata },
        conversationId: options.conversationId ?? restored.conversationId,
      }
    : {
        pipelineId: workflow.id,
        input: decodedInput,
        outputs: {},
        history: [...(options.history ?? [])],
        metadata: {},
        conversationId: options.conversationId,
      };
  const runtimeOutputs: Record<string, unknown> = restoredOutputs;
  const executedNodes: string[] = [];
  const completed = new Set<string>();
  const scheduled = new Set<string>();
  const startStep = options.startStep ?? 0;
  if (workflow.source === 'v2' && startStep > 0) {
    for (const node of workflow.nodes) {
      if (node.sourceIndex !== undefined && node.sourceIndex < startStep) {
        completed.add(node.id);
        scheduled.add(node.id);
      }
    }
  }
  let ready = workflow.source === 'v2' && startStep > 0
    ? workflow.nodes
        .filter((node) => node.sourceIndex === startStep)
        .filter((node) => inEdges(workflow, node.id).every((edge) => completed.has(edge.from)))
        .map((node) => node.id)
    : [workflow.entry];
  let finalOutput: unknown;
  const retryAttempts = new Map<string, number>();

  const workflowSpan = options.tracer?.startSpan(
    workflow.source === 'graph'
      ? `graph.execute.${workflow.id}`
      : `pipeline.execute.${workflow.id}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'pipeline.id': workflow.id,
        ...(workflow.source === 'graph'
          ? {
              'graph.id': workflow.id,
              'graph.nodeCount': workflow.nodes.length,
              'graph.edgeCount': workflow.edges.length,
            }
          : {}),
        'workflow.nodeCount': workflow.nodes.length,
      },
    },
  );

  const execution = Effect.gen(function* () {
    const pipelineData = { pipelineId: workflow.id, input: context.input, context };
    const hookManager = options.hookManager;
    if (hookManager) {
      const before = yield* Effect.tryPromise({
        try: () => hookManager.executeHooksAndMerge('beforePipeline', {
          type: 'beforePipeline',
          data: pipelineData,
          runId,
          conversationId: context.conversationId,
          pipelineId: workflow.id,
        }),
        catch: (cause) => nodeFailure(workflow.id, workflow.entry, cause),
      });
      if (isRecord(before.metadata)) context.metadata = { ...context.metadata, ...before.metadata };
      if (before.abort) {
        workflowSpan?.setStatus('ok');
        workflowSpan?.end();
        return {
          success: false,
          status: 'aborted',
          context: { ...context, outputs: getPublicWorkflowOutputs(workflow, runtimeOutputs) },
          outputs: getPublicWorkflowOutputs(workflow, runtimeOutputs),
          executedNodes,
          abortedBy: 'beforePipeline hook',
          runId,
        } satisfies WorkflowExecutionResult;
      }
    }
    for (const handler of workflow.hooks?.beforePipeline ?? []) {
      const before = yield* Effect.tryPromise({
        try: () => Promise.resolve(handler({ type: 'beforePipeline', data: pipelineData })),
        catch: (cause) => nodeFailure(workflow.id, workflow.entry, cause),
      });
      if (before?.abort) {
        workflowSpan?.setStatus('ok');
        workflowSpan?.end();
        return {
          success: false,
          status: 'aborted',
          context: { ...context, outputs: getPublicWorkflowOutputs(workflow, runtimeOutputs) },
          outputs: getPublicWorkflowOutputs(workflow, runtimeOutputs),
          executedNodes,
          abortedBy: 'pipeline beforePipeline hook',
          runId,
        } satisfies WorkflowExecutionResult;
      }
    }

    workflowLoop: while (ready.length > 0) {
      const batchIds = [...new Set(ready)];
      ready = [];
      const batchNodes = batchIds
        .filter((nodeId) => !scheduled.has(nodeId))
        .map((nodeId) => findNode(workflow, nodeId))
        .filter((node): node is IRNode => node !== undefined)
        .filter((node) => isReady(node, completed))
        .filter((node) => node.sourceIndex === undefined || node.sourceIndex >= startStep);
      for (const node of batchNodes) scheduled.add(node.id);
      if (batchNodes.length === 0) continue;

      const executions = yield* Effect.forEach(
        batchNodes,
        (node) => {
          if (node.role === 'fork') {
            const branches = outEdges(workflow, node.id).map((edge) => edge.to);
            workflowSpan?.addEvent('graph.fork', {
              'fork.nodeId': node.id,
              'fork.branches': branches.join(','),
              'fork.branchCount': branches.length,
            });
          }
          if (node.role === 'join' && node.join?.type === 'all') {
            workflowSpan?.addEvent('graph.join', {
              'join.nodeId': node.id,
              'join.sources': node.join.sources.join(','),
              'join.sourceCount': node.join.sources.length,
              'join.strategy': node.join.merge,
            });
          }
          const retryScope = workflow.retryScopes?.find((scope) => scope.nodeIds.includes(node.id));
          const skipBeforeHooks = retryScope?.entry === node.id &&
            (retryAttempts.get(retryScope.id) ?? 0) > 0;
          return Effect.either(executeNode(
            workflow,
            node,
            context,
            runtimeOutputs,
            options,
            messageForNode(workflow, node, context.input, runtimeOutputs),
            runId,
            skipBeforeHooks,
          )).pipe(Effect.map((outcome) => ({ node, outcome })));
        },
        { concurrency: 'unbounded' },
      );

      for (const nodeOutcome of executions) {
        const { node, outcome } = nodeOutcome;
        const retryScope = workflow.retryScopes?.find((scope) => scope.nodeIds.includes(node.id));
        if (outcome._tag === 'Left') {
          const failure = outcome.left;
          if (retryScope && failure.retryable === true) {
            const scopeEntry = findNode(workflow, retryScope.entry);
            if (scopeEntry) {
              const retryCount = retryAttempts.get(retryScope.id) ?? 0;
              const abortedBy = yield* executeStepErrorHooks(
                workflow,
                scopeEntry,
                stepHookContext(workflow, context, runtimeOutputs, scopeEntry),
                options,
                runId,
                failure,
                retryCount,
              );
              if (abortedBy) {
                workflowSpan?.setStatus('ok');
                workflowSpan?.end();
                const outputs = getPublicWorkflowOutputs(workflow, runtimeOutputs);
                return {
                  success: false,
                  status: 'aborted',
                  context: { ...context, outputs },
                  outputs,
                  executedNodes: [...executedNodes],
                  finalOutput,
                  abortedBy,
                  runId,
                } satisfies WorkflowExecutionResult;
              }

              const maxRetries = retryScope.retry?.maxRetries ?? 0;
              if (retryCount < maxRetries) {
                retryAttempts.set(retryScope.id, retryCount + 1);
                for (const nodeId of retryScope.nodeIds) {
                  delete runtimeOutputs[nodeId];
                  completed.delete(nodeId);
                  scheduled.delete(nodeId);
                }
                for (let index = executedNodes.length - 1; index >= 0; index--) {
                  if (retryScope.nodeIds.includes(executedNodes[index] ?? '')) {
                    executedNodes.splice(index, 1);
                  }
                }
                context.outputs = getPublicWorkflowOutputs(workflow, runtimeOutputs);
                const backoffMs = retryScope.retry?.backoffMs ?? 100;
                const maxBackoffMs = retryScope.retry?.maxBackoffMs ?? 10_000;
                yield* Effect.sleep(
                  Duration.millis(Math.min(backoffMs * 2 ** retryCount, maxBackoffMs)),
                );
                ready = [retryScope.entry];
                continue workflowLoop;
              }
            }
          }
          return yield* failure;
        }

        const execution = outcome.right;
        const { result } = execution;
        const nodeMessage = messageForNode(workflow, node, context.input, runtimeOutputs);
        if (execution.abortedBy) {
          workflowSpan?.setStatus('ok');
          workflowSpan?.end();
          const outputs = getPublicWorkflowOutputs(workflow, runtimeOutputs);
          return {
            success: false,
            status: 'aborted',
            context: { ...context, outputs },
            outputs,
            executedNodes,
            finalOutput,
            abortedBy: execution.abortedBy,
            runId,
          } satisfies WorkflowExecutionResult;
        }

        if (!execution.skipped || workflow.source === 'graph') {
          if (node.recordOutput !== false) runtimeOutputs[node.id] = result;
          executedNodes.push(node.id);
          completed.add(node.id);
          if (!node.internal && node.recordOutput !== false && !execution.skipped) finalOutput = result;
        } else {
          completed.add(node.id);
        }

        if (workflow.source === 'native' && node.kind === 'agent' && !execution.skipped) {
          const content = agentResponseContent(result);
          context.history.push({ role: 'user', content: nodeMessage });
          if (content !== undefined) context.history.push({ role: 'assistant', content });
        }

        if (execution.skipped && retryScope?.entry === node.id) {
          for (const nodeId of retryScope.nodeIds) {
            completed.add(nodeId);
            scheduled.add(nodeId);
          }
          const runtimeContext = { ...context, outputs: { ...runtimeOutputs } };
          const next = yield* selectNextNodes(workflow, retryScope.exit, runtimeContext);
          for (const nextId of next) {
            if (!scheduled.has(nextId)) ready.push(nextId);
          }
          continue;
        }

        context.outputs = getPublicWorkflowOutputs(workflow, runtimeOutputs);

        if (execution.pause) {
          yield* saveCheckpoint(
            workflow,
            node,
            context,
            runtimeOutputs,
            options,
            runId,
            'paused',
            execution.pause,
          );
          workflowSpan?.setStatus('ok');
          workflowSpan?.end();
          return {
            success: false,
            status: 'paused',
            context,
            outputs: context.outputs,
            executedNodes,
            finalOutput,
            runId,
            pauseRequest: {
              prompt: execution.pause.signal.prompt,
              choices: execution.pause.signal.choices,
              schema: execution.pause.signal.schema,
              metadata: execution.pause.signal.metadata,
            },
          } satisfies WorkflowExecutionResult;
        }

        if (
          workflow.source === 'v2' &&
          workflow.checkpoint?.enabled !== false &&
          !execution.skipped &&
          !node.internal
        ) {
          yield* saveCheckpoint(
            workflow,
            node,
            context,
            runtimeOutputs,
            options,
            runId,
            'in_progress',
          );
        }

        const runtimeContext = { ...context, outputs: { ...runtimeOutputs } };
        const next = yield* selectNextNodes(workflow, node.id, runtimeContext);
        const outgoing = outEdges(workflow, node.id);
        if (outgoing.some((edge) => edge.when)) {
          workflowSpan?.addEvent('graph.branch_decision', {
            'branch.sourceNode': node.id,
            'branch.takenNodes': next.join(','),
          });
        }
        for (const nextId of next) {
          const nextNode = findNode(workflow, nextId);
          if (nextNode && !scheduled.has(nextId) && isReady(nextNode, completed)) ready.push(nextId);
        }
        for (const candidate of workflow.nodes) {
          if (
            candidate.join?.type === 'all' &&
            !scheduled.has(candidate.id) &&
            isReady(candidate, completed)
          ) {
            ready.push(candidate.id);
          }
        }
        if (retryScope?.exit === node.id) retryAttempts.delete(retryScope.id);
      }
    }

    if (hookManager) {
      yield* Effect.tryPromise({
        try: () => hookManager.executeHooksAndMerge('afterPipeline', {
          type: 'afterPipeline',
          data: { ...pipelineData, context },
          runId,
          conversationId: context.conversationId,
          pipelineId: workflow.id,
        }),
        catch: (cause) => nodeFailure(workflow.id, workflow.entry, cause),
      });
    }
    for (const handler of workflow.hooks?.afterPipeline ?? []) {
      yield* Effect.tryPromise({
        try: () => Promise.resolve(handler({
          type: 'afterPipeline',
          data: { ...pipelineData, context },
        })),
        catch: (cause) => nodeFailure(workflow.id, workflow.entry, cause),
      });
    }

    const validatedFinalOutput = yield* validateWorkflowOutput(workflow, finalOutput).pipe(
      Effect.tapError((error) => Effect.sync(() => {
        workflowSpan?.setStatus('error', error.message);
        workflowSpan?.end();
      })),
    );
    workflowSpan?.setStatus('ok');
    workflowSpan?.end();
    return {
      success: true,
      status: 'completed',
      context,
      outputs: context.outputs,
      executedNodes,
      finalOutput: validatedFinalOutput,
      runId,
    } satisfies WorkflowExecutionResult;
  });

  return yield* execution.pipe(
    Effect.catchTag('WorkflowNodeExecutionError', (failure) => {
      workflowSpan?.setStatus('error', failure.message);
      workflowSpan?.end();
      const outputs = getPublicWorkflowOutputs(workflow, runtimeOutputs);
      context.outputs = outputs;
      return Effect.succeed({
        success: false,
        status: 'failed',
        context: { ...context, outputs },
        outputs,
        executedNodes: [...executedNodes],
        finalOutput,
        error: toError(failure.cause),
        failedNodeId: failure.nodeId,
        runId,
      } satisfies WorkflowExecutionResult);
    }),
  );
});

export const WorkflowExecutorServiceLive = Layer.succeed(WorkflowExecutorService, {
  execute: executeWorkflowEffect,
});
