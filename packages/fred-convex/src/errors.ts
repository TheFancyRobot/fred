import { Schema } from 'effect';

/**
 * Error thrown when Convex runtime initialization fails.
 */
export class ConvexRuntimeInitError extends Schema.TaggedError<ConvexRuntimeInitError>()(
  'ConvexRuntimeInitError',
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
 * Error thrown when creating a Convex tool adapter fails.
 */
export class ConvexToolCreateError extends Schema.TaggedError<ConvexToolCreateError>()(
  'ConvexToolCreateError',
  {
    message: Schema.String,
    toolName: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
