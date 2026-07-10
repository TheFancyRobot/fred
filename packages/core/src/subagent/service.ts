import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
const DEFAULT_SUBAGENT_ENV_ALLOWLIST = [
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'NODE_ENV',
  'LANG',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
] as const;

const CAPTURE_PROCESS_SOURCE = String.raw`
const [stdoutPath, stderrPath, maxOutputArg, command, ...args] = process.argv.slice(1);
const maxOutputBytes = Number(maxOutputArg);

const capture = async (stream, path) => {
  const reader = stream.getReader();
  const chunks = [];
  let capturedBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (capturedBytes >= maxOutputBytes) continue;
    const chunk = value.subarray(0, maxOutputBytes - capturedBytes);
    chunks.push(chunk);
    capturedBytes += chunk.byteLength;
  }
  const output = new Uint8Array(capturedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  await Bun.write(path, output);
};

const main = async () => {
  if (!stdoutPath || !stderrPath || !command || !Number.isFinite(maxOutputBytes)) {
    process.exit(2);
  }
  const input = await new Response(Bun.stdin.stream()).arrayBuffer();
  const child = Bun.spawn([command, ...args], {
    cwd: process.cwd(),
    env: process.env,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  if (input.byteLength > 0) child.stdin.write(input);
  child.stdin.end();
  const [exitCode] = await Promise.all([
    child.exited,
    capture(child.stdout, stdoutPath),
    capture(child.stderr, stderrPath),
  ]);
  process.exit(exitCode);
};

await main().catch(async (cause) => {
  if (stderrPath) await Bun.write(stderrPath, cause instanceof Error ? cause.stack ?? cause.message : String(cause));
  process.exit(1);
});
`;

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
  readonly currentProcess?: ChildProcess;
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

interface ProcessOutputCollector {
  readonly stdout: () => string;
  readonly stderr: () => string;
  readonly dispose: () => void;
}

interface SpawnedChild {
  readonly child: ChildProcess;
  readonly output: ProcessOutputCollector;
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

      const spawned = yield* self.spawnChild(record, commandArgs, options.stdin, maxOutputChars);
      const { child, output } = spawned;
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
            terminationGraceMs,
            output,
          }),
          () => Effect.promise(async () => {
            await controller.terminate({ graceMs: terminationGraceMs });
            output.dispose();
          }),
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
        const cleanupSpawned = yield* self.spawnChild(
          record,
          cleanupCommandArgs,
          undefined,
          DEFAULT_OUTPUT_PREVIEW_CHARS,
        );
        const cleanupChild = cleanupSpawned.child;
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
              terminationGraceMs: DEFAULT_TERMINATION_GRACE_MS,
              output: cleanupSpawned.output,
            }),
            () => Effect.promise(async () => {
              await cleanupController.terminate({ graceMs: DEFAULT_TERMINATION_GRACE_MS });
              cleanupSpawned.output.dispose();
            }),
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
    maxOutputChars: number = DEFAULT_OUTPUT_PREVIEW_CHARS,
  ): Effect.Effect<SpawnedChild, SubagentExecutionError> {
    return Effect.try({
      try: () => {
        const captureDir = mkdtempSync(join(tmpdir(), 'fred-subagent-output-'));
        const stdoutPath = join(captureDir, 'stdout.txt');
        const stderrPath = join(captureDir, 'stderr.txt');
        let child: ChildProcess;

        try {
          child = spawn(process.execPath, [
            '-e',
            CAPTURE_PROCESS_SOURCE,
            stdoutPath,
            stderrPath,
            String(maxOutputChars),
            record.command,
            ...args,
          ], {
            cwd: record.cwd,
            env: buildSubagentEnv(record.env),
            stdio: ['pipe', 'ignore', 'ignore'],
            detached: process.platform !== 'win32',
          });
        } catch (cause) {
          rmSync(captureDir, { recursive: true, force: true });
          throw cause;
        }

        const output = createFileOutputCollector(captureDir, stdoutPath, stderrPath, maxOutputChars);
        if (stdin !== undefined) child.stdin?.write(stdin);
        child.stdin?.end();
        return { child, output };
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

function buildSubagentEnv(explicitEnv?: Record<string, string>): Record<string, string> {
  const filtered: Record<string, string> = {};

  for (const key of DEFAULT_SUBAGENT_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) {
      filtered[key] = value;
    }
  }

  return {
    ...filtered,
    ...explicitEnv,
  };
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
  child: ChildProcess,
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
  child: ChildProcess,
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

function createFileOutputCollector(
  captureDir: string,
  stdoutPath: string,
  stderrPath: string,
  maxOutputChars: number,
): ProcessOutputCollector {
  let disposed = false;

  return {
    stdout: () => readCapturedOutput(stdoutPath, maxOutputChars),
    stderr: () => readCapturedOutput(stderrPath, maxOutputChars),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      rmSync(captureDir, { recursive: true, force: true });
    },
  };
}

function readCapturedOutput(path: string, maxOutputChars: number): string {
  try {
    return readFileSync(path, 'utf8').slice(0, maxOutputChars);
  } catch {
    return '';
  }
}

function waitForProcess(options: {
  readonly child: ChildProcess;
  readonly controller: ManagedProcessController;
  readonly subagentId: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly terminationGraceMs: number;
  readonly output: ProcessOutputCollector;
}): Effect.Effect<WaitForProcessSuccess, SubagentExecutionError | SubagentTimeoutError> {
  const { child, controller, subagentId, command, timeoutMs, terminationGraceMs, output } = options;

  return Effect.async<WaitForProcessSuccess, SubagentExecutionError | SubagentTimeoutError>((resume) => {
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
      stdoutPreview: trimPreview(output.stdout()),
      stderrPreview: trimPreview(output.stderr()),
    });

    const onError = (cause: Error) => {
      finish(Effect.fail(new SubagentExecutionError({
        subagentId,
        command,
        message: cause.message,
        stdoutPreview: trimPreview(output.stdout()),
        stderrPreview: trimPreview(output.stderr()),
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
          stdout: output.stdout(),
          stderr: output.stderr(),
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
        stdoutPreview: trimPreview(output.stdout()),
        stderrPreview: trimPreview(output.stderr()),
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
            stdoutPreview: trimPreview(output.stdout()),
            stderrPreview: trimPreview(output.stderr()),
            cause,
          })));
        });
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutId);
      output.dispose();
      child.off('error', onError);
      child.off('close', onClose);
    };

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
