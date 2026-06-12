/**
 * MiniMax voice lifecycle capability adapter.
 *
 * Implements voice cloning, voice design, and voice management
 * using MiniMax's native Voice APIs.
 *
 * API References:
 * - Voice Clone: https://platform.minimax.io/docs/api-reference/voice-cloning-clone
 *   Endpoint: POST /v1/voice_clone
 * - Voice Design: https://platform.minimax.io/docs/api-reference/voice-design-design
 *   Endpoint: POST /v1/voice_design
 * - Voice Management (Get): https://platform.minimax.io/docs/api-reference/voice-management-get
 *   Endpoint: POST /v1/get_voice
 * - Voice Management (Delete): https://platform.minimax.io/docs/api-reference/voice-management-delete
 *   Endpoint: POST /v1/delete_voice
 *
 * Design choices:
 * - Uses @effect/platform HttpClient for HTTP requests (consistent with other adapters).
 * - Uses Data.TaggedError for typed, catchable MiniMax voice errors.
 * - Voice cloning and voice design are separate methods despite both creating voices,
 *   because they have fundamentally different input shapes and use cases.
 * - Voice management (list/delete) handles the lifecycle of custom voices.
 * - Cloned voices expire after 7 days of inactivity per MiniMax policy.
 */

import { Data, Effect, Schedule } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import { MINIMAX_DEFAULT_BASE_URL } from './config';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * MiniMax voice clone endpoint (appended to base URL).
 */
export const MINIMAX_VOICE_CLONE_ENDPOINT = '/voice_clone' as const;

/**
 * MiniMax voice design endpoint (appended to base URL).
 */
export const MINIMAX_VOICE_DESIGN_ENDPOINT = '/voice_design' as const;

/**
 * MiniMax voice management list endpoint (appended to base URL).
 */
export const MINIMAX_VOICE_LIST_ENDPOINT = '/get_voice' as const;

/**
 * MiniMax voice management delete endpoint (appended to base URL).
 */
export const MINIMAX_VOICE_DELETE_ENDPOINT = '/delete_voice' as const;

/**
 * Retry configuration for transient MiniMax voice API failures.
 */
const VOICE_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
} as const;

/**
 * HTTP status codes that are non-retryable (client errors).
 */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax voice lifecycle failures.
 */
export class MiniMaxVoiceError extends Data.TaggedError(
  'MiniMaxVoiceError'
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
 * Input shape for voice cloning requests.
 *
 * Voice cloning creates a voice from an audio sample.
 * Cloned voices expire after 7 days of inactivity.
 */
export interface VoiceCloneInput {
  /** URL or base64-encoded audio sample for cloning */
  audio_source: string;
  /** Whether audio_source is a URL or base64 */
  audio_source_type?: 'url' | 'base64';
  /** Optional voice name for identification */
  voice_name?: string;
  /** Optional text for accuracy verification */
  text?: string;
  /** Language hint for the audio sample (e.g. 'en', 'zh') */
  language?: string;
}

/**
 * Input shape for voice design requests.
 *
 * Voice design creates a custom voice from a text description.
 */
export interface VoiceDesignInput {
  /** Text prompt describing the desired voice characteristics */
  prompt: string;
  /** Preview text to generate a sample audio with the designed voice */
  preview_text: string;
  /** Optional language hint */
  language?: string;
}

export type VoiceListType = 'system' | 'voice_cloning' | 'voice_generation' | 'all';
export type DeletableVoiceType = 'voice_cloning' | 'voice_generation';

/**
 * Input shape for voice list requests.
 */
export interface VoiceListInput {
  /** Voice type to query (default: 'all') */
  voice_type?: VoiceListType;
}

/**
 * Input shape for voice delete requests.
 */
export interface VoiceDeleteInput {
  /** Voice type to delete */
  voice_type: DeletableVoiceType;
  /** Voice ID to delete */
  voice_id: string;
}

/**
 * Normalized voice clone result.
 */
export interface VoiceCloneResult {
  /** The voice ID for use in TTS */
  voice_id: string;
  /** Optional trial audio (hex-encoded) */
  trial_audio?: string;
  /** The voice name */
  voice_name?: string;
  /** Additional data from MiniMax */
  extra?: Record<string, unknown>;
}

/**
 * Normalized voice design result.
 */
export interface VoiceDesignResult {
  /** The voice ID for use in TTS */
  voice_id: string;
  /** Trial audio (hex-encoded) demonstrating the designed voice */
  trial_audio?: string;
  /** Additional data from MiniMax */
  extra?: Record<string, unknown>;
}

/**
 * A voice resource in the list response.
 */
export interface VoiceResource {
  /** Voice ID */
  voice_id: string;
  /** Voice name */
  voice_name?: string;
  /** Voice type */
  voice_type?: VoiceListType | DeletableVoiceType;
  /** Human-readable description entries */
  description?: ReadonlyArray<string>;
  /** Language */
  language?: string;
  /** Creation timestamp */
  created_time?: string;
  /** Legacy creation timestamp alias */
  created_at?: string;
  /** Expiration timestamp (for cloned voices) */
  expires_at?: string;
}

/**
 * Normalized voice list result.
 */
export interface VoiceListResult {
  /** List of voice resources */
  voices: ReadonlyArray<VoiceResource>;
  /** Total count of voices */
  total?: number;
  /** Current page */
  page?: number;
  /** Page size */
  page_size?: number;
}

/**
 * Normalized voice delete result.
 */
export interface VoiceDeleteResult {
  /** Whether deletion was successful */
  success: boolean;
  /** The voice ID that was deleted */
  voice_id: string;
}

/**
 * MiniMax raw API response for voice clone.
 */
interface MiniMaxVoiceCloneResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  voice_id?: string;
  trial_audio?: string;
  voice_name?: string;
  [key: string]: unknown;
}

/**
 * MiniMax raw API response for voice design.
 */
interface MiniMaxVoiceDesignResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  voice_id?: string;
  trial_audio?: string;
  [key: string]: unknown;
}

/**
 * MiniMax raw API response for voice list.
 */
interface MiniMaxVoiceEntry {
  voice_id: string;
  voice_name?: string;
  description?: string[];
  language?: string;
  created_time?: string;
  created_at?: string;
  expires_at?: string;
  [key: string]: unknown;
}

interface MiniMaxVoiceListResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  system_voice?: MiniMaxVoiceEntry[];
  voice_cloning?: MiniMaxVoiceEntry[];
  voice_generation?: MiniMaxVoiceEntry[];
  voices?: MiniMaxVoiceEntry[];
  total?: number;
}

/**
 * MiniMax raw API response for voice delete.
 */
interface MiniMaxVoiceDeleteResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
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
    Schedule.exponential(Duration.millis(VOICE_RETRY_CONFIG.baseDelayMs)),
    Schedule.recurs(VOICE_RETRY_CONFIG.maxRetries)
  );
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

/**
 * MiniMax voice lifecycle adapter.
 *
 * Provides `clone`, `design`, `list`, and `delete` methods for managing
 * custom voices in MiniMax.
 */
export interface MiniMaxVoiceAdapter {
  readonly capability: 'voice';
  readonly clone: (input: VoiceCloneInput) => Effect.Effect<VoiceCloneResult, MiniMaxVoiceError, HttpClient.HttpClient>;
  readonly design: (input: VoiceDesignInput) => Effect.Effect<VoiceDesignResult, MiniMaxVoiceError, HttpClient.HttpClient>;
  readonly list: (input?: VoiceListInput) => Effect.Effect<VoiceListResult, MiniMaxVoiceError, HttpClient.HttpClient>;
  readonly delete: (input: VoiceDeleteInput) => Effect.Effect<VoiceDeleteResult, MiniMaxVoiceError, HttpClient.HttpClient>;
}

/**
 * Create a MiniMax voice lifecycle adapter.
 *
 * @param apiKey - MiniMax API key
 * @param baseUrl - MiniMax API base URL (defaults to 'https://api.minimax.io/v1')
 * @returns Voice adapter with `clone`, `design`, `list`, and `delete` methods
 */
export function createMiniMaxVoiceAdapter(
  apiKey: string,
  baseUrl: string = MINIMAX_DEFAULT_BASE_URL
): MiniMaxVoiceAdapter {
  const clone = Effect.fn('MiniMaxVoiceAdapter.clone')(function* (
    input: VoiceCloneInput
  ) {
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
      audio_source: input.audio_source,
      ...(input.audio_source_type && { audio_source_type: input.audio_source_type }),
      ...(input.voice_name && { voice_name: input.voice_name }),
      ...(input.text && { text: input.text }),
      ...(input.language && { language: input.language }),
    };

    const request = HttpClientRequest.post(MINIMAX_VOICE_CLONE_ENDPOINT, {
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
        return Effect.fail(new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'clone',
          description: classification.retryable
            ? `HTTP request failed after retries (${classification.category})`
            : `HTTP request failed: non-retryable ${classification.statusCode} error`,
          cause: error,
        }));
      })
    );

    const json = (yield* response.json.pipe(
      Effect.mapError((error) =>
        new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'clone',
          description: 'Failed to parse voice clone response JSON',
          cause: error,
        })
      )
    )) as MiniMaxVoiceCloneResponse;

    if (json.base_resp && json.base_resp.status_code !== 0) {
      return yield* Effect.fail(new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'clone',
        description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
      }));
    }

    if (!json.voice_id) {
      return yield* Effect.fail(new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'clone',
        description: 'No voice_id returned from MiniMax voice clone API',
      }));
    }

    const knownKeys = new Set(['base_resp', 'voice_id', 'trial_audio', 'voice_name']);
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json)) {
      if (!knownKeys.has(key)) {
        extra[key] = value;
      }
    }

    return {
      voice_id: json.voice_id,
      trial_audio: json.trial_audio,
      voice_name: json.voice_name,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    };
  });

  const design = Effect.fn('MiniMaxVoiceAdapter.design')(function* (
    input: VoiceDesignInput
  ) {
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
      prompt: input.prompt,
      preview_text: input.preview_text,
      ...(input.language && { language: input.language }),
    };

    const request = HttpClientRequest.post(MINIMAX_VOICE_DESIGN_ENDPOINT, {
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
        return Effect.fail(new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'design',
          description: classification.retryable
            ? `HTTP request failed after retries (${classification.category})`
            : `HTTP request failed: non-retryable ${classification.statusCode} error`,
          cause: error,
        }));
      })
    );

    const json = (yield* response.json.pipe(
      Effect.mapError((error) =>
        new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'design',
          description: 'Failed to parse voice design response JSON',
          cause: error,
        })
      )
    )) as MiniMaxVoiceDesignResponse;

    if (json.base_resp && json.base_resp.status_code !== 0) {
      return yield* Effect.fail(new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'design',
        description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
      }));
    }

    if (!json.voice_id) {
      return yield* Effect.fail(new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'design',
        description: 'No voice_id returned from MiniMax voice design API',
      }));
    }

    const knownKeys = new Set(['base_resp', 'voice_id', 'trial_audio']);
    const extra: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(json)) {
      if (!knownKeys.has(key)) {
        extra[key] = value;
      }
    }

    return {
      voice_id: json.voice_id,
      trial_audio: json.trial_audio,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    };
  });

  const list = Effect.fn('MiniMaxVoiceAdapter.list')(function* (
    input?: VoiceListInput
  ) {
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
      voice_type: input?.voice_type ?? 'all',
    };

    const request = HttpClientRequest.post(MINIMAX_VOICE_LIST_ENDPOINT, {
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
        return Effect.fail(new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'list',
          description: classification.retryable
            ? `HTTP request failed after retries (${classification.category})`
            : `HTTP request failed: non-retryable ${classification.statusCode} error`,
          cause: error,
        }));
      })
    );

    const json = (yield* response.json.pipe(
      Effect.mapError((error) =>
        new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'list',
          description: 'Failed to parse voice list response JSON',
          cause: error,
        })
      )
    )) as MiniMaxVoiceListResponse;

    if (json.base_resp && json.base_resp.status_code !== 0) {
      return yield* Effect.fail(new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'list',
        description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
      }));
    }

    const toVoiceResource = (
      voice_type: VoiceResource['voice_type'],
      v: MiniMaxVoiceEntry
    ): VoiceResource => ({
      voice_id: v.voice_id,
      voice_name: v.voice_name,
      voice_type,
      description: v.description,
      language: v.language,
      created_time: v.created_time,
      created_at: v.created_at,
      expires_at: v.expires_at,
    });

    const voices: VoiceResource[] = [
      ...(json.system_voice ?? []).map((v: MiniMaxVoiceEntry) => toVoiceResource('system', v)),
      ...(json.voice_cloning ?? []).map((v: MiniMaxVoiceEntry) => toVoiceResource('voice_cloning', v)),
      ...(json.voice_generation ?? []).map((v: MiniMaxVoiceEntry) => toVoiceResource('voice_generation', v)),
      ...(json.voices ?? []).map((v: MiniMaxVoiceEntry) => toVoiceResource(v.voice_type as VoiceResource['voice_type'], v)),
    ];

    return {
      voices,
      total: json.total ?? voices.length,
    };
  });

  const delete_ = Effect.fn('MiniMaxVoiceAdapter.delete')(function* (
    input: VoiceDeleteInput
  ) {
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
      voice_type: input.voice_type,
      voice_id: input.voice_id,
    };

    const request = HttpClientRequest.post(MINIMAX_VOICE_DELETE_ENDPOINT, {
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
        return Effect.fail(new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'delete',
          description: classification.retryable
            ? `HTTP request failed after retries (${classification.category})`
            : `HTTP request failed: non-retryable ${classification.statusCode} error`,
          cause: error,
        }));
      })
    );

    const json = (yield* response.json.pipe(
      Effect.mapError((error) =>
        new MiniMaxVoiceError({
          module: 'MiniMaxVoiceAdapter',
          method: 'delete',
          description: 'Failed to parse voice delete response JSON',
          cause: error,
        })
      )
    )) as MiniMaxVoiceDeleteResponse;

    if (json.base_resp && json.base_resp.status_code !== 0) {
      return yield* Effect.fail(new MiniMaxVoiceError({
        module: 'MiniMaxVoiceAdapter',
        method: 'delete',
        description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
      }));
    }

    return {
      success: true,
      voice_id: input.voice_id,
    };
  });

  return {
    capability: 'voice',
    clone,
    design,
    list,
    delete: delete_,
  };
}
