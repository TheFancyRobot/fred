/**
 * Shared MiniMax error types and normalization helpers.
 *
 * Provides:
 * - `MiniMaxMissingApiKeyError`: Thrown when the API key is absent
 * - `normalizeHttpError`: Maps raw HTTP/transport errors into a
 *   structured classification for consistent retry/fail decisions
 *   across all capability adapters
 *
 * Per-capability error types (MiniMaxImageError, MiniMaxVideoError, etc.)
 * remain in their respective adapter modules for typed `catchTag` usage.
 * They all share the same structural shape (`module`, `method`,
 * `description`, `cause?`) defined by the `MiniMaxErrorFields` interface
 * exported here.
 */

import { Data } from 'effect';
import { classifyHttpError, type ErrorClassification, formatHttpErrorMessage } from './config';

// ─── Shared Error Fields ──────────────────────────────────────────────────────

/**
 * Common fields for all MiniMax capability errors.
 *
 * Each capability adapter (image, video, music, speech, voice) defines
 * its own `Data.TaggedError` subclass with these fields so consumers
 * can `catchTag` on a specific capability error while relying on a
 * uniform field shape for logging and diagnostics.
 */
export interface MiniMaxErrorFields {
  readonly module: string;
  readonly method: string;
  readonly description: string;
  readonly cause?: unknown;
}

/**
 * Format a MiniMax error message from shared fields.
 * Provides a consistent `[module.method] description` format
 * across all capability error types.
 */
export function formatMiniMaxErrorMessage(fields: MiniMaxErrorFields): string {
  return `[${fields.module}.${fields.method}] ${fields.description}`;
}

// ─── Missing API Key Error ────────────────────────────────────────────────────

/**
 * Error thrown when the MiniMax API key is missing.
 *
 * This is a shared error across all capabilities since API key
 * resolution happens at the provider factory level (before any
 * capability adapter is created).
 */
export class MiniMaxMissingApiKeyError extends Data.TaggedError(
  'MiniMaxMissingApiKeyError'
)<{
  readonly provider: string;
  readonly envVar: string;
}> {
  get message(): string {
    return `MiniMax API key not found. Set ${this.envVar} environment variable.`;
  }
}

// ─── Error Normalization ──────────────────────────────────────────────────────

/**
 * Result of normalizing a raw HTTP/transport error into a structured form.
 * Extends `ErrorClassification` with a ready-to-use description string
 * for constructing capability-specific `Data.TaggedError` instances.
 */
export interface NormalizedError extends ErrorClassification {
  /** Pre-formatted description string suitable for error construction */
  readonly description: string;
}

/**
 * Normalize a raw HTTP or transport error into a structured form
 * with a pre-formatted description.
 *
 * This is the shared error mapping layer used by all capability
 * adapters. Each adapter calls this and then wraps the result in
 * its own typed `Data.TaggedError` (e.g. `MiniMaxImageError`).
 *
 * @param error - The raw error from an HTTP request
 * @param module - The adapter module name (e.g. 'MiniMaxImageAdapter')
 * @param method - The method name (e.g. 'generate')
 * @param attemptCount - Optional count of attempts before failure
 * @returns A `NormalizedError` with classification and description
 */
export function normalizeHttpError(
  error: unknown,
  _module: string,
  _method: string,
  attemptCount?: number
): NormalizedError {
  const classification = classifyHttpError(error);
  const description = formatHttpErrorMessage(classification, attemptCount);
  return {
    ...classification,
    description,
  };
}

/**
 * Build error fields from a raw HTTP error, ready to pass to a
 * capability-specific `Data.TaggedError` constructor.
 *
 * @param error - The raw error from an HTTP request
 * @param module - The adapter module name (e.g. 'MiniMaxImageAdapter')
 * @param method - The method name (e.g. 'generate')
 * @param attemptCount - Optional count of attempts before failure
 * @returns Fields object matching `MiniMaxErrorFields` with `cause`
 */
export function buildErrorFields(
  error: unknown,
  module: string,
  method: string,
  attemptCount?: number
): MiniMaxErrorFields & { cause: unknown } {
  const normalized = normalizeHttpError(error, module, method, attemptCount);
  return {
    module,
    method,
    description: normalized.description,
    cause: error,
  };
}
