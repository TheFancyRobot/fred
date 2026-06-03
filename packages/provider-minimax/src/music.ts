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
} from './config';
import {
  MiniMaxErrorFields,
  formatMiniMaxErrorMessage,
  buildErrorFields,
} from './errors';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * MiniMax music generation API endpoint (appended to base URL).
 */
export const MINIMAX_MUSIC_ENDPOINT = '/music_generation' as const;

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax music generation failures.
 */
export class MiniMaxMusicError extends Data.TaggedError(
  'MiniMaxMusicError'
)<MiniMaxErrorFields> {
  get message(): string {
    return formatMiniMaxErrorMessage(this);
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
      const client = createAuthenticatedClient(httpClient, apiKey, baseUrl);

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

      const response = yield* client.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const fields = buildErrorFields(error, 'MiniMaxMusicAdapter', 'generate');
          return Effect.fail(new MiniMaxMusicError(fields));
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
          description: formatApiErrorMessage(json.base_resp.status_code, json.base_resp.status_msg),
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
