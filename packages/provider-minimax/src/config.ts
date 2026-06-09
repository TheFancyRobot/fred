/**
 * Shared MiniMax provider configuration, constants, and HTTP helpers.
 *
 * Centralizes duplicated infrastructure previously repeated in each
 * capability adapter (language, image, video, music, speech, voice):
 * - Default base URL and API key env var
 * - Retry configuration and schedule builder
 * - HTTP error classification
 * - Authenticated HTTP client factory
 *
 * All capability adapters import from this module to avoid drift.
 */

import { Effect, Schedule } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Default MiniMax API base URL for OpenAI-compatible endpoints.
 */
export const MINIMAX_DEFAULT_BASE_URL = 'https://api.minimax.io/v1';

/**
 * Default MiniMax API base URL for native multi-modality endpoints.
 */
export const MINIMAX_NATIVE_BASE_URL = 'https://api.minimax.io/v1';

/**
 * Default environment variable name for the MiniMax API key.
 */
export const MINIMAX_API_KEY_ENV_VAR = 'MINIMAX_API_KEY';

/**
 * Retry configuration for transient MiniMax API failures.
 * Max 3 retries with exponential backoff: 500ms → 1s → 2s.
 */
export const MINIMAX_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
} as const;

/**
 * HTTP status codes that are non-retryable (client errors).
 */
export const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

// ─── Error Classification ──────────────────────────────────────────────────────

/**
 * Classification result for HTTP errors.
 * Used by all capability adapters to decide retry behavior and
 * construct descriptive error messages.
 */
export interface ErrorClassification {
  readonly retryable: boolean;
  readonly statusCode?: number;
  readonly category: 'transient' | 'rate-limit' | 'non-retryable';
}

/**
 * Classify an HTTP error as retryable or not based on status code.
 *
 * - 429 (rate limit): retryable
 * - 5xx (server errors): retryable (transient)
 * - 400, 401, 403, 404, 422 (client errors): non-retryable
 * - Network/connection errors (no status): retryable (transient)
 */
export function classifyHttpError(error: unknown): ErrorClassification {
  if (error && typeof error === 'object' && 'response' in error) {
    const responseError = error as { response?: { status?: number } };
    const status = responseError.response?.status;
    if (typeof status === 'number') {
      if (status === 429) {
        return { retryable: true, statusCode: status, category: 'rate-limit' };
      }
      if (NON_RETRYABLE_STATUS_CODES.has(status)) {
        return { retryable: false, statusCode: status, category: 'non-retryable' };
      }
      if (status >= 500) {
        return { retryable: true, statusCode: status, category: 'transient' };
      }
    }
  }
  return { retryable: true, category: 'transient' };
}

// ─── Retry Schedule ───────────────────────────────────────────────────────────

/**
 * Build a retry schedule for transient errors.
 * Exponential backoff: baseDelay * 2^attempt, capped at maxRetries.
 */
export function buildRetrySchedule() {
  return Schedule.intersect(
    Schedule.exponential(Duration.millis(MINIMAX_RETRY_CONFIG.baseDelayMs)),
    Schedule.recurs(MINIMAX_RETRY_CONFIG.maxRetries)
  );
}

// ─── HTTP Client Factory ──────────────────────────────────────────────────────

/**
 * Create an authenticated MiniMax HTTP client with base URL and auth headers.
 *
 * Returns a client that:
 * 1. Prepends the base URL to all requests
 * 2. Sets the Bearer token from the API key
 * 3. Sets Content-Type to application/json
 * 4. Filters for OK status responses (2xx)
 *
 * This is the shared client setup previously duplicated in every
 * adapter method body.
 */
export function createAuthenticatedClient(
  httpClient: HttpClient.HttpClient,
  apiKey: string,
  baseUrl: string
): HttpClient.HttpClient {
  const clientWithBaseUrl = httpClient.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(baseUrl),
        HttpClientRequest.bearerToken(apiKey),
        HttpClientRequest.setHeader('Content-Type', 'application/json')
      )
    )
  );
  return HttpClient.filterStatusOk(clientWithBaseUrl);
}

/**
 * Create an authenticated MiniMax HTTP client WITHOUT status filtering.
 *
 * Use this when you need to inspect the raw HTTP response (e.g. for
 * streaming where 200 may carry SSE data but you handle parsing yourself).
 */
export function createAuthenticatedClientRaw(
  httpClient: HttpClient.HttpClient,
  apiKey: string,
  baseUrl: string
): HttpClient.HttpClient {
  return httpClient.pipe(
    HttpClient.mapRequest((request) =>
      request.pipe(
        HttpClientRequest.prependUrl(baseUrl),
        HttpClientRequest.bearerToken(apiKey),
        HttpClientRequest.setHeader('Content-Type', 'application/json')
      )
    )
  );
}

// ─── Error Message Helpers ───────────────────────────────────────────────────

/**
 * Build a descriptive error message from an error classification.
 * Used uniformly across all capability adapters.
 */
export function formatHttpErrorMessage(
  classification: ErrorClassification,
  attemptCount?: number
): string {
  if (classification.retryable) {
    const attempts = attemptCount !== undefined ? `after ${attemptCount} attempt(s)` : 'after retries';
    return `HTTP request failed ${attempts} (${classification.category})`;
  }
  return `HTTP request failed: non-retryable ${classification.statusCode} error`;
}

/**
 * Build an API-level error message from MiniMax base_resp fields.
 * Used uniformly across all capability adapters that receive
 * `base_resp.status_code` and `base_resp.status_msg`.
 */
export function formatApiErrorMessage(statusCode: number, statusMsg: string): string {
  return `MiniMax API error: ${statusMsg} (code: ${statusCode})`;
}
