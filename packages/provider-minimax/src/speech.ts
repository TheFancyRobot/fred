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
 */

import { Data, Effect, Schedule } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import { FetchHttpClient } from '@effect/platform';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * MiniMax synchronous TTS API endpoint (appended to base URL).
 */
export const MINIMAX_TTS_ENDPOINT = '/t2a_v2' as const;

/**
 * MiniMax async long-form TTS endpoint (appended to base URL).
 */
export const MINIMAX_TTS_ASYNC_ENDPOINT = '/t2a_async' as const;

/**
 * Retry configuration for transient MiniMax speech API failures.
 */
const SPEECH_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
} as const;

/**
 * HTTP status codes that are non-retryable (client errors).
 */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax speech/TTS failures.
 */
export class MiniMaxSpeechError extends Data.TaggedError(
  'MiniMaxSpeechError'
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
    Schedule.exponential(Duration.millis(SPEECH_RETRY_CONFIG.baseDelayMs)),
    Schedule.recurs(SPEECH_RETRY_CONFIG.maxRetries)
  );
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

      const response = yield* clientWithBaseUrlOk.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const classification = classifyHttpError(error);
          return Effect.fail(new MiniMaxSpeechError({
            module: 'MiniMaxSpeechAdapter',
            method: 'synthesize',
            description: classification.retryable
              ? `HTTP request failed after retries (${classification.category})`
              : `HTTP request failed: non-retryable ${classification.statusCode} error`,
            cause: error,
          }));
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
          description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
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

      const response = yield* clientWithBaseUrlOk.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const classification = classifyHttpError(error);
          return Effect.fail(new MiniMaxSpeechError({
            module: 'MiniMaxSpeechAdapter',
            method: 'createAsyncTask',
            description: classification.retryable
              ? `HTTP request failed after retries (${classification.category})`
              : `HTTP request failed: non-retryable ${classification.statusCode} error`,
            cause: error,
          }));
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
          description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
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
