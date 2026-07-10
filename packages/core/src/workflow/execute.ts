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
import { WorkflowNodeExecutionError } from './errors';

export interface WorkflowExecutionOptions {
  readonly agentManager: AgentManagerLike;
  readonly hookManager?: HookManagerLike;
  readonly tracer?: Tracer;
  readonly pipelineManager?: {
    readonly getPipeline: (
      id: string,
    ) => { readonly execute: (message: string) => Promise<AgentResponse> } | undefined;
  };
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
  readonly finalResponse?: AgentResponse;
  readonly error?: Error;
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
    input: string,
    options: WorkflowExecutionOptions,
  ) => Effect.Effect<WorkflowExecutionResult, WorkflowNodeExecutionError>;
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

function nodeFailure(workflowId: string, nodeId: string, cause: unknown): WorkflowNodeExecutionError {
  const error = toError(cause);
  return new WorkflowNodeExecutionError({
    workflowId,
    nodeId,
    message: error.message,
    cause,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function agentResponseContent(value: unknown): string | undefined {
  return isRecord(value) && typeof value.content === 'string' ? value.content : undefined;
}

function publicOutputs(workflow: WorkflowIR, outputs: Record<string, unknown>): Record<string, unknown> {
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

  const result = yield* target.processMessage(context.input, context.history).pipe(
    Effect.mapError((cause) => nodeFailure(workflow.id, sourceAgentId, cause)),
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
        return nodeFailure(workflow.id, node.id, new Error(`Agent "${node.agentId}" not found`));
      }
      const history = workflow.source === 'v1' && options.sequentialVisibility === false
        ? []
        : context.history;
      return agent.processMessage(message, history).pipe(
        Effect.mapError((cause) => nodeFailure(workflow.id, node.id, cause)),
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
        catch: (cause) => nodeFailure(workflow.id, node.id, cause),
      });
    case 'subworkflow': {
      const nested = options.pipelineManager?.getPipeline(node.workflowId);
      if (!nested) {
        return nodeFailure(
          workflow.id,
          node.id,
          new Error(`Nested pipeline "${node.workflowId}" not found`),
        );
      }
      return Effect.tryPromise({
        try: () => nested.execute(context.input),
        catch: (cause) => nodeFailure(workflow.id, node.id, cause),
      });
    }
  }
}

function hookContext(
  workflow: WorkflowIR,
  base: PipelineContext,
  runtimeOutputs: Record<string, unknown>,
  node: IRNode,
): PipelineContext {
  const needsRuntimeOutputs = node.role === 'condition-result' || node.role === 'join';
  const outputs = needsRuntimeOutputs
    ? { ...runtimeOutputs }
    : publicOutputs(workflow, runtimeOutputs);
  if (node.contextView === 'isolated') {
    return { ...base, outputs: {}, history: [] };
  }
  return { ...base, outputs };
}

const executeNode = Effect.fn('WorkflowExecutor.executeNode')(function* (
  workflow: WorkflowIR,
  node: IRNode,
  baseContext: PipelineContext,
  runtimeOutputs: Record<string, unknown>,
  options: WorkflowExecutionOptions,
  message: string,
  runId: string,
) {
  const context = hookContext(workflow, baseContext, runtimeOutputs, node);
  const stepData = {
    pipelineId: workflow.id,
    input: context.input,
    context,
    step: {
      name: node.name ?? node.id,
      type: node.role ?? node.kind,
      index: node.sourceIndex ?? 0,
    },
  };

  const hookManager = options.hookManager;
  if (hookManager) {
    const before = yield* Effect.tryPromise({
      try: () => hookManager.executeHooksAndMerge('beforeStep', {
        type: 'beforeStep',
        data: stepData,
        runId,
        conversationId: context.conversationId,
        pipelineId: workflow.id,
        stepName: node.name ?? node.id,
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

  for (const handler of workflow.hooks?.beforeStep ?? []) {
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
      : `pipeline.step.${node.name ?? node.id}`,
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'pipeline.id': workflow.id,
        ...(workflow.source === 'graph' ? { 'graph.id': workflow.id } : {}),
        'node.id': node.id,
        'step.name': node.name ?? node.id,
        'step.type': node.role ?? node.kind,
        'step.index': node.sourceIndex ?? 0,
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
    const exit = yield* Effect.either(runNodeBody(workflow, node, context, options, message));
    if (exit._tag === 'Right') {
      result = exit.right;
      failure = undefined;
      break;
    }
    const currentFailure = exit.left;
    failure = currentFailure;
    if (hookManager) {
      const hookResult = yield* Effect.tryPromise({
        try: () => hookManager.executeHooksAndMerge('onStepError', {
          type: 'onStepError',
          data: { ...stepData, error: toError(currentFailure.cause), retryCount: attempt },
          runId,
          pipelineId: workflow.id,
          stepName: node.name ?? node.id,
        }),
        catch: (cause) => nodeFailure(workflow.id, node.id, cause),
      });
      if (hookResult.abort) {
        span?.end();
        return {
          node,
          result: undefined,
          skipped: false,
          abortedBy: 'onStepError hook',
        } satisfies NodeExecution;
      }
    }
    for (const handler of workflow.hooks?.onStepError ?? []) {
      const hookResult = yield* Effect.tryPromise({
        try: () => Promise.resolve(handler({
          type: 'onStepError',
          data: { ...stepData, error: toError(currentFailure.cause), retryCount: attempt },
        })),
        catch: (cause) => nodeFailure(workflow.id, node.id, cause),
      });
      if (hookResult?.abort) {
        span?.end();
        return {
          node,
          result: undefined,
          skipped: false,
          abortedBy: 'pipeline onStepError hook',
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

  if (hookManager) {
    const after = yield* Effect.tryPromise({
      try: () => hookManager.executeHooksAndMerge('afterStep', {
        type: 'afterStep',
        data: { ...stepData, result },
        runId,
        conversationId: context.conversationId,
        pipelineId: workflow.id,
        stepName: node.name ?? node.id,
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

  for (const handler of workflow.hooks?.afterStep ?? []) {
    const after = yield* Effect.tryPromise({
      try: () => Promise.resolve(handler({ type: 'afterStep', data: { ...stepData, result } })),
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
      context,
      expiresAt: ttl ? new Date(now + ttl) : undefined,
      pauseMetadata: pause?.metadata,
    }),
    catch: (cause) => nodeFailure(workflow.id, node.id, cause),
  }).pipe(Effect.ignore);
});

export const executeWorkflowEffect = Effect.fn('WorkflowExecutor.execute')(function* (
  workflow: WorkflowIR,
  input: string,
  options: WorkflowExecutionOptions,
) {
  const runId = options.runId ?? options.checkpointManager?.generateRunId() ?? crypto.randomUUID();
  const restored = options.restoredContext;
  const context: PipelineContext = restored
    ? {
        ...restored,
        outputs: { ...restored.outputs },
        history: [...restored.history],
        metadata: { ...restored.metadata },
        conversationId: options.conversationId ?? restored.conversationId,
      }
    : {
        pipelineId: workflow.id,
        input,
        outputs: {},
        history: [...(options.history ?? [])],
        metadata: {},
        conversationId: options.conversationId,
      };
  const runtimeOutputs: Record<string, unknown> = { ...context.outputs };
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
  let finalResponse: AgentResponse | undefined;
  let currentMessage = context.input;

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
        context: { ...context, outputs: publicOutputs(workflow, runtimeOutputs) },
        outputs: publicOutputs(workflow, runtimeOutputs),
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
        context: { ...context, outputs: publicOutputs(workflow, runtimeOutputs) },
        outputs: publicOutputs(workflow, runtimeOutputs),
        executedNodes,
        abortedBy: 'pipeline beforePipeline hook',
        runId,
      } satisfies WorkflowExecutionResult;
    }
  }

  while (ready.length > 0) {
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
        return executeNode(
          workflow,
          node,
          context,
          runtimeOutputs,
          options,
          workflow.source === 'v1' ? currentMessage : context.input,
          runId,
        );
      },
      { concurrency: 'unbounded' },
    );

    for (const execution of executions) {
      const { node, result } = execution;
      if (execution.abortedBy) {
        workflowSpan?.setStatus('ok');
        workflowSpan?.end();
        const outputs = publicOutputs(workflow, runtimeOutputs);
        return {
          success: false,
          status: 'aborted',
          context: { ...context, outputs },
          outputs,
          executedNodes,
          finalOutput,
          finalResponse,
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

      if (workflow.source === 'v1' && node.kind === 'agent' && !execution.skipped) {
        const content = agentResponseContent(result);
        context.history.push({ role: 'user', content: currentMessage });
        if (content) context.history.push({ role: 'assistant', content });
        if (content !== undefined) currentMessage = content;
        if (isRecord(result) && typeof result.content === 'string') {
          finalResponse = { ...result, content: result.content };
        }
      }

      context.outputs = publicOutputs(workflow, runtimeOutputs);

      if (execution.pause) {
        yield* saveCheckpoint(
          workflow,
          node,
          context,
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
          finalResponse,
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
        !execution.skipped
      ) {
        yield* saveCheckpoint(workflow, node, context, options, runId, 'in_progress');
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

  workflowSpan?.setStatus('ok');
  workflowSpan?.end();
  return {
    success: true,
    status: 'completed',
    context,
    outputs: context.outputs,
    executedNodes,
    finalOutput,
    finalResponse,
    runId,
  } satisfies WorkflowExecutionResult;
});

export const WorkflowExecutorServiceLive = Layer.succeed(WorkflowExecutorService, {
  execute: executeWorkflowEffect,
});
