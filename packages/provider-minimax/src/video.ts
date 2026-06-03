/**
 * MiniMax video generation capability adapter.
 *
 * Implements video generation using MiniMax's native Video Generation API.
 * MiniMax video generation is asynchronous: you create a task, then poll for status.
 *
 * API Reference:
 * - Create: https://platform.minimax.io/docs/api-reference/video-generation-t2v
 * - Query:  https://platform.minimax.io/docs/api-reference/video-generation-query
 *
 * Design choices:
 * - Uses @effect/platform HttpClient for HTTP requests (consistent with language.ts).
 * - Uses Data.TaggedError for typed, catchable MiniMax video errors.
 * - Video generation is async: createTask returns a task_id, queryTask polls for status.
 * - Supports text-to-video, image-to-video, and subject-reference-to-video modes.
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
 * MiniMax video generation API endpoint (appended to base URL).
 */
export const MINIMAX_VIDEO_GENERATION_ENDPOINT = '/video_generation' as const;

/**
 * MiniMax video generation query endpoint (appended to base URL).
 */
export const MINIMAX_VIDEO_QUERY_ENDPOINT = '/query/video_generation' as const;

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax video generation failures.
 */
export class MiniMaxVideoError extends Data.TaggedError(
  'MiniMaxVideoError'
)<MiniMaxErrorFields> {
  get message(): string {
    return formatMiniMaxErrorMessage(this);
  }
}

// ─── Request/Response Types ───────────────────────────────────────────────────

/**
 * Input shape for video generation task creation.
 */
export interface VideoGenerationInput {
  /** Model ID (e.g. 'video-01') */
  model: string;
  /** Text prompt describing the desired video */
  prompt: string;
  /** Optional first frame image URL for image-to-video */
  first_frame_image?: string;
  /** Optional subject reference image URL */
  subject_reference_image_url?: string;
  /** Optional callback URL for async notifications */
  callback_url?: string;
  /** Whether to submit asynchronously (default: true) */
  async?: boolean;
}

/**
 * Input shape for video generation task status query.
 */
export interface VideoQueryInput {
  /** Task ID returned by createTask */
  task_id: string;
}

/**
 * Result from creating a video generation task.
 */
export interface VideoTaskResult {
  /** The task ID for polling */
  task_id: string;
  /** Whether the task was submitted asynchronously */
  async: boolean;
  /** The model used */
  model: string;
}

/**
 * Task status values from MiniMax API.
 */
export type VideoTaskStatus = 'Created' | 'Processing' | 'Success' | 'Failed';

/**
 * Result from querying a video generation task.
 */
export interface VideoQueryResult {
  /** Task ID */
  task_id: string;
  /** Current task status */
  status: VideoTaskStatus;
  /** File ID for downloading the video (when status is Success) */
  file_id?: string;
  /** Error message (when status is Failed) */
  error_message?: string;
  /** The model used */
  model?: string;
}

/**
 * MiniMax raw API response for task creation.
 */
interface MiniMaxVideoCreateResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  task_id?: string;
}

/**
 * MiniMax raw API response for task query.
 */
interface MiniMaxVideoQueryResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  task_id?: string;
  status?: string;
  file_id?: string;
  model?: string;
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

/**
 * MiniMax video generation adapter.
 *
 * Provides `createTask` and `queryTask` methods for async video generation.
 */
export interface MiniMaxVideoAdapter {
  readonly capability: 'video';
  readonly createTask: (input: VideoGenerationInput) => Effect.Effect<VideoTaskResult, MiniMaxVideoError>;
  readonly queryTask: (input: VideoQueryInput) => Effect.Effect<VideoQueryResult, MiniMaxVideoError>;
}

/**
 * Create a MiniMax video generation adapter.
 *
 * @param apiKey - MiniMax API key
 * @param baseUrl - MiniMax API base URL (e.g. 'https://api.minimax.chat/v1')
 * @returns Video adapter with createTask and queryTask methods
 */
export function createMiniMaxVideoAdapter(
  apiKey: string,
  baseUrl: string
): MiniMaxVideoAdapter {
  const createTask = Effect.fn('MiniMaxVideoAdapter.createTask')(function* (
    input: VideoGenerationInput
  ): Effect.Effect<VideoTaskResult, MiniMaxVideoError> {
    return yield* Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const client = createAuthenticatedClient(httpClient, apiKey, baseUrl);

      const requestBody: Record<string, unknown> = {
        model: input.model,
        prompt: input.prompt,
        ...(input.first_frame_image && { first_frame_image: input.first_frame_image }),
        ...(input.subject_reference_image_url && { subject_reference_image_url: input.subject_reference_image_url }),
        ...(input.callback_url && { callback_url: input.callback_url }),
        ...(input.async !== undefined && { async: input.async }),
      };

      const request = HttpClientRequest.post(MINIMAX_VIDEO_GENERATION_ENDPOINT, {
        body: HttpBody.unsafeJson(requestBody),
      });

      const response = yield* client.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const fields = buildErrorFields(error, 'MiniMaxVideoAdapter', 'createTask');
          return Effect.fail(new MiniMaxVideoError(fields));
        })
      );

      const json = yield* (response.json as Effect.Effect<unknown, unknown>).pipe(
        Effect.catchAll((error) =>
          Effect.fail(new MiniMaxVideoError({
            module: 'MiniMaxVideoAdapter',
            method: 'createTask',
            description: 'Failed to parse video task creation response JSON',
            cause: error,
          }))
        )
      ) as MiniMaxVideoCreateResponse;

      if (json.base_resp && json.base_resp.status_code !== 0) {
        return yield* Effect.fail(new MiniMaxVideoError({
          module: 'MiniMaxVideoAdapter',
          method: 'createTask',
          description: formatApiErrorMessage(json.base_resp.status_code, json.base_resp.status_msg),
        }));
      }

      if (!json.task_id) {
        return yield* Effect.fail(new MiniMaxVideoError({
          module: 'MiniMaxVideoAdapter',
          method: 'createTask',
          description: 'No task_id returned from MiniMax video generation API',
        }));
      }

      return {
        task_id: json.task_id,
        async: input.async ?? true,
        model: input.model,
      };
    });
  });

  const queryTask = Effect.fn('MiniMaxVideoAdapter.queryTask')(function* (
    input: VideoQueryInput
  ): Effect.Effect<VideoQueryResult, MiniMaxVideoError> {
    return yield* Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const client = createAuthenticatedClient(httpClient, apiKey, baseUrl);

      const request = HttpClientRequest.get(
        `${MINIMAX_VIDEO_QUERY_ENDPOINT}?task_id=${encodeURIComponent(input.task_id)}`
      );

      const response = yield* client.execute(request).pipe(
        Effect.retry(
          buildRetrySchedule().pipe(
            Schedule.whileInput((error: unknown) => classifyHttpError(error).retryable)
          )
        ),
        Effect.catchAll((error) => {
          const fields = buildErrorFields(error, 'MiniMaxVideoAdapter', 'queryTask');
          return Effect.fail(new MiniMaxVideoError(fields));
        })
      );

      const json = yield* (response.json as Effect.Effect<unknown, unknown>).pipe(
        Effect.catchAll((error) =>
          Effect.fail(new MiniMaxVideoError({
            module: 'MiniMaxVideoAdapter',
            method: 'queryTask',
            description: 'Failed to parse video query response JSON',
            cause: error,
          }))
        )
      ) as MiniMaxVideoQueryResponse;

      if (json.base_resp && json.base_resp.status_code !== 0) {
        return yield* Effect.fail(new MiniMaxVideoError({
          module: 'MiniMaxVideoAdapter',
          method: 'queryTask',
          description: formatApiErrorMessage(json.base_resp.status_code, json.base_resp.status_msg),
        }));
      }

      return {
        task_id: json.task_id ?? input.task_id,
        status: (json.status as VideoTaskStatus) ?? 'Created',
        file_id: json.file_id,
        model: json.model,
      };
    });
  });

  return {
    capability: 'video',
    createTask,
    queryTask,
  };
}
