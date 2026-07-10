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
