import { Schema } from 'effect';

/** A specific node failed while executing a compiled workflow. */
export class WorkflowNodeExecutionError extends Schema.TaggedError<WorkflowNodeExecutionError>()(
  'WorkflowNodeExecutionError',
  {
    workflowId: Schema.String,
    nodeId: Schema.String,
    message: Schema.String,
    cause: Schema.Unknown,
    /** Whether a source-level retry boundary may safely rerun this failure. */
    retryable: Schema.optional(Schema.Boolean),
  },
) {}

/** Raised before workflow execution when public input does not match its Schema. */
export class WorkflowInputValidationError extends Schema.TaggedError<WorkflowInputValidationError>()(
  'WorkflowInputValidationError',
  {
    workflowId: Schema.String,
    message: Schema.String,
    /** Paths only: diagnostics never retain or expose the rejected value. */
    issues: Schema.Array(Schema.String),
  },
) {}

/** Raised after successful execution when the public output does not match its Schema. */
export class WorkflowOutputValidationError extends Schema.TaggedError<WorkflowOutputValidationError>()(
  'WorkflowOutputValidationError',
  {
    workflowId: Schema.String,
    message: Schema.String,
    /** Paths only: diagnostics never retain or expose the rejected value. */
    issues: Schema.Array(Schema.String),
  },
) {}
