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

export class LegacyPostgresImportError extends Schema.TaggedError<LegacyPostgresImportError>()(
  'LegacyPostgresImportError',
  { operation: Schema.String, table: Schema.String, message: Schema.String },
) {}

/** A configured encryption key is unavailable or has an invalid length. */
export class ProviderCredentialKeyError extends Schema.TaggedError<ProviderCredentialKeyError>()(
  'ProviderCredentialKeyError',
  { keyId: Schema.String, message: Schema.String },
) {}

/** A credential envelope could not be authenticated, decrypted, or decoded. */
export class ProviderCredentialEncryptionError extends Schema.TaggedError<ProviderCredentialEncryptionError>()(
  'ProviderCredentialEncryptionError',
  { connectionId: Schema.String, message: Schema.String },
) {}

/** A credential write lost its optimistic-version race. */
export class ProviderCredentialVersionConflictError extends Schema.TaggedError<ProviderCredentialVersionConflictError>()(
  'ProviderCredentialVersionConflictError',
  { connectionId: Schema.String, expectedVersion: Schema.Number, message: Schema.String },
) {}

/** A provider-connection query or transaction failed without exposing credentials. */
export class ProviderConnectionStorageError extends Schema.TaggedError<ProviderConnectionStorageError>()(
  'ProviderConnectionStorageError',
  { operation: Schema.String, message: Schema.String },
) {}

export type FredPostgresError =
  | PostgresConfigurationError
  | PostgresOperationError
  | PostgresMigrationChecksumError
  | PostgresMigrationLockTimeoutError
  | PgvectorRequiredError
  | LegacyPostgresImportError
  | ProviderCredentialKeyError
  | ProviderCredentialEncryptionError
  | ProviderCredentialVersionConflictError
  | ProviderConnectionStorageError;
