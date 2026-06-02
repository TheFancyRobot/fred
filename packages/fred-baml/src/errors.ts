import { Schema } from 'effect';

export class MissingBamlClientError extends Schema.TaggedError<MissingBamlClientError>()(
  'MissingBamlClientError',
  {
    moduleId: Schema.String,
    message: Schema.String,
  },
) {}

export class BamlRuntimeLoadError extends Schema.TaggedError<BamlRuntimeLoadError>()(
  'BamlRuntimeLoadError',
  {
    moduleId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}

export class UnsupportedBamlStreamingError extends Schema.TaggedError<UnsupportedBamlStreamingError>()(
  'UnsupportedBamlStreamingError',
  {
    toolId: Schema.String,
    message: Schema.String,
  },
) {}

export class BamlToolExecutionError extends Schema.TaggedError<BamlToolExecutionError>()(
  'BamlToolExecutionError',
  {
    toolId: Schema.String,
    message: Schema.String,
    cause: Schema.optional(Schema.Unknown),
  },
) {}
