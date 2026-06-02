import { Schema } from 'effect';

/**
 * Error thrown when no Convex client is configured on the runtime.
 */
export class MissingConvexClientError extends Schema.TaggedError<MissingConvexClientError>()(
  'MissingConvexClientError',
  {
    message: Schema.String,
  },
) {}

/**
 * Error thrown when Convex runtime initialization or client loading fails.
 */
export class ConvexRuntimeLoadError extends Schema.TaggedError<ConvexRuntimeLoadError>()(
  'ConvexRuntimeLoadError',
  {
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/**
 * Error thrown when a Convex function call (query/mutation/action) fails.
 */
export class ConvexFunctionCallError extends Schema.TaggedError<ConvexFunctionCallError>()(
  'ConvexFunctionCallError',
  {
    message: Schema.String,
    functionName: Schema.String,
    functionType: Schema.Literal('query', 'mutation', 'action'),
    cause: Schema.optional(Schema.Unknown),
  },
) {}

/**
 * Error thrown when creating or executing a Convex-backed Fred tool fails.
 */
export class ConvexToolExecutionError extends Schema.TaggedError<ConvexToolExecutionError>()(
  'ConvexToolExecutionError',
  {
    toolId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
