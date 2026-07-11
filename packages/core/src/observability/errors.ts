/**
 * Error taxonomy, classification, and redaction utilities for observability.
 *
 * Provides error severity mapping, span status handling, and payload redaction
 * to ensure safe and meaningful error logging in traces and logs.
 *
 * @module src/core/observability/errors
 */

import { Effect, LogLevel } from 'effect';
import type { Span } from '../tracing/tracer';

/**
 * Error classification categories for Fred errors.
 */
export enum ErrorClass {
  /** Transient errors that can be retried (network timeouts, rate limits) */
  RETRYABLE = 'retryable',
  /** User input errors (validation failures, invalid requests) */
  USER = 'user',
  /** Provider/model errors (API errors, quota exceeded) */
  PROVIDER = 'provider',
  /** Infrastructure errors (database connection, system failures) */
  INFRASTRUCTURE = 'infrastructure',
  /** Unknown/unclassified errors */
  UNKNOWN = 'unknown',
}

/**
 * Map error class to OpenTelemetry span status code.
 */
export function errorClassToSpanStatus(errorClass: ErrorClass): 'ok' | 'error' {
  switch (errorClass) {
    case ErrorClass.USER:
      // User errors are not system errors - mark span as ok
      return 'ok';
    case ErrorClass.RETRYABLE:
    case ErrorClass.PROVIDER:
    case ErrorClass.INFRASTRUCTURE:
    case ErrorClass.UNKNOWN:
      // System errors - mark span as error
      return 'error';
  }
}

/**
 * Map error class to Effect log level.
 */
export function errorClassToLogLevel(errorClass: ErrorClass): LogLevel.LogLevel {
  switch (errorClass) {
    case ErrorClass.USER:
      // User errors are warnings (expected behavior)
      return LogLevel.Warning;
    case ErrorClass.RETRYABLE:
      // Retryable errors logged at warning (may succeed on retry)
      return LogLevel.Warning;
    case ErrorClass.PROVIDER:
    case ErrorClass.INFRASTRUCTURE:
      // Provider and infrastructure errors are system errors
      return LogLevel.Error;
    case ErrorClass.UNKNOWN:
      // Unknown errors logged at error level
      return LogLevel.Error;
  }
}

/**
 * Classify an error based on its properties.
 */
export function classifyError(error: Error): ErrorClass {
  const message = error.message.toLowerCase();
  const name = error.name.toLowerCase();

  // Check for retryable errors
  if (
    message.includes('timeout') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('503') ||
    name.includes('timeout')
  ) {
    return ErrorClass.RETRYABLE;
  }

  // Check for user errors
  if (
    message.includes('validation') ||
    message.includes('invalid input') ||
    message.includes('bad request') ||
    message.includes('400') ||
    name.includes('validation')
  ) {
    return ErrorClass.USER;
  }

  // Check for provider errors
  if (
    message.includes('api key') ||
    message.includes('quota exceeded') ||
    message.includes('provider') ||
    message.includes('model') ||
    message.includes('401') ||
    message.includes('403')
  ) {
    return ErrorClass.PROVIDER;
  }

  // Check for infrastructure errors
  if (
    message.includes('database') ||
    message.includes('connection') ||
    message.includes('econnrefused') ||
    message.includes('storage') ||
    name.includes('database')
  ) {
    return ErrorClass.INFRASTRUCTURE;
  }

  return ErrorClass.UNKNOWN;
}

/**
 * Redaction filter function type.
 * Returns redacted version of the payload or null to remove entirely.
 */
export type RedactionFilter = (payload: unknown, context: RedactionContext) => unknown | null;

/**
 * Context for redaction decisions.
 */
export interface RedactionContext {
  /** Type of payload being redacted */
  payloadType: 'request' | 'response' | 'error' | 'metadata';
  /** Source of the payload (tool, provider, step) */
  source: string;
  /** Current log level */
  logLevel: LogLevel.LogLevel;
  /** Error class if applicable */
  errorClass?: ErrorClass;
}

export interface SecretRedactionOptions {
  readonly headers?: readonly string[];
  readonly paths?: readonly string[];
  readonly replacement?: string;
}

const DEFAULT_SECRET_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
] as const;

const DEFAULT_SECRET_PATHS = [
  'apiKey',
  'authToken',
  'token',
  'secret',
  'password',
  'headers.authorization',
  'headers.cookie',
] as const;

const normalizeFieldName = (value: string): string => value.toLowerCase().replace(/[-_]/g, '');

const redactSecretText = (value: string, replacement: string): string => value
  .replace(/\bBearer\s+[^\s,;]+/gi, `Bearer ${replacement}`)
  .replace(/\bfred_[A-Za-z0-9_-]{8,64}\.[A-Za-z0-9_-]{32,}\b/g, replacement)
  .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, replacement)
  .replace(/\b((?:OPENAI|ANTHROPIC|GOOGLE|GROQ|MISTRAL|DEEPSEEK)_API_KEY\s*[=:]\s*)[^\s,;]+/gi, `$1${replacement}`);

const pathMatches = (candidate: readonly string[], configured: readonly string[]): boolean => {
  const segments = configured.map((path) => path.split('.'));
  return segments.some((path) => path.length === candidate.length
    && path.every((segment, index) => segment === '*' || segment === candidate[index]));
};

/**
 * Returns a non-mutating copy with secret-shaped fields, configured dot paths,
 * arrays, Error values, and known token formats redacted.
 */
export function redactSecrets(
  payload: unknown,
  options: SecretRedactionOptions = {},
): unknown {
  const replacement = options.replacement ?? '[REDACTED]';
  const headers = new Set([...DEFAULT_SECRET_HEADERS, ...(options.headers ?? [])].map(normalizeFieldName));
  const paths = [...DEFAULT_SECRET_PATHS, ...(options.paths ?? [])];
  const seen = new WeakMap<object, unknown>();

  const visit = (value: unknown, path: readonly string[]): unknown => {
    if (typeof value === 'string') return redactSecretText(value, replacement);
    if (typeof value !== 'object' || value === null) return value;
    const cached = seen.get(value);
    if (cached !== undefined) return cached;

    if (Array.isArray(value)) {
      const copy: unknown[] = [];
      seen.set(value, copy);
      value.forEach((item, index) => copy.push(visit(item, [...path, String(index)])));
      return copy;
    }

    const copy: Record<string, unknown> = {};
    seen.set(value, copy);
    if (value instanceof Error) {
      copy.name = value.name;
      copy.message = redactSecretText(value.message, replacement);
      if (value.cause !== undefined) copy.cause = visit(value.cause, [...path, 'cause']);
    }
    for (const [key, item] of Object.entries(value)) {
      const nextPath = [...path, key];
      const normalized = normalizeFieldName(key);
      const secretField = headers.has(normalized)
        || /(?:apikey|authtoken|accesstoken|refreshtoken|secret|password|cookie)$/.test(normalized)
        || pathMatches(nextPath, paths);
      copy[key] = secretField ? replacement : visit(item, nextPath);
    }
    return copy;
  };

  return visit(payload, []);
}

/**
 * Default redaction filter: removes request/response bodies unless debug level.
 */
export function defaultRedactionFilter(payload: unknown, context: RedactionContext): unknown | null {
  // Debug payloads remain useful, but secret material is never emitted.
  if (context.logLevel === LogLevel.Debug || context.logLevel === LogLevel.Trace) {
    return redactSecrets(payload);
  }

  // For request/response payloads, redact at info level and above
  if (context.payloadType === 'request' || context.payloadType === 'response') {
    return '[REDACTED]';
  }

  // For errors, allow message but redact details unless debug
  if (context.payloadType === 'error' && typeof payload === 'object' && payload !== null) {
    const error = redactSecrets(payload);
    const safeError = typeof error === 'object' && error !== null ? error : {};
    return {
      message: Reflect.get(safeError, 'message'),
      name: Reflect.get(safeError, 'name'),
      // Stack only at debug level
    };
  }

  // Metadata can pass through
  return redactSecrets(payload);
}

/**
 * Redact a payload using the provided filter.
 */
export function redact(
  payload: unknown,
  context: RedactionContext,
  filter: RedactionFilter = defaultRedactionFilter
): unknown {
  try {
    return filter(payload, context);
  } catch {
    // Redaction failure must fail closed without logging the source value or cause.
    return '[REDACTION_ERROR]';
  }
}

/**
 * Attach error metadata to a span with classification.
 */
export function attachErrorToSpan(
  span: Span,
  error: Error,
  options?: {
    errorClass?: ErrorClass;
    includeStack?: boolean;
    metadata?: Record<string, unknown>;
  }
): void {
  const errorClass = options?.errorClass ?? classifyError(error);
  const spanStatus = errorClassToSpanStatus(errorClass);
  const safeMessage = redactSecrets(error.message);
  const message = typeof safeMessage === 'string' ? safeMessage : '[REDACTED]';

  // Set span status
  span.setStatus(spanStatus, message);

  // Add error attributes
  span.setAttributes({
    'error.class': errorClass,
    'error.type': error.name,
    'error.message': message,
  });

  // Add custom metadata if provided
  if (options?.metadata) {
    const redacted = redactSecrets(options.metadata);
    const safeMetadata = typeof redacted === 'object' && redacted !== null
      ? Object.fromEntries(Object.entries(redacted).filter((entry): entry is [string, string | number | boolean | string[] | number[] | boolean[]] => {
          const value = entry[1];
          return typeof value === 'string'
            || typeof value === 'number'
            || typeof value === 'boolean'
            || (Array.isArray(value) && value.every((item) => ['string', 'number', 'boolean'].includes(typeof item)));
        }))
      : {};
    span.setAttributes(safeMetadata);
  }

  // Record exception event (includes stack trace)
  if (options?.includeStack !== false) {
    span.recordException(new Error(message, { cause: error.cause }));
  }
}

/**
 * Log error with Effect logging and appropriate level.
 */
export function logError(
  error: Error,
  options?: {
    errorClass?: ErrorClass;
    includeStack?: boolean;
    metadata?: Record<string, unknown>;
  }
): Effect.Effect<void> {
  const errorClass = options?.errorClass ?? classifyError(error);
  const logLevel = errorClassToLogLevel(errorClass);

  const logData: Record<string, unknown> = {
    errorClass,
    errorType: error.name,
    errorMessage: error.message,
    ...options?.metadata,
  };

  // Include stack only at debug level or if explicitly requested
  const includeStack = options?.includeStack ?? false;
  if (includeStack) {
    logData.stack = error.stack;
  }

  const redactedData = redactSecrets(logData);
  const safeLogData = typeof redactedData === 'object' && redactedData !== null
    ? Object.fromEntries(Object.entries(redactedData))
    : { errorClass, errorType: error.name, errorMessage: '[REDACTED]' };
  const redactedMessage = redactSecrets(error.message);
  const message = typeof redactedMessage === 'string' ? redactedMessage : '[REDACTED]';

  // Log at appropriate level
  switch (logLevel) {
    case LogLevel.Warning:
      return Effect.logWarning(message).pipe(
        Effect.annotateLogs(safeLogData)
      );
    case LogLevel.Error:
      return Effect.logError(message).pipe(
        Effect.annotateLogs(safeLogData)
      );
    case LogLevel.Fatal:
      return Effect.logFatal(message).pipe(
        Effect.annotateLogs(safeLogData)
      );
    default:
      return Effect.logInfo(message).pipe(
        Effect.annotateLogs(safeLogData)
      );
  }
}

/**
 * Combined error handling: attach to span and log.
 */
export function handleError(
  error: Error,
  span: Span,
  options?: {
    errorClass?: ErrorClass;
    includeStack?: boolean;
    metadata?: Record<string, unknown>;
  }
): Effect.Effect<void> {
  // Attach to span
  attachErrorToSpan(span, error, options);

  // Log the error
  return logError(error, options);
}
