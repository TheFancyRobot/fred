import { createHash } from 'crypto';
import { Duration, Effect, Fiber, TestClock, TestContext } from 'effect';
import type { Tool } from '../tool/tool';
import type { EvalCheckpointArtifact, EvalToolCallArtifact, EvaluationArtifact } from './artifact';
import { toDeterministicValue } from './artifact';
import { TraceStorageService, type TraceStorageApi } from './storage';

export type ReplayMode = 'retry' | 'skip' | 'restart';

export interface ReplayOptions {
  fromCheckpoint?: number;
  mode?: ReplayMode;
}

export interface ReplayDependencies {
  storage: Pick<TraceStorageApi, 'get'>;
  runtime: ReplayRuntimeAdapter;
  configPath?: string;
}

export interface ReplayRuntimeAdapter {
  initializeFromConfig: (
    configPath: string,
    options: {
      toolExecutors?: Map<string, Tool['execute']>;
    }
  ) => Promise<void>;
  resumeFromCheckpoint: (input: ReplayResumeInput) => Effect.Effect<unknown> | Promise<unknown> | unknown;
}

export interface ReplayResumeInput {
  runId: string;
  pipelineId: string;
  mode: ReplayMode;
  checkpoint: EvalCheckpointArtifact;
  contextSnapshot: Record<string, unknown>;
  toolExecutors: Map<string, Tool['execute']>;
}

export interface ReplayResult {
  traceId: string;
  runId: string;
  checkpointStep: number;
  mode: ReplayMode;
  output: unknown;
  outputHash: string;
}

// --- Test clock utilities (merged from test-clock.ts) ---

export function deterministicReplayHash(value: unknown): string {
  const normalized = JSON.stringify(toDeterministicValue(value));
  return createHash('sha256').update(normalized).digest('hex');
}

export function runEffectWithTestClock<A, E>(
  effect: Effect.Effect<A, E>,
  adjustmentsMs: ReadonlyArray<number>
): Promise<A> {
  const program = Effect.gen(function* () {
    const fiber = yield* Effect.fork(effect);
    for (const adjustmentMs of adjustmentsMs) {
      yield* TestClock.adjust(Duration.millis(Math.max(0, adjustmentMs)));
    }
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestContext.TestContext));
  return Effect.runPromise(program);
}

export function deriveClockAdjustmentsFromOffsets(
  offsetsMs: ReadonlyArray<number>,
  extraMs = 1
): ReadonlyArray<number> {
  if (offsetsMs.length === 0) return [];
  const maxOffset = Math.max(...offsetsMs, 0);
  return [maxOffset + Math.max(0, extraMs)];
}

// --- Mock tools (merged from mock-tools.ts) ---

export class MissingToolMockResponseError extends Error {
  constructor(toolId: string, callOrdinal: number) {
    super(
      `Replay mock missing recorded response for tool "${toolId}" call #${callOrdinal}. ` +
        'Replay requires recorded mock responses for every expected tool call.'
    );
    this.name = 'MissingToolMockResponseError';
  }
}

export class ToolMockSignatureMismatchError extends Error {
  constructor(toolId: string, callOrdinal: number) {
    super(
      `Replay tool call signature mismatch for "${toolId}" call #${callOrdinal}. ` +
        'Recorded arguments do not match replay invocation.'
    );
    this.name = 'ToolMockSignatureMismatchError';
  }
}

interface ToolQueueState {
  index: number;
  calls: EvalToolCallArtifact[];
}

export interface ReplayToolMocks {
  readonly toolExecutors: Map<string, Tool['execute']>;
  assertConsumed: () => void;
}

function deterministicJson(value: unknown): string {
  return JSON.stringify(toDeterministicValue(value));
}

function assertMockResponsesExist(toolCalls: ReadonlyArray<EvalToolCallArtifact>): void {
  for (const call of toolCalls) {
    if (call.status === 'success' && call.result === undefined) {
      throw new MissingToolMockResponseError(call.toolId, call.callOrdinal);
    }
  }
}

export function buildReplayToolMocks(artifact: EvaluationArtifact): ReplayToolMocks {
  assertMockResponsesExist(artifact.toolCalls);

  const byTool = new Map<string, ToolQueueState>();
  for (const call of artifact.toolCalls) {
    const current = byTool.get(call.toolId);
    if (current) {
      current.calls.push(call);
    } else {
      byTool.set(call.toolId, { index: 0, calls: [call] });
    }
  }

  const toolExecutors = new Map<string, Tool['execute']>();

  for (const [toolId, queue] of byTool.entries()) {
    toolExecutors.set(toolId, async (args: unknown) => {
      const call = queue.calls[queue.index];
      if (!call) {
        throw new MissingToolMockResponseError(toolId, queue.index);
      }

      if (call.args !== undefined) {
        const expectedSignature = deterministicJson(call.args);
        const actualSignature = deterministicJson(args);
        if (expectedSignature !== actualSignature) {
          throw new ToolMockSignatureMismatchError(toolId, call.callOrdinal);
        }
      }

      queue.index += 1;

      if (call.status === 'error') {
        throw new Error(call.error ?? `Recorded replay tool failure for "${toolId}".`);
      }

      if (call.result === undefined) {
        throw new MissingToolMockResponseError(toolId, call.callOrdinal);
      }

      return toDeterministicValue(call.result);
    });
  }

  return {
    toolExecutors,
    assertConsumed: () => {
      for (const [toolId, queue] of byTool.entries()) {
        if (queue.index !== queue.calls.length) {
          throw new Error(
            `Replay did not consume all recorded mocks for tool "${toolId}". ` +
              `Consumed ${queue.index}/${queue.calls.length}.`
          );
        }
      }
    },
  };
}

export class ReplayTraceNotFoundError extends Error {
  constructor(traceId: string) {
    super(`Replay trace not found for traceId "${traceId}".`);
    this.name = 'ReplayTraceNotFoundError';
  }
}

export class ReplayCheckpointNotFoundError extends Error {
  constructor(requestedCheckpoint: number, availableCheckpoints: ReadonlyArray<number>) {
    super(
      `Replay checkpoint ${requestedCheckpoint} not found in artifact. ` +
        `Available checkpoints: ${availableCheckpoints.join(', ') || 'none'}.`
    );
    this.name = 'ReplayCheckpointNotFoundError';
  }
}

function toEffect(
  value: Effect.Effect<unknown, unknown, never> | Promise<unknown> | unknown
): Effect.Effect<unknown, unknown, never> {
  if (Effect.isEffect(value)) {
    return value as Effect.Effect<unknown, unknown, never>;
  }

  if (value && typeof value === 'object' && 'then' in value && typeof value.then === 'function') {
    return Effect.promise(() => value as Promise<unknown>);
  }

  return Effect.succeed(value);
}

function selectCheckpoint(
  checkpoints: ReadonlyArray<EvalCheckpointArtifact>,
  fromCheckpoint?: number
): EvalCheckpointArtifact {
  if (checkpoints.length === 0) {
    throw new ReplayCheckpointNotFoundError(fromCheckpoint ?? -1, []);
  }

  const sorted = checkpoints.slice().sort((a, b) => a.step - b.step);

  if (fromCheckpoint === undefined) {
    const latest = sorted[sorted.length - 1];
    if (!latest) {
      throw new ReplayCheckpointNotFoundError(-1, []);
    }
    return latest;
  }

  const match = sorted.find((checkpoint) => checkpoint.step === fromCheckpoint);
  if (!match) {
    throw new ReplayCheckpointNotFoundError(
      fromCheckpoint,
      sorted.map((checkpoint) => checkpoint.step)
    );
  }
  return match;
}

function buildClockAdjustments(
  artifact: EvaluationArtifact,
  selectedCheckpointStep: number
): ReadonlyArray<number> {
  const offsets = artifact.toolCalls
    .filter((call) => call.stepIndex >= selectedCheckpointStep)
    .map((call) => call.timing.offsetMs + call.timing.durationMs);

  return deriveClockAdjustmentsFromOffsets(offsets);
}

async function loadArtifact(
  storage: Pick<TraceStorageApi, 'get'>,
  traceId: string
): Promise<EvaluationArtifact | undefined> {
  return Effect.runPromise(storage.get(traceId));
}

export function createReplayOrchestrator(deps: ReplayDependencies) {
  return {
    replay: async (traceId: string, options: ReplayOptions = {}): Promise<ReplayResult> => {
      const artifact = await loadArtifact(deps.storage, traceId);
      if (!artifact) {
        throw new ReplayTraceNotFoundError(traceId);
      }

      const checkpoint = selectCheckpoint(artifact.checkpoints, options.fromCheckpoint);
      const mode = options.mode ?? 'skip';
      const toolMocks = buildReplayToolMocks(artifact);

      // Only initialize from config if configPath is provided
      // For config-less replay, we rely on artifact data and checkpoint resumption
      if (deps.configPath) {
        await deps.runtime.initializeFromConfig(deps.configPath, {
          toolExecutors: toolMocks.toolExecutors,
        });
      }

      const clockAdjustments = buildClockAdjustments(artifact, checkpoint.step);
      const replayOutput = await runEffectWithTestClock(
        toEffect(
          deps.runtime.resumeFromCheckpoint({
            runId: artifact.run.runId,
            pipelineId: String(checkpoint.snapshot.pipelineId ?? ''),
            mode,
            checkpoint,
            contextSnapshot: checkpoint.snapshot,
            toolExecutors: toolMocks.toolExecutors,
          })
        ),
        clockAdjustments
      );

      toolMocks.assertConsumed();

      const result: ReplayResult = {
        traceId: artifact.traceId,
        runId: artifact.run.runId,
        checkpointStep: checkpoint.step,
        mode,
        output: replayOutput,
        outputHash: deterministicReplayHash({
          traceId: artifact.traceId,
          runId: artifact.run.runId,
          checkpointStep: checkpoint.step,
          mode,
          output: replayOutput,
        }),
      };

      return result;
    },
  };
}

export const replay = (
  traceId: string,
  options: ReplayOptions,
  dependencies: ReplayDependencies
): Promise<ReplayResult> => createReplayOrchestrator(dependencies).replay(traceId, options);

export const replayWithStorage = (
  traceId: string,
  options: ReplayOptions,
  runtime: ReplayRuntimeAdapter,
  configPath: string
): Effect.Effect<ReplayResult, Error, TraceStorageService> =>
  Effect.gen(function* () {
    const storage = yield* TraceStorageService;
    return yield* Effect.promise(() => replay(traceId, options, { storage, runtime, configPath }));
  });
