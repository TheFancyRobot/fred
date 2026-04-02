import { Data } from 'effect';

export class SubagentAlreadyExistsError extends Data.TaggedError('SubagentAlreadyExistsError')<{
  readonly subagentId: string;
}> {}

export class SubagentNotFoundError extends Data.TaggedError('SubagentNotFoundError')<{
  readonly subagentId: string;
}> {}

export class SubagentBusyError extends Data.TaggedError('SubagentBusyError')<{
  readonly subagentId: string;
}> {}

export class SubagentDestroyedError extends Data.TaggedError('SubagentDestroyedError')<{
  readonly subagentId: string;
}> {}

export class SubagentExecutionError extends Data.TaggedError('SubagentExecutionError')<{
  readonly subagentId: string;
  readonly command: string;
  readonly message: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly stdoutPreview?: string;
  readonly stderrPreview?: string;
  readonly cause?: unknown;
}> {}

export class SubagentTimeoutError extends Data.TaggedError('SubagentTimeoutError')<{
  readonly subagentId: string;
  readonly command: string;
  readonly timeoutMs: number;
  readonly stdoutPreview?: string;
  readonly stderrPreview?: string;
}> {}

export type SubagentError =
  | SubagentAlreadyExistsError
  | SubagentNotFoundError
  | SubagentBusyError
  | SubagentDestroyedError
  | SubagentExecutionError
  | SubagentTimeoutError;
