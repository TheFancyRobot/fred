/**
 * MiniMax image generation capability adapter.
 *
 * Implements image generation using MiniMax's native Image Generation API.
 * Supports text-to-image and image-to-image generation modes.
 *
 * API Reference: https://platform.minimax.io/docs/api-reference/image-generation-t2i
 * Endpoint: POST /v1/image_generation
 *
 * Design choices:
 * - Uses @effect/platform HttpClient for HTTP requests (consistent with language.ts).
 * - Uses Data.TaggedError for typed, catchable MiniMax image errors.
 * - Image generation is synchronous: returns image_urls directly in response.
 * - Supports both text-to-image and image-to-image via optional reference images.
 */

import { Data, Effect, Layer, Schedule } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import { FetchHttpClient } from '@effect/platform';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * MiniMax image generation API endpoint (appended to base URL).
 */
export const MINIMAX_IMAGE_ENDPOINT = '/image_generation' as const;

/**
 * Retry configuration for transient MiniMax image API failures.
 * Max 3 retries with exponential backoff: 500ms → 1s → 2s.
 */
const IMAGE_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelayMs: 500,
} as const;

/**
 * HTTP status codes that are non-retryable (client errors).
 */
const NON_RETRYABLE_STATUS_CODES = new Set([400, 401, 403, 404, 422]);

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax image generation failures.
 */
export class MiniMaxImageError extends Data.TaggedError(
  'MiniMaxImageError'
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
 * Input shape for image generation requests.
 */
export interface ImageGenerationInput {
  /** Model ID (e.g. 'image-01', 'image-01-live') */
  model: string;
  /** Text prompt describing the desired image */
  prompt: string;
  /** Optional aspect ratio (e.g. '1:1', '16:9', '9:16') */
  aspect_ratio?: string;
  /** Number of images to generate (default: 1) */
  n?: number;
  /** Optional reference image URL for image-to-image generation */
  reference_image_url?: string;
  /** Optional reference image for image-to-image (base64 encoded) */
  reference_image_base64?: string;
  /** Optional seed for reproducibility */
  seed?: number;
}

/**
 * Normalized image generation response.
 */
export interface ImageGenerationResult {
  /** Generated image URLs */
  image_urls: ReadonlyArray<string>;
  /** The model used for generation */
  model: string;
  /** The request ID from MiniMax */
  request_id?: string;
}

/**
 * MiniMax raw API response shape for image generation.
 */
interface MiniMaxImageResponse {
  base_resp?: {
    status_code: number;
    status_msg: string;
  };
  image_urls?: string[];
  request_id?: string;
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
    Schedule.exponential(Duration.millis(IMAGE_RETRY_CONFIG.baseDelayMs)),
    Schedule.recurs(IMAGE_RETRY_CONFIG.maxRetries)
  );
}

// ─── Adapter ───────────────────────────────────────────────────────────────────

/**
 * MiniMax image generation adapter.
 *
 * Provides a `generate` method that calls MiniMax's image generation API
 * and returns normalized results.
 */
export interface MiniMaxImageAdapter {
  readonly capability: 'image';
  readonly generate: (input: ImageGenerationInput) => Effect.Effect<ImageGenerationResult, MiniMaxImageError>;
}

/**
 * Create a MiniMax image generation adapter.
 *
 * @param apiKey - MiniMax API key
 * @param baseUrl - MiniMax API base URL (e.g. 'https://api.minimax.chat/v1')
 * @returns Image adapter with `generate` method
 */
export function createMiniMaxImageAdapter(
  apiKey: string,
  baseUrl: string
): MiniMaxImageAdapter {
  const generate = Effect.fn('MiniMaxImageAdapter.generate')(function* (
    input: ImageGenerationInput
  ): Effect.Effect<ImageGenerationResult, MiniMaxImageError> {
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
        ...(input.aspect_ratio && { aspect_ratio: input.aspect_ratio }),
        ...(input.n && { n: input.n }),
        ...(input.reference_image_url && { reference_image_url: input.reference_image_url }),
        ...(input.reference_image_base64 && { reference_image: input.reference_image_base64 }),
        ...(input.seed !== undefined && { seed: input.seed }),
      };

      const request = HttpClientRequest.post(MINIMAX_IMAGE_ENDPOINT, {
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
          return Effect.fail(new MiniMaxImageError({
            module: 'MiniMaxImageAdapter',
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
          Effect.fail(new MiniMaxImageError({
            module: 'MiniMaxImageAdapter',
            method: 'generate',
            description: 'Failed to parse image generation response JSON',
            cause: error,
          }))
        )
      ) as MiniMaxImageResponse;

      // Check for API-level errors
      if (json.base_resp && json.base_resp.status_code !== 0) {
        return yield* Effect.fail(new MiniMaxImageError({
          module: 'MiniMaxImageAdapter',
          method: 'generate',
          description: `MiniMax API error: ${json.base_resp.status_msg} (code: ${json.base_resp.status_code})`,
        }));
      }

      if (!json.image_urls || json.image_urls.length === 0) {
        return yield* Effect.fail(new MiniMaxImageError({
          module: 'MiniMaxImageAdapter',
          method: 'generate',
          description: 'No image URLs returned from MiniMax API',
        }));
      }

      return {
        image_urls: json.image_urls,
        model: input.model,
        request_id: json.request_id,
      };
    });
  });

  return {
    capability: 'image',
    generate,
  };
}
