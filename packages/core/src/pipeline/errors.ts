import { Data } from 'effect';

/**
 * Error thrown when a pipeline is not found by ID.
 */
export class PipelineNotFoundError extends Data.TaggedError("PipelineNotFoundError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when attempting to create a pipeline with an ID that already exists.
 */
export class PipelineAlreadyExistsError extends Data.TaggedError("PipelineAlreadyExistsError")<{
  readonly id: string;
}> {}

/**
 * Error thrown when pipeline execution fails.
 */
export class PipelineExecutionError extends Data.TaggedError("PipelineExecutionError")<{
  readonly pipelineId: string;
  readonly step: number;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when a specific pipeline step fails.
 */
export class PipelineStepError extends Data.TaggedError("PipelineStepError")<{
  readonly pipelineId: string;
  readonly stepName: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when a checkpoint is not found.
 */
export class CheckpointNotFoundError extends Data.TaggedError("CheckpointNotFoundError")<{
  readonly runId: string;
  readonly step?: number;
}> {}

/**
 * Error thrown when a checkpoint has expired.
 */
export class CheckpointExpiredError extends Data.TaggedError("CheckpointExpiredError")<{
  readonly runId: string;
}> {}

/**
 * Error thrown when a pause state is not found.
 */
export class PauseNotFoundError extends Data.TaggedError("PauseNotFoundError")<{
  readonly runId: string;
}> {}

/**
 * Error thrown when a pause state has expired.
 */
export class PauseExpiredError extends Data.TaggedError("PauseExpiredError")<{
  readonly runId: string;
  readonly expiresAt: Date;
}> {}

/**
 * Error thrown when a concurrency issue occurs.
 */
export class ConcurrencyError extends Data.TaggedError("ConcurrencyError")<{
  readonly runId: string;
  readonly operation: string;
}> {}

/**
 * Error thrown when graph workflow validation fails.
 */
export class GraphValidationError extends Data.TaggedError("GraphValidationError")<{
  readonly workflowId: string;
  readonly message: string;
}> {}

// ==========================================
// Resume Errors (PIPE-02, PIPE-03)
// ==========================================

/**
 * Error thrown when resume fails due to checkpoint not found.
 * Includes checkpoint metadata for diagnostics.
 */
export class ResumeCheckpointNotFoundError extends Data.TaggedError("ResumeCheckpointNotFoundError")<{
  readonly runId: string;
  readonly pipelineId?: string;
}> {}

/**
 * Error thrown when resume fails due to checkpoint being expired.
 * Includes checkpoint metadata for diagnostics.
 */
export class ResumeCheckpointExpiredError extends Data.TaggedError("ResumeCheckpointExpiredError")<{
  readonly runId: string;
  readonly pipelineId: string;
  readonly expiresAt: Date;
}> {}

/**
 * Error thrown when resume fails due to checkpoint being in invalid state.
 * Includes checkpoint metadata for diagnostics.
 */
export class ResumeInvalidStateError extends Data.TaggedError("ResumeInvalidStateError")<{
  readonly runId: string;
  readonly pipelineId: string;
  readonly step: number;
  readonly status: string;
  readonly expectedStatus: string;
}> {}

/**
 * Error thrown when resume fails due to pipeline not found.
 * Includes checkpoint metadata for diagnostics.
 */
export class ResumePipelineNotFoundError extends Data.TaggedError("ResumePipelineNotFoundError")<{
  readonly runId: string;
  readonly pipelineId: string;
}> {}

/**
 * Error thrown when resume fails due to step no longer being resolvable.
 * Includes checkpoint metadata and best-effort recovery information.
 */
export class ResumeStepNotResolvableError extends Data.TaggedError("ResumeStepNotResolvableError")<{
  readonly runId: string;
  readonly pipelineId: string;
  readonly step: number;
  readonly stepName?: string;
  readonly availableSteps: string[];
}> {}

/**
 * Error thrown when resumeWithHumanInput fails because checkpoint is not paused.
 * Includes checkpoint metadata for diagnostics.
 */
export class ResumeNotPausedError extends Data.TaggedError("ResumeNotPausedError")<{
  readonly runId: string;
  readonly pipelineId: string;
  readonly step: number;
  readonly status: string;
}> {}

/**
 * Union type for all pipeline errors, enabling exhaustive catchTag handling.
 */
export type PipelineError =
  | PipelineNotFoundError
  | PipelineAlreadyExistsError
  | PipelineExecutionError
  | PipelineStepError
  | CheckpointNotFoundError
  | CheckpointExpiredError
  | PauseNotFoundError
  | PauseExpiredError
  | ConcurrencyError
  | GraphValidationError
  | ResumeCheckpointNotFoundError
  | ResumeCheckpointExpiredError
  | ResumeInvalidStateError
  | ResumePipelineNotFoundError
  | ResumeStepNotResolvableError
  | ResumeNotPausedError;

/**
 * Union type for resume-specific errors.
 */
export type ResumeError =
  | ResumeCheckpointNotFoundError
  | ResumeCheckpointExpiredError
  | ResumeInvalidStateError
  | ResumePipelineNotFoundError
  | ResumeStepNotResolvableError
  | ResumeNotPausedError;
