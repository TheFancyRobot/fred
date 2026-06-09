/**
 * MiniMax lyrics generation capability adapter.
 *
 * Implements lyrics generation using MiniMax's native Lyrics Generation API.
 * Generates song lyrics from text prompts, with support for full song
 * writing and editing existing lyrics.
 *
 * API Reference: https://platform.minimax.io/docs/api-reference/lyrics-generation
 * Endpoint: POST /v1/lyrics_generation
 * Domain: https://api.minimax.io (NOT https://api.minimax.chat)
 *
 * Design choices:
 * - Uses @effect/platform HttpClient for HTTP requests (consistent with other adapters).
 * - Uses Data.TaggedError for typed, catchable MiniMax lyrics errors.
 * - Lyrics generation is synchronous: returns results directly in response.
 * - Only documented request keys are sent (mode, prompt, lyrics, title).
 * - In write_full_song mode, lyrics param is omitted from request body.
 * - Retries on transport-level errors (5xx, 429) AND on base_resp 1002 (rate limit).
 * - Non-retryable base_resp codes (1004, 1008, 1026, 2013, 2049) fail immediately.
 * - Shared config/errors/helpers imported from ./config and ./errors.
 */

import { Data, Effect, Schedule } from 'effect';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import {
  classifyHttpError,
  buildRetrySchedule,
  createAuthenticatedClient,
  formatApiErrorMessage,
  MINIMAX_DEFAULT_BASE_URL,
} from './config';
import {
  MiniMaxErrorFields,
  formatMiniMaxErrorMessage,
  buildErrorFields,
} from './errors';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * MiniMax lyrics generation API endpoint (appended to the /v1 base URL).
 */
export const MINIMAX_LYRICS_ENDPOINT = '/lyrics_generation' as const;

/**
 * Maximum prompt length per MiniMax API documentation.
 */
const PROMPT_MAX_LENGTH = 2000;

/**
 * Maximum lyrics length per MiniMax API documentation.
 */
const LYRICS_MAX_LENGTH = 3500;

/**
 * base_resp status codes that are retryable (transient errors).
 * 1002 = rate limit — back off and retry.
 */
const RETRYABLE_BASE_RESP_CODES = new Set([1002]);

/**
 * base_resp status codes that are non-retryable (permanent errors).
 * 1004 = not authorized
 * 1008 = insufficient balance
 * 1026 = sensitive input
 * 2013 = invalid params
 * 2049 = invalid API key
 */
const NON_RETRYABLE_BASE_RESP_CODES = new Set([1004, 1008, 1026, 2013, 2049]);

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Extended error fields for lyrics errors, carrying an optional
 * base_resp status code for retryability classification.
 */
export interface LyricsErrorFields extends MiniMaxErrorFields {
  /** MiniMax base_resp status_code, if the error originated from base_resp */
  readonly base_resp_code?: number;
}

/**
 * Error thrown for MiniMax lyrics generation failures.
 *
 * Carries an optional `base_resp_code` so the retry classifier can
 * distinguish retryable (1002) from non-retryable base_resp errors.
 */
export class MiniMaxLyricsError extends Data.TaggedError(
  'MiniMaxLyricsError'
)<LyricsErrorFields> {
  get message(): string {
    return formatMiniMaxErrorMessage(this);
  }
}

// ─── Retryability Classification ─────────────────────────────────────────────

/**
 * Classify a lyrics error as retryable or not.
 *
 * Retryable conditions:
 * - Transport errors: 429 (rate limit), 5xx (server), network failures
 * - base_resp 1002: MiniMax rate limit — transient, back off and retry
 *
 * Non-retryable conditions:
 * - Transport errors: 400, 401, 403, 404, 422 (client errors)
 * - base_resp 1004, 1008, 1026, 2013, 2049 (permanent errors)
 * - Input validation failures (no base_resp_code)
 * - Malformed JSON / missing fields (no base_resp_code)
 *
 * @param error - The error to classify (may be a raw HTTP error or MiniMaxLyricsError)
 * @returns true if the error is retryable
 */
export function isLyricsErrorRetryable(error: unknown): boolean {
  // MiniMaxLyricsError with base_resp_code 1002 → retryable
  if (error instanceof MiniMaxLyricsError) {
    if (error.base_resp_code !== undefined) {
      if (RETRYABLE_BASE_RESP_CODES.has(error.base_resp_code)) return true;
      if (NON_RETRYABLE_BASE_RESP_CODES.has(error.base_resp_code)) return false;
      return false;
    }
    // Lyrics errors without a base_resp_code (validation, parse, missing fields)
    // are not retryable — they indicate client-side or structural issues.
    return false;
  }
  // Raw transport/HTTP errors — delegate to shared classifier
  return classifyHttpError(error).retryable;
}

// ─── Request/Response Types ───────────────────────────────────────────────────

/**
 * Input shape for lyrics generation requests.
 *
 * Only documented keys are accepted. The following keys from other
 * MiniMax APIs are intentionally excluded:
 * - model (not part of lyrics_generation)
 * - stream (no streaming for lyrics)
 * - task_id (this is a response field, not a request field)
 * - temperature (no temperature control for lyrics)
 * - seed (no reproducibility param for lyrics)
 */
export interface LyricsGenerationInput {
  /** Generation mode: "write_full_song" creates new lyrics, "edit" modifies existing */
  mode: 'write_full_song' | 'edit';
  /** Text prompt describing the desired lyrics (max 2000 chars; empty = random song) */
  prompt: string;
  /** Existing lyrics to edit (max 3500 chars; only effective in edit mode) */
  lyrics?: string;
  /** Optional song title — preserved in output if provided */
  title?: string;
}

/**
 * Normalized lyrics generation response.
 */
export interface LyricsGenerationResult {
  /** The generated song title */
  song_title: string;
  /** Comma-separated style/mood tags */
  style_tags: string;
  /** Generated lyrics with structure tags (e.g. [Verse 1], [Chorus]) */
  lyrics: string;
  /** MiniMax API status response */
  base_resp: {
    status_code: number;
    status_msg: string;
  };
}

/**
 * MiniMax raw API response shape for lyrics generation.
 */
interface MiniMaxLyricsResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  song_title?: string;
  style_tags?: string;
  lyrics?: string;
  [key: string]: unknown;
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

/**
 * MiniMax lyrics generation adapter.
 *
 * Provides a `generate` method that calls MiniMax's lyrics generation API
 * and returns normalized results. Retries on transport-level transient
 * errors AND on base_resp 1002 (rate limit).
 */
export interface MiniMaxLyricsAdapter {
  readonly capability: 'lyrics';
  readonly generate: (input: LyricsGenerationInput) => Effect.Effect<LyricsGenerationResult, MiniMaxLyricsError>;
}

/**
 * Create a MiniMax lyrics generation adapter.
 *
 * @param apiKey - MiniMax API key
 * @param baseUrl - MiniMax API base URL (defaults to 'https://api.minimax.io/v1')
 * @returns Lyrics adapter with `generate` method
 */
export function createMiniMaxLyricsAdapter(
  apiKey: string,
  baseUrl: string = MINIMAX_DEFAULT_BASE_URL
): MiniMaxLyricsAdapter {
  const generate = Effect.fn('MiniMaxLyricsAdapter.generate')(function* (
    input: LyricsGenerationInput
  ): Effect.Effect<LyricsGenerationResult, MiniMaxLyricsError> {
    return yield* Effect.gen(function* () {
      // ─── Input Validation ─────────────────────────────────────────────

      if (input.prompt.length > PROMPT_MAX_LENGTH) {
        return yield* Effect.fail(new MiniMaxLyricsError({
          module: 'MiniMaxLyricsAdapter',
          method: 'generate',
          description: `Prompt exceeds maximum length of ${PROMPT_MAX_LENGTH} characters (got ${input.prompt.length})`,
        }));
      }

      if (input.lyrics && input.lyrics.length > LYRICS_MAX_LENGTH) {
        return yield* Effect.fail(new MiniMaxLyricsError({
          module: 'MiniMaxLyricsAdapter',
          method: 'generate',
          description: `Lyrics exceed maximum length of ${LYRICS_MAX_LENGTH} characters (got ${input.lyrics.length})`,
        }));
      }

      // ─── Build Request Body ───────────────────────────────────────────

      // Only send documented keys; omit lyrics in write_full_song mode
      // since it is only effective in edit mode per API docs.
      const requestBody: Record<string, unknown> = {
        mode: input.mode,
        prompt: input.prompt,
        // lyrics only included for edit mode
        ...(input.mode === 'edit' && input.lyrics && { lyrics: input.lyrics }),
        ...(input.title && { title: input.title }),
      };

      // ─── Execute and parse within retry scope ─────────────────────────
      //
      // The retry scope covers the entire request+parse+base_resp check
      // so that base_resp 1002 (rate limit) triggers a retry, not just
      // transport-level errors. This differs from other adapters (image,
      // video, music) which only retry transport errors — lyrics is the
      // first adapter to require base_resp-level retry.

      const performRequest = Effect.gen(function* () {
        const httpClient = yield* HttpClient.HttpClient;
        const client = createAuthenticatedClient(httpClient, apiKey, baseUrl);

        const request = HttpClientRequest.post(MINIMAX_LYRICS_ENDPOINT, {
          body: HttpBody.unsafeJson(requestBody),
        });

        // Transport-level request: let raw errors propagate so
        // classifyHttpError can assess retryability in the retry loop.
        const response = yield* client.execute(request);

        // ─── Parse Response ───────────────────────────────────────────

        const json = yield* (response.json as Effect.Effect<unknown, unknown>).pipe(
          Effect.catchAll((error) =>
            Effect.fail(new MiniMaxLyricsError({
              module: 'MiniMaxLyricsAdapter',
              method: 'generate',
              description: 'Failed to parse lyrics generation response JSON',
              cause: error,
            }))
          )
        ) as MiniMaxLyricsResponse;

        // ─── Handle Missing base_resp ─────────────────────────────────

        if (!json.base_resp) {
          return yield* Effect.fail(new MiniMaxLyricsError({
            module: 'MiniMaxLyricsAdapter',
            method: 'generate',
            description: 'Missing base_resp in lyrics generation response',
          }));
        }

        // ─── Handle base_resp Errors ──────────────────────────────────

        if (json.base_resp.status_code !== 0) {
          return yield* Effect.fail(new MiniMaxLyricsError({
            module: 'MiniMaxLyricsAdapter',
            method: 'generate',
            description: formatApiErrorMessage(json.base_resp.status_code, json.base_resp.status_msg),
            base_resp_code: json.base_resp.status_code,
          }));
        }

        // ─── Handle Missing Lyrics in Response ────────────────────────

        if (!json.lyrics) {
          return yield* Effect.fail(new MiniMaxLyricsError({
            module: 'MiniMaxLyricsAdapter',
            method: 'generate',
            description: 'Missing lyrics in lyrics generation response',
          }));
        }

        // ─── Return Normalized Result ─────────────────────────────────

        return {
          song_title: json.song_title ?? '',
          style_tags: json.style_tags ?? '',
          lyrics: json.lyrics,
          base_resp: json.base_resp,
        } satisfies LyricsGenerationResult;
      });

      // ─── Retry on transport errors AND base_resp 1002 ────────────────

      const result = yield* performRequest.pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput(isLyricsErrorRetryable)
          )
        ),
        // After retries exhausted, wrap any remaining raw transport errors
        Effect.catchAll((error) => {
          if (error instanceof MiniMaxLyricsError) return Effect.fail(error);
          const fields = buildErrorFields(error, 'MiniMaxLyricsAdapter', 'generate');
          return Effect.fail(new MiniMaxLyricsError(fields));
        })
      );

      return result;
    });
  });

  return {
    capability: 'lyrics',
    generate,
  };
}
