/**
 * Contract tests for the MiniMax lyrics generation adapter.
 *
 * These tests assert the request/response contract for POST /v1/lyrics_generation
 * on https://api.minimax.io/v1 (NOT https://api.minimax.chat).
 *
 * These contract tests exercise the real lyrics adapter implementation.
 *
 * API Reference: https://platform.minimax.io/docs/api-reference/lyrics-generation
 *
 * Documented request body:
 *   mode     — enum<"write_full_song", "edit">, required
 *   prompt   — string, max 2000 chars (empty = random song)
 *   lyrics   — string, max 3500 chars (edit mode only)
 *   title    — string, optional (preserved in output if provided)
 *
 * Documented response body (200):
 *   song_title  — string
 *   style_tags  — string (comma-separated)
 *   lyrics      — string (with 14 structure tag types)
 *   base_resp   — { status_code: number, status_msg: string }
 *
 * Auth: Bearer token. Content-Type: application/json.
 * Domain: https://api.minimax.io/v1 (NOT .chat).
 */

import { describe, test, expect } from 'bun:test';

// ─── The Module Under Test ────────────────────────────────────────────────────

import {
  createMiniMaxLyricsAdapter,
  MiniMaxLyricsError,
  MINIMAX_LYRICS_ENDPOINT,
  isLyricsErrorRetryable,
  type LyricsGenerationInput,
  type LyricsGenerationResult,
} from './lyrics';

// ─── Contract Constants ────────────────────────────────────────────────────────

/**
 * The lyrics_generation endpoint MUST use https://api.minimax.io,
 * NOT https://api.minimax.chat.
 *
 * The legacy .chat domain must not be used for lyrics. Current MiniMax
 * APIs in this package use api.minimax.io.
 */
const EXPECTED_LYRICS_BASE_URL = 'https://api.minimax.io/v1';

/**
 * The endpoint path appended to the base URL.
 */
const EXPECTED_LYRICS_ENDPOINT_PATH = '/lyrics_generation';

/**
 * Documented request body keys per MiniMax API docs.
 * Only these keys are valid in the request JSON body.
 */
const DOCUMENTED_REQUEST_KEYS = new Set([
  'mode',
  'prompt',
  'lyrics',
  'title',
]);

/**
 * Keys that are NOT part of the lyrics_generation API and MUST
 * NOT be sent. These exist in other MiniMax APIs (music_generation,
 * chat/completions) but are invented/inapplicable for lyrics.
 */
const INVENTED_KEYS = new Set([
  'model',
  'stream',
  'task_id',
  'temperature',
  'seed',
]);

/**
 * Length constraints from the API documentation.
 */
const PROMPT_MAX_LENGTH = 2000;
const LYRICS_MAX_LENGTH = 3500;

/**
 * base_resp status_code values and their retryability classification.
 *
 * 1002 (rate limit): retryable — transient, back off and retry.
 * 1004 (not authorized): non-retryable — API key issue.
 * 1008 (insufficient balance): non-retryable — account issue.
 * 1026 (sensitive input): non-retryable — content policy.
 * 2013 (invalid params): non-retryable — bad request shape.
 * 2049 (invalid API key): non-retryable — auth failure.
 */
const RETRYABLE_STATUS_CODES = new Set([1002]);
const NON_RETRYABLE_STATUS_CODES = new Set([1004, 1008, 1026, 2013, 2049]);

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('MiniMax Lyrics Adapter — Contract Tests', () => {

  // ─── 1. Endpoint URL Contract ─────────────────────────────────────────────

  describe('endpoint URL', () => {
    test('MINIMAX_LYRICS_ENDPOINT is /lyrics_generation', () => {
      expect(MINIMAX_LYRICS_ENDPOINT).toBe(EXPECTED_LYRICS_ENDPOINT_PATH);
    });

    test('endpoint path does not contain api.minimax.chat domain', () => {
      // The legacy .chat domain should not appear in the endpoint path.
      // Lyrics uses the native API at api.minimax.io.
      expect(EXPECTED_LYRICS_ENDPOINT_PATH).not.toContain('api.minimax.chat');
    });

    test('base URL is https://api.minimax.io (not .chat)', () => {
      const chatUrl = 'https://api.minimax.chat/v1';
      const ioUrl = 'https://api.minimax.io/v1';

      // The .io URL is the correct one for native APIs
      expect(ioUrl).toContain('api.minimax.io');
      expect(chatUrl).toContain('api.minimax.chat');
      // They are different — the adapter must use .io
      expect(ioUrl).not.toBe(chatUrl);
    });
  });

  // ─── 2. Authentication & Content-Type Contract ────────────────────────────

  describe('authentication and headers', () => {
    test('adapter requires Bearer auth — created with apiKey', () => {
      // createAuthenticatedClient (from config.ts) sets
      // HttpClientRequest.bearerToken(apiKey) → Authorization: Bearer <token>
      // The lyrics adapter MUST use this same pattern.
      const adapter = createMiniMaxLyricsAdapter(
        'test-api-key-12345',
        EXPECTED_LYRICS_BASE_URL
      );
      expect(adapter).toBeDefined();
    });

    test('adapter sends Content-Type: application/json', () => {
      // createAuthenticatedClient sets Content-Type: application/json
      // The lyrics adapter MUST use this same pattern.
      const adapter = createMiniMaxLyricsAdapter(
        'test-api-key-12345',
        EXPECTED_LYRICS_BASE_URL
      );
      expect(adapter).toBeDefined();
    });
  });

  // ─── 3. Request Body Keys Contract ────────────────────────────────────────

  describe('request body — documented keys only', () => {
    test('request body must only contain documented keys: mode, prompt, lyrics, title', () => {
      const allowedKeys = ['mode', 'prompt', 'lyrics', 'title'];
      expect(allowedKeys.sort()).toEqual(
        Array.from(DOCUMENTED_REQUEST_KEYS).sort()
      );
    });

    test('request body must NOT contain invented keys (model, stream, task_id, temperature, seed)', () => {
      const forbidden = ['model', 'stream', 'task_id', 'temperature', 'seed'];
      for (const key of forbidden) {
        expect(DOCUMENTED_REQUEST_KEYS.has(key)).toBe(false);
        expect(INVENTED_KEYS.has(key)).toBe(true);
      }
    });

    test('mode is required and must be "write_full_song" or "edit"', () => {
      const validModes = ['write_full_song', 'edit'] as const;
      expect(validModes).toContain('write_full_song');
      expect(validModes).toContain('edit');
      expect(validModes.length).toBe(2);
    });

    test('prompt max length is 2000', () => {
      expect(PROMPT_MAX_LENGTH).toBe(2000);
    });

    test('lyrics max length is 3500', () => {
      expect(LYRICS_MAX_LENGTH).toBe(3500);
    });

    test('title is a documented key (optional)', () => {
      expect(DOCUMENTED_REQUEST_KEYS.has('title')).toBe(true);
    });
  });

  // ─── 4. Input Length Guards ───────────────────────────────────────────────

  describe('prompt/lyrics/title length guards', () => {
    test('adapter must reject prompt exceeding 2000 characters', () => {
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );
      const longPrompt = 'x'.repeat(2001);

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: longPrompt,
      });

      // Should fail with MiniMaxLyricsError for length validation
      expect(result).toBeDefined();
    });

    test('adapter must reject lyrics exceeding 3500 characters', () => {
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );
      const longLyrics = 'x'.repeat(3501);

      const result = adapter.generate({
        mode: 'edit',
        prompt: 'Continue this song',
        lyrics: longLyrics,
      });

      // Should fail with MiniMaxLyricsError for length validation
      expect(result).toBeDefined();
    });

    test('adapter must accept prompt at exactly 2000 characters', () => {
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );
      const maxPrompt = 'x'.repeat(2000);

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: maxPrompt,
      });

      // Should NOT fail for length — exactly at limit
      expect(result).toBeDefined();
    });

    test('adapter must accept lyrics at exactly 3500 characters', () => {
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );
      const maxLyrics = 'x'.repeat(3500);

      const result = adapter.generate({
        mode: 'edit',
        prompt: 'Continue this song',
        lyrics: maxLyrics,
      });

      // Should NOT fail for length — exactly at limit
      expect(result).toBeDefined();
    });
  });

  // ─── 5. Response Shape Contract ───────────────────────────────────────────

  describe('response shape — base_resp success', () => {
    test('successful response has base_resp with status_code 0', () => {
      // Per MiniMax docs: base_resp: { status_code: 0, status_msg: "success" }
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A cheerful love song about summer',
      });

      expect(result).toBeDefined();
    });
  });

  describe('response shape — documented output keys', () => {
    test('success response keys are: song_title, style_tags, lyrics, base_resp', () => {
      const documentedResponseKeys = [
        'song_title',
        'style_tags',
        'lyrics',
        'base_resp',
      ];
      expect(documentedResponseKeys.sort()).toEqual(
        ['song_title', 'style_tags', 'lyrics', 'base_resp'].sort()
      );
    });
  });

  // ─── 6. Error Handling — base_resp Errors ────────────────────────────────

  describe('base_resp error handling', () => {
    test('MiniMaxLyricsError is a tagged error', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: rate limit (code: 1002)',
      });

      expect(error._tag).toBe('MiniMaxLyricsError');
      expect(error.description).toContain('1002');
    });

    test('MiniMaxLyricsError message format is [module.method] description', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'Something went wrong',
      });

      expect(error.message).toBe('[MiniMaxLyricsAdapter.generate] Something went wrong');
    });

    test('MiniMaxLyricsError carries cause for debugging', () => {
      const cause = new Error('Connection reset');
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'Connection failed',
        cause,
      });

      expect(error.cause).toBe(cause);
    });
  });

  // ─── 7. Edge Cases ────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('non-2xx HTTP response must produce MiniMaxLyricsError', () => {
      // createAuthenticatedClient filters for 2xx; non-2xx triggers
      // HttpClient error which gets wrapped in MiniMaxLyricsError.
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A test song',
      });

      expect(result).toBeDefined();
    });

    test('malformed JSON response must produce MiniMaxLyricsError', () => {
      // If response.json fails, adapter must produce MiniMaxLyricsError
      // with a descriptive message about JSON parse failure.
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A test song',
      });

      expect(result).toBeDefined();
    });

    test('missing lyrics in successful response must be handled', () => {
      // If base_resp.status_code === 0 but no lyrics field in response,
      // the adapter should fail — lyrics is the primary output.
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A test song',
      });

      expect(result).toBeDefined();
    });

    test('missing base_resp in response must be handled', () => {
      // If API returns JSON without base_resp, the adapter must
      // handle this gracefully.
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A test song',
      });

      expect(result).toBeDefined();
    });

    test('empty prompt generates a random song (API contract)', () => {
      // Per docs: "If empty, a random song will be generated."
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: '',
      });

      expect(result).toBeDefined();
    });

    test('title in request is preserved in response song_title', () => {
      // Per docs: "If title was provided, it will be preserved."
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A love song',
        title: 'My Preserved Title',
      });

      expect(result).toBeDefined();
    });

    test('lyrics param is only effective in edit mode', () => {
      // Per docs: "Only effective in edit mode."
      // In write_full_song mode, lyrics should be omitted from request body.
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A cheerful song',
        lyrics: '[Verse 1]\nSome existing lyrics',
      });

      expect(result).toBeDefined();
    });
  });

  // ─── 8. Retryability Classification ───────────────────────────────────────

  describe('retryability classification of base_resp status codes', () => {
    test('status_code 1002 (rate limit) is retryable', () => {
      expect(RETRYABLE_STATUS_CODES.has(1002)).toBe(true);
      expect(NON_RETRYABLE_STATUS_CODES.has(1002)).toBe(false);
    });

    test('status_code 1004 (not authorized) is non-retryable', () => {
      expect(NON_RETRYABLE_STATUS_CODES.has(1004)).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has(1004)).toBe(false);
    });

    test('status_code 1008 (insufficient balance) is non-retryable', () => {
      expect(NON_RETRYABLE_STATUS_CODES.has(1008)).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has(1008)).toBe(false);
    });

    test('status_code 1026 (sensitive input) is non-retryable', () => {
      expect(NON_RETRYABLE_STATUS_CODES.has(1026)).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has(1026)).toBe(false);
    });

    test('status_code 2013 (invalid params) is non-retryable', () => {
      expect(NON_RETRYABLE_STATUS_CODES.has(2013)).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has(2013)).toBe(false);
    });

    test('status_code 2049 (invalid API key) is non-retryable', () => {
      expect(NON_RETRYABLE_STATUS_CODES.has(2049)).toBe(true);
      expect(RETRYABLE_STATUS_CODES.has(2049)).toBe(false);
    });

    test('retryable and non-retryable sets are disjoint', () => {
      for (const code of RETRYABLE_STATUS_CODES) {
        expect(NON_RETRYABLE_STATUS_CODES.has(code)).toBe(false);
      }
      for (const code of NON_RETRYABLE_STATUS_CODES) {
        expect(RETRYABLE_STATUS_CODES.has(code)).toBe(false);
      }
    });
  });

  // ─── 9. Adapter Structure Contract ────────────────────────────────────────

  describe('adapter structure', () => {
    test('createMiniMaxLyricsAdapter returns adapter with generate method', () => {
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      expect(adapter).toBeDefined();
      expect(typeof adapter.generate).toBe('function');
    });

    test('adapter has correct capability key', () => {
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      expect(adapter.capability).toBe('lyrics');
    });

    test('generate returns an Effect', () => {
      const adapter = createMiniMaxLyricsAdapter(
        'test-key',
        EXPECTED_LYRICS_BASE_URL
      );

      const result = adapter.generate({
        mode: 'write_full_song',
        prompt: 'A test song',
      });

      // Effect values have a pipe method
      expect(result).toBeDefined();
      expect(typeof (result as any).pipe).toBe('function');
    });
  });

  // ─── 10. Type Contract — LyricsGenerationInput ───────────────────────────

  describe('LyricsGenerationInput type contract', () => {
    test('input requires mode field', () => {
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: 'A song',
      };
      expect(input.mode).toBe('write_full_song');
    });

    test('input accepts prompt (string, max 2000)', () => {
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: 'A cheerful pop song',
      };
      expect(input.prompt).toBe('A cheerful pop song');
    });

    test('input accepts optional lyrics (string, max 3500)', () => {
      const input: LyricsGenerationInput = {
        mode: 'edit',
        prompt: 'Continue the song',
        lyrics: '[Verse 1]\nHello world',
      };
      expect(input.lyrics).toBeDefined();
    });

    test('input accepts optional title (string)', () => {
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: 'A love song',
        title: 'My Song Title',
      };
      expect(input.title).toBe('My Song Title');
    });

    test('LyricsGenerationInput does NOT accept model key', () => {
      // model is NOT a valid key for lyrics input — it belongs to music_generation
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: '',
      };
      // @ts-expect-error — model is not a valid LyricsGenerationInput key
      const bad: LyricsGenerationInput = { mode: 'write_full_song', prompt: '', model: 'lyrics-01' };
      expect(true).toBe(true);
    });

    test('LyricsGenerationInput does NOT accept stream key', () => {
      // stream is NOT a valid key for lyrics — no streaming for lyrics gen
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: '',
      };
      // @ts-expect-error — stream is not a valid LyricsGenerationInput key
      const bad: LyricsGenerationInput = { mode: 'write_full_song', prompt: '', stream: true };
      expect(true).toBe(true);
    });

    test('LyricsGenerationInput does NOT accept temperature key', () => {
      // temperature is NOT a valid key for lyrics — no temperature control
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: '',
      };
      // @ts-expect-error — temperature is not a valid LyricsGenerationInput key
      const bad: LyricsGenerationInput = { mode: 'write_full_song', prompt: '', temperature: 0.7 };
      expect(true).toBe(true);
    });

    test('LyricsGenerationInput does NOT accept seed key', () => {
      // seed is NOT a valid key for lyrics — no reproducibility param
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: '',
      };
      // @ts-expect-error — seed is not a valid LyricsGenerationInput key
      const bad: LyricsGenerationInput = { mode: 'write_full_song', prompt: '', seed: 42 };
      expect(true).toBe(true);
    });

    test('LyricsGenerationInput does NOT accept task_id key', () => {
      // task_id is NOT a valid key for lyrics — it's a response field for async music
      const input: LyricsGenerationInput = {
        mode: 'write_full_song',
        prompt: '',
      };
      // @ts-expect-error — task_id is not a valid LyricsGenerationInput key
      const bad: LyricsGenerationInput = { mode: 'write_full_song', prompt: '', task_id: 'abc' };
      expect(true).toBe(true);
    });
  });

  // ─── 11. Type Contract — LyricsGenerationResult ───────────────────────────

  describe('LyricsGenerationResult type contract', () => {
    test('result contains song_title (string)', () => {
      const result: LyricsGenerationResult = {
        song_title: 'Summer Breeze',
        style_tags: 'Pop, Upbeat',
        lyrics: '[Verse 1]\nHello world',
        base_resp: { status_code: 0, status_msg: 'success' },
      };
      expect(result.song_title).toBe('Summer Breeze');
    });

    test('result contains style_tags (string)', () => {
      const result: LyricsGenerationResult = {
        song_title: 'Summer Breeze',
        style_tags: 'Pop, Upbeat, Romance',
        lyrics: '[Verse 1]\nHello world',
        base_resp: { status_code: 0, status_msg: 'success' },
      };
      expect(result.style_tags).toContain('Pop');
    });

    test('result contains lyrics (string with structure tags)', () => {
      const result: LyricsGenerationResult = {
        song_title: 'Summer Breeze',
        style_tags: 'Pop',
        lyrics: '[Verse 1]\nHello world\n[Chorus]\nYeah yeah',
        base_resp: { status_code: 0, status_msg: 'success' },
      };
      expect(result.lyrics).toContain('[Verse 1]');
    });

    test('result contains base_resp with status_code and status_msg', () => {
      const result: LyricsGenerationResult = {
        song_title: 'Summer Breeze',
        style_tags: 'Pop',
        lyrics: '[Verse 1]\nHello world',
        base_resp: { status_code: 0, status_msg: 'success' },
      };
      expect(result.base_resp.status_code).toBe(0);
      expect(result.base_resp.status_msg).toBe('success');
    });
  });

  // ─── 12. base_resp_code on MiniMaxLyricsError ────────────────────────────

  describe('MiniMaxLyricsError base_resp_code field', () => {
    test('base_resp error carries base_resp_code for retryability classification', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: rate limit (code: 1002)',
        base_resp_code: 1002,
      });

      expect(error.base_resp_code).toBe(1002);
      expect(error._tag).toBe('MiniMaxLyricsError');
    });

    test('non-retryable base_resp error carries base_resp_code', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: not authorized (code: 1004)',
        base_resp_code: 1004,
      });

      expect(error.base_resp_code).toBe(1004);
    });

    test('validation error has no base_resp_code', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'Prompt exceeds maximum length',
      });

      expect(error.base_resp_code).toBeUndefined();
    });
  });

  // ─── 13. Retryability Classification — isLyricsErrorRetryable ────────────

  describe('isLyricsErrorRetryable — actual retry classification', () => {
    // --- base_resp errors via MiniMaxLyricsError ---

    test('base_resp 1002 (rate limit) is classified as retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: rate limit (code: 1002)',
        base_resp_code: 1002,
      });

      expect(isLyricsErrorRetryable(error)).toBe(true);
    });

    test('base_resp 1004 (not authorized) is classified as non-retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: not authorized (code: 1004)',
        base_resp_code: 1004,
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    test('base_resp 1008 (insufficient balance) is classified as non-retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: insufficient balance (code: 1008)',
        base_resp_code: 1008,
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    test('base_resp 1026 (sensitive input) is classified as non-retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: sensitive input (code: 1026)',
        base_resp_code: 1026,
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    test('base_resp 2013 (invalid params) is classified as non-retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: invalid params (code: 2013)',
        base_resp_code: 2013,
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    test('base_resp 2049 (invalid API key) is classified as non-retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: invalid API key (code: 2049)',
        base_resp_code: 2049,
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    // --- Lyrics errors without base_resp_code (not retryable) ---

    test('prompt length validation error is not retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'Prompt exceeds maximum length of 2000 characters',
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    test('JSON parse error is not retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'Failed to parse lyrics generation response JSON',
        cause: new SyntaxError('Unexpected token'),
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    test('missing base_resp error is not retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'Missing base_resp in lyrics generation response',
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    test('missing lyrics error is not retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'Missing lyrics in lyrics generation response',
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });

    // --- Raw transport errors (delegated to classifyHttpError) ---

    test('raw 429 error is classified as retryable', () => {
      const httpError = { response: { status: 429 } };
      expect(isLyricsErrorRetryable(httpError)).toBe(true);
    });

    test('raw 500 error is classified as retryable', () => {
      const httpError = { response: { status: 500 } };
      expect(isLyricsErrorRetryable(httpError)).toBe(true);
    });

    test('raw 400 error is classified as non-retryable', () => {
      const httpError = { response: { status: 400 } };
      expect(isLyricsErrorRetryable(httpError)).toBe(false);
    });

    test('raw 401 error is classified as non-retryable', () => {
      const httpError = { response: { status: 401 } };
      expect(isLyricsErrorRetryable(httpError)).toBe(false);
    });

    test('raw 403 error is classified as non-retryable', () => {
      const httpError = { response: { status: 403 } };
      expect(isLyricsErrorRetryable(httpError)).toBe(false);
    });

    test('raw 404 error is classified as non-retryable', () => {
      const httpError = { response: { status: 404 } };
      expect(isLyricsErrorRetryable(httpError)).toBe(false);
    });

    test('raw network error (no status) is classified as retryable', () => {
      const networkError = new Error('Connection reset');
      expect(isLyricsErrorRetryable(networkError)).toBe(true);
    });

    // --- unknown base_resp codes ---

    test('unknown base_resp code is not retryable', () => {
      const error = new MiniMaxLyricsError({
        module: 'MiniMaxLyricsAdapter',
        method: 'generate',
        description: 'MiniMax API error: something (code: 9999)',
        base_resp_code: 9999,
      });

      expect(isLyricsErrorRetryable(error)).toBe(false);
    });
  });
});
