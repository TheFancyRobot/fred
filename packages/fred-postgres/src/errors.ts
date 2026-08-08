import { Schema } from 'effect';

export class PostgresConfigurationError extends Schema.TaggedError<PostgresConfigurationError>()(
  'PostgresConfigurationError',
  { message: Schema.String },
) {}

export class PostgresOperationError extends Schema.TaggedError<PostgresOperationError>()(
  'PostgresOperationError',
  { operation: Schema.String, message: Schema.String },
) {}

export class PostgresMigrationChecksumError extends Schema.TaggedError<PostgresMigrationChecksumError>()(
  'PostgresMigrationChecksumError',
  { module: Schema.String, version: Schema.Number, expected: Schema.String, actual: Schema.String, message: Schema.String },
) {}

export class PostgresMigrationLockTimeoutError extends Schema.TaggedError<PostgresMigrationLockTimeoutError>()(
  'PostgresMigrationLockTimeoutError',
  { schema: Schema.String, timeoutMs: Schema.Number, message: Schema.String },
) {}

export class PgvectorRequiredError extends Schema.TaggedError<PgvectorRequiredError>()(
  'PgvectorRequiredError',
  { message: Schema.String },
) {}

export type FredPostgresError =
  | PostgresConfigurationError
  | PostgresOperationError
  | PostgresMigrationChecksumError
  | PostgresMigrationLockTimeoutError
  | PgvectorRequiredError;
