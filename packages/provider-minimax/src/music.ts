/**
 * MiniMax music generation capability adapter.
 *
 * Implements music generation using MiniMax's native Music Generation API.
 * Generates songs from text prompts and optional lyrics.
 *
 * API Reference: https://platform.minimax.io/docs/api-reference/music-generation
 * Endpoint: POST /v1/music_generation
 *
 * Design choices:
 * - Uses @effect/platform HttpClient for HTTP requests (consistent with language.ts).
 * - Uses Data.TaggedError for typed, catchable MiniMax music errors.
 * - Music generation returns audio data directly in response.
 * - Supports optional lyrics; if omitted, MiniMax auto-generates them from the prompt.
 */

import { Data, Effect, Layer, Schedule } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import { FetchHttpClient } from '@effect/platform';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * MiniMax music generation API endpoint (appended to base URL).
 */
export const MINIMAX_MUSIC_ENDPOINT = '/music_generation' as const;

/**
 * Retry configuration for transient MiniMax music API failures.
 */
const MUSIC_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
} as const;

/**
 * HTTP status codes that are non-retryable (client errors).
 */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax music generation failures.
 */
export class MiniMaxMusicError extends Data.TaggedError(
  'MiniMaxMusicError'
)<{
  readonly module: string;
  readonly method: string;
  readonly description: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return `[${this.module}.${this.method}] ${this.description}`;
  }
}

// ─── Request/Response Types ───────────────────────────────────────────────────

/**
 * Input shape for music generation requests.
 */
export interface MusicGenerationInput {
  /** Model ID (e.g. 'music-01', 'music-02') */
  model: string;
  /** Text prompt describing the desired music style/mood */
  prompt: string;
  /** Lyrics for the song (10–1000 chars). If omitted, MiniMax auto-generates from prompt. */
  lyrics?: string;
  /** Optional vocal style (e.g. 'male', 'female', 'instrumental') */
  vocal_style?: string;
  /** Optional seed for reproducibility */
  seed?: number;
  /** Optional reference audio URL for cover/inspired-by generation */
  reference_audio_url?: string;
}

/**
 * Normalized music generation response.
 */
export interface MusicGenerationResult {
  /** URL to the generated audio file */
  audio_url?: string;
  /** The generated lyrics (if auto-generated) */
  lyrics?: string;
  /** Additional data from MiniMax (e.g. task_id for async results) */
  extra?: Record<string, unknown>;
  /** The model used for generation */
  model: string;
  /** The request ID from MiniMax */
  request_id?: string;
}

/**
 * MiniMax raw API response shape for music generation.
 */
interface MiniMaxMusicResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  audio_url?: string;
  lyrics?: string;
  request_id?: string;
  task_id?: string;
  [key: string]: unknown;
}

// ─── Error Classification ──────────────────────────────────────────────────────

interface ErrorClassification {
  retryable: boolean;
  statusCode?: number;
  category: 'transient' | 'rate-limit' | 'non-retryable';
}

function classifyHttpError(error: unknown): ErrorClassification {
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

function buildRetrySchedule() {
  return Schedule.intersect(
    Schedule.exponential(Duration.millis(MUSIC_RETRY_CONFIG.baseDelayMs)),
    Schedule.recurs(MUSIC_RETRY_CONFIG.maxRetries)
  );
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

/**
 * MiniMax music generation adapter.
 *
 * Provides a `generate` method that calls MiniMax's music generation API
 * and returns normalized results.
 */
export interface MiniMaxMusicAdapter {
  readonly capability: 'music';
  readonly generate: (input: MusicGenerationInput) => Effect.Effect<MusicGenerationResult, MiniMaxMusicError>;
}

/**
 * Create a MiniMax music generation adapter.
 *
 * @param apiKey - MiniMax API key
 * @param baseUrl - MiniMax API base URL (e.g. 'https://api.minimax.chat/v1')
 * @returns Music adapter with `generate` method
 */
export function createMiniMaxMusicAdapter(
  apiKey: string,
  baseUrl: string
): MiniMaxMusicAdapter {
  const generate = Effect.fn('MiniMaxMusicAdapter.generate')(function* (
    input: MusicGenerationInput
  ): Effect.Effect<MusicGenerationResult, MiniMaxMusicError> {
    return yield* Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientWithBaseUrl = httpClient.pipe(
        HttpClient.mapRequest((request) =>
          request.pipe(
            HttpClientRequest.prependUrl(baseUrl),
            HttpClientRequest.bearerToken(apiKey),
            HttpClientRequest.setHeader('Content-Type', 'application/json')
          )
        )
      );
      const clientWithBaseUrlOk = HttpClient.filterStatusOk(clientWithBaseUrl);

      const requestBody: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        ...(input.lyrics && { lyrics: input.lyrics }),
        ...(input.vocal_style && { vocal_style: input.vocal_style }),
        ...(input.seed !== undefined && { seed: input.seed }),
        ...(input.reference_audio_url && { reference_audio_url: input.reference_audio_url }),
      };

      const request = HttpClientRequest.post(MINIMAX_MUSIC_ENDPOINT, {
        body: HttpBody.unsafeJson(requestBody),
      });

      const response = yield* clientWithBaseUrlOk.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const classification = classifyHttpError(error);
          return Effect.fail(new MiniMaxMusicError({
            module: 'MiniMaxMusicAdapter',
            method: 'generate',
            description: classification.retryable
              ? `HTTP request failed after retries (${classification.category})`
              : `HTTP request failed: non-retryable ${classification.statusCode} error`,
            cause: error,
          }));
        })
      );

      const json = yield* (response.json as Effect.Effect<unknown, unknown>).pipe(
        Effect.catchAll((error) =>
          Effect.fail(new MiniMaxMusicError({
            module: 'MiniMaxMusicAdapter',
            method: 'generate',
            description: 'Failed to parse music generation response JSON',
            cause: error,
          }))
        )
      ) as MiniMaxMusicResponse;

      // Check for API-level errors
      if (json.base_resp && json.base_resp.status_code !== 0) {
        return yield* Effect.fail(new MiniMaxMusicError({
          module: 'MiniMaxMusicAdapter',
          method: 'generate',
          description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
        }));
      }

      // Collect extra fields beyond the known ones
      const knownKeys = new Set(['base_resp', 'audio_url', 'lyrics', 'request_id', 'task_id']);
      const extra: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(json)) {
        if (!knownKeys.has(key)) {
          extra[key] = value;
        }
      }

      return {
        audio_url: json.audio_url,
        lyrics: json.lyrics,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
        model: input.model,
        request_id: json.request_id,
      };
    });
  });

  return {
    capability: 'music',
    generate,
  };
}
