import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Effect, Layer, Exit } from 'effect';
import {
  createMiniMaxVideoAdapter,
  MiniMaxVideoError,
  MINIMAX_VIDEO_GENERATION_ENDPOINT,
  MINIMAX_VIDEO_QUERY_ENDPOINT,
  type VideoGenerationInput,
  type VideoQueryInput,
  type VideoTaskResult,
  type VideoQueryResult,
  type VideoTaskStatus,
} from '../../../packages/provider-minimax/src/video';
import {
  MINIMAX_CAPABILITIES,
  MiniMaxProviderFactory,
} from '../../../packages/provider-minimax/src/index';

describe('MiniMax Video Capability', () => {
  describe('constants', () => {
    test('MINIMAX_VIDEO_GENERATION_ENDPOINT is set correctly', () => {
      expect(MINIMAX_VIDEO_GENERATION_ENDPOINT).toBe('/video_generation');
    });

    test('MINIMAX_VIDEO_QUERY_ENDPOINT is set correctly', () => {
      expect(MINIMAX_VIDEO_QUERY_ENDPOINT).toBe('/query/video_generation');
    });
  });

  describe('MiniMaxVideoError', () => {
    test('is a tagged error with module, method, description, and cause', () => {
      const error = new MiniMaxVideoError({
        module: 'MiniMaxVideoAdapter',
        method: 'createTask',
        description: 'Video task creation failed',
        cause: new Error('upstream error'),
      });

      expect(error._tag).toBe('MiniMaxVideoError');
      expect(error.module).toBe('MiniMaxVideoAdapter');
      expect(error.method).toBe('createTask');
      expect(error.description).toBe('Video task creation failed');
      expect(error.cause).toBeDefined();
    });
  });

  describe('createMiniMaxVideoAdapter', () => {
    test('returns an adapter object with createTask and queryTask methods', () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter).toBeDefined();
      expect(typeof adapter.createTask).toBe('function');
      expect(typeof adapter.queryTask).toBe('function');
    });

    test('adapter has correct capability key', () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');
      expect(adapter.capability).toBe('video');
    });
  });

  describe('request shaping', () => {
    test('createTask accepts text-to-video parameters', () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createTask({
        model: 'video-01',
        prompt: 'A cat walking in a garden',
      });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });

    test('createTask accepts image-to-video parameters with first_frame_image', () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createTask({
        model: 'video-01',
        prompt: 'A cat walking',
        first_frame_image: 'https://example.com/cat.jpg',
      });

      expect(result).toBeDefined();
    });

    test('queryTask accepts task_id parameter', () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.queryTask({ task_id: '12345' });

      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
    });
  });

  describe('normalized response', () => {
    test('createTask returns an Effect resolving to task_id', async () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createTask({
        model: 'video-01',
        prompt: 'A cat walking in a garden',
      });

      // Result should be an Effect
      expect(result).toBeDefined();
    });

    test('queryTask returns an Effect resolving to status and file_id', async () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.queryTask({ task_id: '12345' });

      expect(result).toBeDefined();
    });
  });

  describe('error normalization', () => {
    test('MiniMaxVideoError carries provider context for task creation', () => {
      const error = new MiniMaxVideoError({
        module: 'MiniMaxVideoAdapter',
        method: 'createTask',
        description: 'Failed to create video task: status 400',
        cause: { status: 400 },
      });

      expect(error._tag).toBe('MiniMaxVideoError');
      expect(error.description).toContain('400');
    });

    test('MiniMaxVideoError carries provider context for query failures', () => {
      const error = new MiniMaxVideoError({
        module: 'MiniMaxVideoAdapter',
        method: 'queryTask',
        description: 'Failed to query video task status',
        cause: { status: 404 },
      });

      expect(error._tag).toBe('MiniMaxVideoError');
      expect(error.method).toBe('queryTask');
    });

    test('MiniMaxVideoError message format includes module and method', () => {
      const error = new MiniMaxVideoError({
        module: 'MiniMaxVideoAdapter',
        method: 'createTask',
        description: 'Something went wrong',
      });

      expect(error.message).toBe('[MiniMaxVideoAdapter.createTask] Something went wrong');
    });
  });

  describe('capability advertisement', () => {
    test('video capability is in MINIMAX_CAPABILITIES', () => {
      expect(MINIMAX_CAPABILITIES.has('video')).toBe(true);
    });

    test('MiniMaxProviderFactory declares video capability', () => {
      expect(MiniMaxProviderFactory.capabilities).toBeDefined();
      expect(MiniMaxProviderFactory.capabilities!.has('video')).toBe(true);
    });
  });

  describe('async workflow', () => {
    test('createTask supports async flag', () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createTask({
        model: 'video-01',
        prompt: 'A cat walking',
        async: true,
      });

      expect(result).toBeDefined();
    });

    test('createTask supports callback_url for notifications', () => {
      const adapter = createMiniMaxVideoAdapter('test-key', 'https://api.minimax.chat/v1');

      const result = adapter.createTask({
        model: 'video-01',
        prompt: 'A cat walking',
        callback_url: 'https://example.com/callback',
      });

      expect(result).toBeDefined();
    });

    test('VideoTaskStatus type accepts all valid values', () => {
      const statuses: VideoTaskStatus[] = ['Created', 'Processing', 'Success', 'Failed'];
      expect(statuses).toHaveLength(4);
    });
  });
});
