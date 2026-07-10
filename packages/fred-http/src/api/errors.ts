import { HttpApiSchema } from '@effect/platform';
import { Schema } from 'effect';

const errorFields = { message: Schema.String };

export class InvalidRequestError extends Schema.TaggedError<InvalidRequestError>()(
  'InvalidRequestError',
  { ...errorFields, issues: Schema.optional(Schema.Array(Schema.String)) },
  HttpApiSchema.annotations({ status: 400 })
) {}

export class UnauthorizedError extends Schema.TaggedError<UnauthorizedError>()(
  'UnauthorizedError', errorFields, HttpApiSchema.annotations({ status: 401 })
) {}

export class RequestTimeoutError extends Schema.TaggedError<RequestTimeoutError>()(
  'RequestTimeoutError', errorFields, HttpApiSchema.annotations({ status: 408 })
) {}

export class PayloadTooLargeError extends Schema.TaggedError<PayloadTooLargeError>()(
  'PayloadTooLargeError', errorFields, HttpApiSchema.annotations({ status: 413 })
) {}

export class RateLimitExceededError extends Schema.TaggedError<RateLimitExceededError>()(
  'RateLimitExceededError', errorFields, HttpApiSchema.annotations({ status: 429 })
) {}

export class InternalServerError extends Schema.TaggedError<InternalServerError>()(
  'InternalServerError', errorFields, HttpApiSchema.annotations({ status: 500 })
) {}

export class StreamingNotImplementedError extends Schema.TaggedError<StreamingNotImplementedError>()(
  'StreamingNotImplementedError', errorFields, HttpApiSchema.annotations({ status: 501 })
) {}

export const GenericErrorResponse = Schema.Struct({
  success: Schema.Literal(false),
  error: Schema.String,
}).annotations({ identifier: 'GenericErrorResponse' });

export const OpenAiErrorResponse = Schema.Struct({
  error: Schema.Struct({
    message: Schema.String,
    type: Schema.String,
    code: Schema.optional(Schema.String),
  }),
}).annotations({ identifier: 'OpenAiErrorResponse' });
