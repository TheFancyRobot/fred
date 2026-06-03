/**
 * MiniMax speech / text-to-speech capability adapter.
 *
 * Implements TTS using MiniMax's native Speech API.
 * Supports synchronous HTTP TTS and async long-form TTS.
 *
 * API References:
 * - T2A HTTP: https://platform.minimax.io/docs/api-reference/speech-t2a-http
 *   Endpoint: POST /v1/t2a_v2
 * - T2A Async: https://platform.minimax.io/docs/guides/speech-t2a-async
 *   Endpoint: POST /v1/t2a_async
 *
 * Design choices:
 * - Uses @effect/platform HttpClient for HTTP requests (consistent with other adapters).
 * - Uses Data.TaggedError for typed, catchable MiniMax speech errors.
 * - Synchronous TTS returns audio data directly in response.
 * - Async long-form TTS returns a task_id for polling.
 * - Separates speech synthesis from voice lifecycle management (voice.ts).
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
 * MiniMax synchronous TTS API endpoint (appended to base URL).
 */
export const MINIMAX_TTS_ENDPOINT = '/t2a_v2' as const;

/**
 * MiniMax async long-form TTS endpoint (appended to base URL).
 */
export const MINIMAX_TTS_ASYNC_ENDPOINT = '/t2a_async' as const;

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax speech/TTS failures.
 */
export class MiniMaxSpeechError extends Data.TaggedError(
  'MiniMaxSpeechError'
)<MiniMaxErrorFields> {
  get message(): string {
    return formatMiniMaxErrorMessage(this);
  }
}

// ─── Request/Response Types ───────────────────────────────────────────────────

/**
 * Input shape for synchronous TTS requests.
 */
export interface SpeechSynthesisInput {
  /** Model ID (e.g. 'speech-02') */
  model: string;
  /** Text to synthesize (1–1000 chars for sync TTS) */
  text: string;
  /** Voice ID — either a preset or a custom cloned/designed voice ID */
  voice_id?: string;
  /** Speed multiplier (0.5–2.0, default 1.0) */
  speed?: number;
  /** Volume multiplier (0–10, default varies) */
  vol?: number;
  /** Pitch adjustment (−12 to 12 semitones) */
  pitch?: number;
  /** Audio format (e.g. 'mp3', 'wav', 'flac', 'pcm') */
  audio_format?: string;
  /** Emotional style (e.g. 'happy', 'sad', 'angry', 'fearful', 'disgusted', 'surprised', 'whisper') */
  emotion?: string;
  /** Optional seed for reproducibility */
  seed?: number;
  /** Language hint (e.g. 'en', 'zh', 'ja', 'ko') */
  language?: string;
}

/**
 * Input shape for async long-form TTS requests.
 */
export interface AsyncSpeechSynthesisInput {
  /** Model ID (e.g. 'speech-02') */
  model: string;
  /** Text to synthesize (up to 1M chars for async TTS) */
  text: string;
  /** Voice ID — either a preset or a custom cloned/designed voice ID */
  voice_id?: string;
  /** Speed multiplier (0.5–2.0, default 1.0) */
  speed?: number;
  /** Volume multiplier (0–10, default varies) */
  vol?: number;
  /** Pitch adjustment (−12 to 12 semitones) */
  pitch?: number;
  /** Audio format (e.g. 'mp3', 'wav', 'flac', 'pcm') */
  audio_format?: string;
  /** Emotional style */
  emotion?: string;
  /** Optional callback URL for async completion notification */
  callback_url?: string;
}

/**
 * Normalized synchronous TTS response.
 */
export interface SpeechSynthesisResult {
  /** Hex-encoded audio data from MiniMax */
  audio_hex?: string;
  /** URL to the generated audio file (if returned) */
  audio_url?: string;
  /** The model used for synthesis */
  model: string;
  /** The request ID from MiniMax */
  request_id?: string;
  /** Additional data from MiniMax */
  extra?: Record<string, unknown>;
}

/**
 * Normalized async TTS task creation response.
 */
export interface AsyncSpeechTaskResult {
  /** The task ID for polling */
  task_id: string;
  /** Whether the task was submitted asynchronously */
  async: boolean;
  /** The model used */
  model: string;
}

/**
 * MiniMax raw API response shape for synchronous TTS.
 */
interface MiniMaxTTSResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  data?: {
    audio?: string; // hex-encoded audio
  };
  audio_url?: string;
  request_id?: string;
  [key: string]: unknown;
}

/**
 * MiniMax raw API response shape for async TTS task creation.
 */
interface MiniMaxTTSAsyncResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  task_id?: string;
  request_id?: string;
  [key: string]: unknown;
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

/**
 * MiniMax speech/TTS adapter.
 *
 * Provides `synthesize` for synchronous TTS and `createAsyncTask`
 * for long-form asynchronous TTS.
 */
export interface MiniMaxSpeechAdapter {
  readonly capability: 'speech';
  readonly synthesize: (input: SpeechSynthesisInput) => Effect.Effect<SpeechSynthesisResult, MiniMaxSpeechError>;
  readonly createAsyncTask: (input: AsyncSpeechSynthesisInput) => Effect.Effect<AsyncSpeechTaskResult, MiniMaxSpeechError>;
}

/**
 * Create a MiniMax speech/TTS adapter.
 *
 * @param apiKey - MiniMax API key
 * @param baseUrl - MiniMax API base URL (e.g. 'https://api.minimax.chat/v1')
 * @returns Speech adapter with `synthesize` and `createAsyncTask` methods
 */
export function createMiniMaxSpeechAdapter(
  apiKey: string,
  baseUrl: string
): MiniMaxSpeechAdapter {
  const synthesize = Effect.fn('MiniMaxSpeechAdapter.synthesize')(function* (
    input: SpeechSynthesisInput
  ): Effect.Effect<SpeechSynthesisResult, MiniMaxSpeechError> {
    return yield* Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const client = createAuthenticatedClient(httpClient, apiKey, baseUrl);

      const requestBody: Record<string, unknown> = {
        model: input.model,
        text: input.text,
        ...(input.voice_id && { voice_id: input.voice_id }),
        ...(input.speed !== undefined && { speed: input.speed }),
        ...(input.vol !== undefined && { vol: input.vol }),
        ...(input.pitch !== undefined && { pitch: input.pitch }),
        ...(input.audio_format && { audio_format: input.audio_format }),
        ...(input.emotion && { emotion: input.emotion }),
        ...(input.seed !== undefined && { seed: input.seed }),
        ...(input.language && { language: input.language }),
      };

      const request = HttpClientRequest.post(MINIMAX_TTS_ENDPOINT, {
        body: HttpBody.unsafeJson(requestBody),
      });

      const response = yield* client.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const fields = buildErrorFields(error, 'MiniMaxSpeechAdapter', 'synthesize');
          return Effect.fail(new MiniMaxSpeechError(fields));
        })
      );

      const json = yield* (response.json as Effect.Effect<unknown, unknown>).pipe(
        Effect.catchAll((error) =>
          Effect.fail(new MiniMaxSpeechError({
            module: 'MiniMaxSpeechAdapter',
            method: 'synthesize',
            description: 'Failed to parse TTS response JSON',
            cause: error,
          }))
        )
      ) as MiniMaxTTSResponse;

      // Check for API-level errors
      if (json.base_resp && json.base_resp.status_code !== 0) {
        return yield* Effect.fail(new MiniMaxSpeechError({
          module: 'MiniMaxSpeechAdapter',
          method: 'synthesize',
          description: formatApiErrorMessage(json.base_resp.status_code, json.base_resp.status_msg),
        }));
      }

      // Collect extra fields beyond the known ones
      const knownKeys = new Set(['base_resp', 'data', 'audio_url', 'request_id']);
      const extra: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(json)) {
        if (!knownKeys.has(key)) {
          extra[key] = value;
        }
      }

      return {
        audio_hex: json.data?.audio,
        audio_url: json.audio_url,
        model: input.model,
        request_id: json.request_id,
        extra: Object.keys(extra).length > 0 ? extra : undefined,
      };
    });
  });

  const createAsyncTask = Effect.fn('MiniMaxSpeechAdapter.createAsyncTask')(function* (
    input: AsyncSpeechSynthesisInput
  ): Effect.Effect<AsyncSpeechTaskResult, MiniMaxSpeechError> {
    return yield* Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const client = createAuthenticatedClient(httpClient, apiKey, baseUrl);

      const requestBody: Record<string, unknown> = {
        model: input.model,
        text: input.text,
        ...(input.voice_id && { voice_id: input.voice_id }),
        ...(input.speed !== undefined && { speed: input.speed }),
        ...(input.vol !== undefined && { vol: input.vol }),
        ...(input.pitch !== undefined && { pitch: input.pitch }),
        ...(input.audio_format && { audio_format: input.audio_format }),
        ...(input.emotion && { emotion: input.emotion }),
        ...(input.callback_url && { callback_url: input.callback_url }),
      };

      const request = HttpClientRequest.post(MINIMAX_TTS_ASYNC_ENDPOINT, {
        body: HttpBody.unsafeJson(requestBody),
      });

      const response = yield* client.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const fields = buildErrorFields(error, 'MiniMaxSpeechAdapter', 'createAsyncTask');
          return Effect.fail(new MiniMaxSpeechError(fields));
        })
      );

      const json = yield* (response.json as Effect.Effect<unknown, unknown>).pipe(
        Effect.catchAll((error) =>
          Effect.fail(new MiniMaxSpeechError({
            module: 'MiniMaxSpeechAdapter',
            method: 'createAsyncTask',
            description: 'Failed to parse async TTS response JSON',
            cause: error,
          }))
        )
      ) as MiniMaxTTSAsyncResponse;

      // Check for API-level errors
      if (json.base_resp && json.base_resp.status_code !== 0) {
        return yield* Effect.fail(new MiniMaxSpeechError({
          module: 'MiniMaxSpeechAdapter',
          method: 'createAsyncTask',
          description: formatApiErrorMessage(json.base_resp.status_code, json.base_resp.status_msg),
        }));
      }

      if (!json.task_id) {
        return yield* Effect.fail(new MiniMaxSpeechError({
          module: 'MiniMaxSpeechAdapter',
          method: 'createAsyncTask',
          description: 'No task_id returned from MiniMax async TTS API',
        }));
      }

      return {
        task_id: json.task_id,
        async: true,
        model: input.model,
      };
    });
  });

  return {
    capability: 'speech',
    synthesize,
    createAsyncTask,
  };
}
