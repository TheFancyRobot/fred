import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Context, Effect, Either, Layer, Ref } from 'effect';
import {
  SubagentAlreadyExistsError,
  SubagentBusyError,
  SubagentDestroyedError,
  SubagentExecutionError,
  SubagentNotFoundError,
  SubagentTimeoutError,
} from './errors';
import { getCurrentSubagentExecutionContext } from './context';

const DEFAULT_OUTPUT_PREVIEW_CHARS = 4000;
const DEFAULT_EXECUTION_TIMEOUT_MS = 30_000;
const DEFAULT_TERMINATION_GRACE_MS = 2_000;

export type SubagentStatus = 'idle' | 'running' | 'failed' | 'destroyed';

export interface SpawnSubagentOptions {
  readonly id?: string;
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd?: string;
  readonly env?: Record<string, string>;
  readonly metadata?: Record<string, unknown>;
  readonly destroy?: {
    readonly signal?: NodeJS.Signals | number;
    readonly cleanupArgs?: readonly string[];
    readonly cleanupTimeoutMs?: number;
    readonly ignoreCleanupFailure?: boolean;
  };
}

export interface ExecuteSubagentOptions {
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly deadlineAt?: number;
  readonly stdin?: string;
  readonly maxOutputChars?: number;
  readonly terminationGraceMs?: number;
}

export interface SubagentExecutionSummary {
  readonly args: readonly string[];
  readonly startedAt: string;
  readonly endedAt?: string;
  readonly pid?: number;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly timedOut?: boolean;
  readonly stdoutPreview?: string;
  readonly stderrPreview?: string;
}

export interface SubagentInfo {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly envKeys: readonly string[];
  readonly metadata: Record<string, unknown>;
  readonly status: SubagentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly executionCount: number;
  readonly currentExecution?: SubagentExecutionSummary;
  readonly lastExecution?: SubagentExecutionSummary;
}

export interface ExecuteSubagentResult {
  readonly pid?: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface InternalSubagentRecord extends SubagentInfo {
  readonly env?: Record<string, string>;
  readonly destroyConfig?: SpawnSubagentOptions['destroy'];
  readonly currentProcess?: ChildProcessWithoutNullStreams;
  readonly currentProcessController?: ManagedProcessController;
}

interface WaitForProcessSuccess extends ExecuteSubagentResult {}

type ExecutionResult =
  | { readonly success: true; readonly value: ExecuteSubagentResult }
  | { readonly success: false; readonly error: SubagentExecutionError | SubagentTimeoutError };

interface ManagedProcessController {
  readonly waitForClose: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>;
  readonly terminate: (options?: {
    readonly signal?: NodeJS.Signals | number;
    readonly graceMs?: number;
  }) => Promise<void>;
}

export interface SubagentService {
  spawnSubagent(
    options: SpawnSubagentOptions,
  ): Effect.Effect<SubagentInfo, SubagentAlreadyExistsError>;

  listSubagents(): Effect.Effect<SubagentInfo[]>;

  inspectSubagent(id: string): Effect.Effect<SubagentInfo | undefined>;

  executeSubagent(
    id: string,
    options?: ExecuteSubagentOptions,
  ): Effect.Effect<
    ExecuteSubagentResult,
    SubagentNotFoundError | SubagentBusyError | SubagentDestroyedError | SubagentExecutionError | SubagentTimeoutError
  >;

  destroySubagent(id: string): Effect.Effect<boolean, SubagentExecutionError | SubagentTimeoutError>;

  destroyAllSubagents(): Effect.Effect<void>;
}

export const SubagentService = Context.GenericTag<SubagentService>('SubagentService');

class SubagentServiceImpl implements SubagentService {
  constructor(private readonly subagents: Ref.Ref<Map<string, InternalSubagentRecord>>) {}

  spawnSubagent(
    options: SpawnSubagentOptions,
  ): Effect.Effect<SubagentInfo, SubagentAlreadyExistsError> {
    const self = this;
    return Effect.gen(function* () {
      const now = new Date().toISOString();
      const id = options.id ?? crypto.randomUUID();
      const subagents = yield* Ref.get(self.subagents);
      if (subagents.has(id)) {
        return yield* Effect.fail(new SubagentAlreadyExistsError({ subagentId: id }));
      }

      const record: InternalSubagentRecord = {
        id,
        name: options.name,
        command: options.command,
        args: [...(options.args ?? [])],
        cwd: options.cwd,
        envKeys: Object.keys(options.env ?? {}).sort(),
        metadata: { ...(options.metadata ?? {}) },
        status: 'idle',
        createdAt: now,
        updatedAt: now,
        executionCount: 0,
        env: options.env ? { ...options.env } : undefined,
        destroyConfig: options.destroy
          ? {
              signal: options.destroy.signal,
              cleanupArgs: options.destroy.cleanupArgs ? [...options.destroy.cleanupArgs] : undefined,
              cleanupTimeoutMs: options.destroy.cleanupTimeoutMs,
              ignoreCleanupFailure: options.destroy.ignoreCleanupFailure,
            }
          : undefined,
      };

      const updated = new Map(subagents);
      updated.set(id, record);
      yield* Ref.set(self.subagents, updated);
      return toPublicRecord(record);
    });
  }

  listSubagents(): Effect.Effect<SubagentInfo[]> {
    return Ref.get(this.subagents).pipe(
      Effect.map((subagents) => Array.from(subagents.values()).map(toPublicRecord)),
    );
  }

  inspectSubagent(id: string): Effect.Effect<SubagentInfo | undefined> {
    return Ref.get(this.subagents).pipe(
      Effect.map((subagents) => {
        const record = subagents.get(id);
        return record ? toPublicRecord(record) : undefined;
      }),
    );
  }

  executeSubagent(
    id: string,
    options: ExecuteSubagentOptions = {},
  ): Effect.Effect<
    ExecuteSubagentResult,
    SubagentNotFoundError | SubagentBusyError | SubagentDestroyedError | SubagentExecutionError | SubagentTimeoutError
  > {
    const self = this;
    const timeoutMs = resolveExecutionTimeout(options);
    const maxOutputChars = options.maxOutputChars ?? DEFAULT_OUTPUT_PREVIEW_CHARS;
    const terminationGraceMs = options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;

    return Effect.gen(function* () {
      const record = yield* self.getSubagentOrFail(id);

      if (record.status === 'running') {
        return yield* Effect.fail(new SubagentBusyError({ subagentId: id }));
      }

      if (record.status === 'destroyed') {
        return yield* Effect.fail(new SubagentDestroyedError({ subagentId: id }));
      }

      const commandArgs = [...record.args, ...(options.args ?? [])];
      const startedAt = new Date().toISOString();

      yield* self.updateSubagent(id, (current) => ({
        ...current,
        status: 'running',
        updatedAt: startedAt,
        currentExecution: {
          args: commandArgs,
          startedAt,
        },
      }));

      const child = yield* self.spawnChild(record, commandArgs, options.stdin);
      const controller = createManagedProcessController(child);
      const executionContext = getCurrentSubagentExecutionContext();

      const unregisterActiveSubagent = executionContext?.registerActiveSubagent({
        id,
        cancel: () => controller.terminate({ graceMs: terminationGraceMs }),
      });

      yield* self.updateSubagent(id, (current) => ({
        ...current,
        updatedAt: new Date().toISOString(),
        currentProcess: child,
        currentProcessController: controller,
        currentExecution: {
          ...(current.currentExecution ?? { args: commandArgs, startedAt }),
          pid: child.pid,
        },
      }));

      const command = formatCommand(record.command, commandArgs);
      const resultEither = yield* Effect.either(
        Effect.acquireUseRelease(
          Effect.succeed(child),
          (runningChild) => waitForProcess({
            child: runningChild,
            controller,
            subagentId: id,
            command,
            timeoutMs,
            maxOutputChars,
            terminationGraceMs,
          }),
          () => Effect.promise(() => controller.terminate({ graceMs: terminationGraceMs })),
        ),
      );
      const result: ExecutionResult = Either.isLeft(resultEither)
        ? { success: false, error: resultEither.left as SubagentExecutionError | SubagentTimeoutError }
        : { success: true, value: resultEither.right as ExecuteSubagentResult };

      const endedAt = new Date().toISOString();
      unregisterActiveSubagent?.();
      yield* self.completeExecution(id, endedAt, result);

      if (!result.success) {
        return yield* Effect.fail(result.error);
      }

      return result.value;
    });
  }

  destroySubagent(id: string): Effect.Effect<boolean, SubagentExecutionError | SubagentTimeoutError> {
    const self = this;
    return Effect.gen(function* () {
      const record = yield* Ref.get(self.subagents).pipe(Effect.map((subagents) => subagents.get(id)));
      if (!record || record.status === 'destroyed') {
        return false;
      }

      yield* self.updateSubagent(id, (current) => ({
        ...current,
        status: 'destroyed',
        updatedAt: new Date().toISOString(),
        currentProcess: undefined,
        currentExecution: undefined,
      }));

      const signal = record.destroyConfig?.signal ?? 'SIGTERM';
      if (record.currentProcessController) {
        yield* Effect.promise(() =>
          record.currentProcessController!.terminate({
            signal,
            graceMs: DEFAULT_TERMINATION_GRACE_MS,
          }),
        );
      } else if (record.currentProcess && !record.currentProcess.killed) {
        const currentProcess = record.currentProcess;
        yield* Effect.sync(() => {
          signalProcess(currentProcess, signal);
        });
      }

      const cleanupArgs = record.destroyConfig?.cleanupArgs ?? [];
      if (cleanupArgs.length > 0) {
        const cleanupCommandArgs = [...record.args, ...cleanupArgs];
        const cleanupChild = yield* self.spawnChild(record, cleanupCommandArgs, undefined);
        const cleanupController = createManagedProcessController(cleanupChild);
        const cleanupCommand = formatCommand(record.command, cleanupCommandArgs);
        const cleanupResult = yield* Effect.either(
          Effect.acquireUseRelease(
            Effect.succeed(cleanupChild),
            (runningChild) => waitForProcess({
              child: runningChild,
              controller: cleanupController,
              subagentId: id,
              command: cleanupCommand,
              timeoutMs: record.destroyConfig?.cleanupTimeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS,
              maxOutputChars: DEFAULT_OUTPUT_PREVIEW_CHARS,
              terminationGraceMs: DEFAULT_TERMINATION_GRACE_MS,
            }),
            () => Effect.promise(() => cleanupController.terminate({ graceMs: DEFAULT_TERMINATION_GRACE_MS })),
          ),
        );

        if (Either.isLeft(cleanupResult) && !record.destroyConfig?.ignoreCleanupFailure) {
          return yield* Effect.fail(cleanupResult.left as SubagentExecutionError | SubagentTimeoutError);
        }
      }

      return true;
    }).pipe(
      Effect.catchTag('SubagentNotFoundError', () => Effect.succeed(false)),
    );
  }

  destroyAllSubagents(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const records = yield* Ref.get(self.subagents).pipe(
        Effect.map((subagents) => Array.from(subagents.keys())),
      );

      for (const id of records) {
        yield* self.destroySubagent(id).pipe(Effect.catchAll(() => Effect.succeed(false)));
      }
    });
  }

  private getSubagentOrFail(id: string): Effect.Effect<InternalSubagentRecord, SubagentNotFoundError> {
    return Ref.get(this.subagents).pipe(
      Effect.flatMap((subagents) => {
        const record = subagents.get(id);
        return record
          ? Effect.succeed(record)
          : Effect.fail(new SubagentNotFoundError({ subagentId: id }));
      }),
    );
  }

  private updateSubagent(
    id: string,
    updater: (record: InternalSubagentRecord) => InternalSubagentRecord,
  ): Effect.Effect<void, SubagentNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const subagents = yield* Ref.get(self.subagents);
      const existing = subagents.get(id);
      if (!existing) {
        return yield* Effect.fail(new SubagentNotFoundError({ subagentId: id }));
      }

      const updated = new Map(subagents);
      updated.set(id, updater(existing));
      yield* Ref.set(self.subagents, updated);
    });
  }

  private spawnChild(
    record: InternalSubagentRecord,
    args: readonly string[],
    stdin?: string,
  ): Effect.Effect<ChildProcessWithoutNullStreams, SubagentExecutionError> {
    return Effect.try({
      try: () => {
        const child = spawn(record.command, [...args], {
          cwd: record.cwd,
          env: record.env ? { ...process.env, ...record.env } : process.env,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: process.platform !== 'win32',
        });

        if (stdin !== undefined) {
          child.stdin.write(stdin);
        }
        child.stdin.end();
        return child;
      },
      catch: (cause) => new SubagentExecutionError({
        subagentId: record.id,
        command: formatCommand(record.command, args),
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
    });
  }

  private completeExecution(
    id: string,
    endedAt: string,
    result: ExecutionResult,
  ): Effect.Effect<void, SubagentNotFoundError> {
    return this.updateSubagent(id, (current) => {
      const priorCurrent = current.currentExecution;
      if (current.status === 'destroyed') {
        return {
          ...current,
          updatedAt: endedAt,
          currentProcess: undefined,
          currentProcessController: undefined,
          currentExecution: undefined,
        };
      }

      if (result.success) {
        return {
          ...current,
          status: 'idle',
          updatedAt: endedAt,
          executionCount: current.executionCount + 1,
          currentProcess: undefined,
          currentProcessController: undefined,
          currentExecution: undefined,
          lastExecution: {
            args: priorCurrent?.args ?? [],
            startedAt: priorCurrent?.startedAt ?? endedAt,
            endedAt,
            pid: result.value.pid,
            exitCode: result.value.exitCode,
            signal: result.value.signal,
            stdoutPreview: trimPreview(result.value.stdout),
            stderrPreview: trimPreview(result.value.stderr),
          },
        };
      }

      const failure = result.error;
      const timeout = failure._tag === 'SubagentTimeoutError' ? failure : undefined;
      const execution = failure._tag === 'SubagentExecutionError' ? failure : undefined;

      return {
        ...current,
        status: 'failed',
        updatedAt: endedAt,
        executionCount: current.executionCount + 1,
        currentProcess: undefined,
        currentProcessController: undefined,
        currentExecution: undefined,
        lastExecution: {
          args: priorCurrent?.args ?? [],
          startedAt: priorCurrent?.startedAt ?? endedAt,
          endedAt,
          pid: priorCurrent?.pid,
          exitCode: execution?.exitCode,
          signal: execution?.signal,
          timedOut: timeout !== undefined,
          stdoutPreview: timeout?.stdoutPreview ?? execution?.stdoutPreview,
          stderrPreview: timeout?.stderrPreview ?? execution?.stderrPreview,
        },
      };
    });
  }
}

function resolveExecutionTimeout(options: ExecuteSubagentOptions): number {
  const requestedTimeoutMs = options.timeoutMs ?? DEFAULT_EXECUTION_TIMEOUT_MS;
  const context = getCurrentSubagentExecutionContext();
  const inheritedDeadlineAt = context
    ? context.deadlineAt - Math.max(0, context.reserveTimeoutMs)
    : undefined;
  const explicitDeadlineAt = options.deadlineAt;
  const effectiveDeadlineAt = [explicitDeadlineAt, inheritedDeadlineAt]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .reduce<number | undefined>((earliest, value) =>
      earliest === undefined ? value : Math.min(earliest, value), undefined,
    );

  if (effectiveDeadlineAt === undefined) {
    return requestedTimeoutMs;
  }

  return Math.max(1, Math.min(requestedTimeoutMs, effectiveDeadlineAt - Date.now()));
}

function createManagedProcessController(
  child: ChildProcessWithoutNullStreams,
): ManagedProcessController {
  let closed = false;
  let terminatePromise: Promise<void> | undefined;

  const waitForClose = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.once('close', (exitCode, signal) => {
      closed = true;
      resolve({ exitCode, signal });
    });
  });

  return {
    waitForClose,
    terminate: async (options = {}) => {
      if (closed) {
        await waitForClose;
        return;
      }

      if (terminatePromise) {
        await terminatePromise;
        return;
      }

      terminatePromise = (async () => {
        const signal = options.signal ?? 'SIGTERM';
        const graceMs = options.graceMs ?? DEFAULT_TERMINATION_GRACE_MS;

        signalProcess(child, signal);

        if (closed) {
          await waitForClose;
          return;
        }

        const forceKill = new Promise<void>((resolve) => {
          const timerId = setTimeout(() => {
            if (!closed) {
              signalProcess(child, 'SIGKILL');
            }
            resolve();
          }, graceMs);

          void waitForClose.finally(() => {
            clearTimeout(timerId);
            resolve();
          });
        });

        await Promise.all([waitForClose, forceKill]);
      })();

      await terminatePromise;
    },
  };
}

function signalProcess(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals | number,
): void {
  if (!child.pid) {
    return;
  }

  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to direct child kill.
    }
  }

  try {
    child.kill(signal);
  } catch {
    // Best effort; process may have already exited.
  }
}

function waitForProcess(options: {
  readonly child: ChildProcessWithoutNullStreams;
  readonly controller: ManagedProcessController;
  readonly subagentId: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly maxOutputChars: number;
  readonly terminationGraceMs: number;
}): Effect.Effect<WaitForProcessSuccess, SubagentExecutionError | SubagentTimeoutError> {
  const { child, controller, subagentId, command, timeoutMs, maxOutputChars, terminationGraceMs } = options;

  return Effect.async<WaitForProcessSuccess, SubagentExecutionError | SubagentTimeoutError>((resume) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (
      effect: Effect.Effect<WaitForProcessSuccess, SubagentExecutionError | SubagentTimeoutError>,
    ) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resume(effect);
    };

    const buildTimeoutError = () => new SubagentTimeoutError({
      subagentId,
      command,
      timeoutMs,
      stdoutPreview: trimPreview(stdout),
      stderrPreview: trimPreview(stderr),
    });

    const onStdout = (chunk: string | Buffer) => {
      stdout = appendOutput(stdout, chunk.toString(), maxOutputChars);
    };

    const onStderr = (chunk: string | Buffer) => {
      stderr = appendOutput(stderr, chunk.toString(), maxOutputChars);
    };

    const onError = (cause: Error) => {
      finish(Effect.fail(new SubagentExecutionError({
        subagentId,
        command,
        message: cause.message,
        stdoutPreview: trimPreview(stdout),
        stderrPreview: trimPreview(stderr),
        cause,
      })));
    };

    const onClose = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (timedOut) {
        finish(Effect.fail(buildTimeoutError()));
        return;
      }

      if (exitCode === 0) {
        finish(Effect.succeed({
          pid: child.pid,
          stdout,
          stderr,
          exitCode,
          signal,
        }));
        return;
      }

      finish(Effect.fail(new SubagentExecutionError({
        subagentId,
        command,
        message: `Subagent process exited with code ${exitCode ?? 'null'}${signal ? ` (${signal})` : ''}`,
        exitCode,
        signal,
        stdoutPreview: trimPreview(stdout),
        stderrPreview: trimPreview(stderr),
      })));
    };

    const timeoutId = setTimeout(() => {
      timedOut = true;
      void controller
        .terminate({ graceMs: terminationGraceMs })
        .then(() => {
          finish(Effect.fail(buildTimeoutError()));
        })
        .catch((cause) => {
          finish(Effect.fail(new SubagentExecutionError({
            subagentId,
            command,
            message: cause instanceof Error ? cause.message : String(cause),
            stdoutPreview: trimPreview(stdout),
            stderrPreview: trimPreview(stderr),
            cause,
          })));
        });
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      child.stdout.off('data', onStdout);
      child.stderr.off('data', onStderr);
      child.off('error', onError);
      child.off('close', onClose);
    };

    child.stdout.on('data', onStdout);
    child.stderr.on('data', onStderr);
    child.once('error', onError);
    child.once('close', onClose);
  });
}

function toPublicRecord(record: InternalSubagentRecord): SubagentInfo {
  return {
    id: record.id,
    name: record.name,
    command: record.command,
    args: [...record.args],
    cwd: record.cwd,
    envKeys: [...record.envKeys],
    metadata: { ...record.metadata },
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    executionCount: record.executionCount,
    currentExecution: record.currentExecution
      ? {
          ...record.currentExecution,
          args: [...record.currentExecution.args],
        }
      : undefined,
    lastExecution: record.lastExecution
      ? {
          ...record.lastExecution,
          args: [...record.lastExecution.args],
        }
      : undefined,
  };
}

function appendOutput(current: string, chunk: string, maxOutputChars: number): string {
  if (current.length >= maxOutputChars) {
    return current;
  }

  const remaining = maxOutputChars - current.length;
  return current + chunk.slice(0, remaining);
}

function trimPreview(text: string | undefined): string | undefined {
  const value = text?.trim();
  return value ? value : undefined;
}

function formatCommand(command: string, args: readonly string[]): string {
  return [command, ...args].join(' ');
}

export const SubagentServiceLive = Layer.effect(
  SubagentService,
  Effect.gen(function* () {
    const subagents = yield* Ref.make(new Map<string, InternalSubagentRecord>());
    return new SubagentServiceImpl(subagents);
  }),
);
