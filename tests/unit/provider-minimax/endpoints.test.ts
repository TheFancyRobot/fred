import { afterEach, describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import { FetchHttpClient } from '@effect/platform';
import {
  MINIMAX_DEFAULT_BASE_URL,
  MINIMAX_NATIVE_BASE_URL,
} from '../../../packages/provider-minimax/src/config';
import { createMiniMaxImageAdapter, MINIMAX_IMAGE_ENDPOINT } from '../../../packages/provider-minimax/src/image';
import {
  createMiniMaxVideoAdapter,
  MINIMAX_VIDEO_GENERATION_ENDPOINT,
  MINIMAX_VIDEO_QUERY_ENDPOINT,
} from '../../../packages/provider-minimax/src/video';
import { createMiniMaxMusicAdapter, MINIMAX_MUSIC_ENDPOINT } from '../../../packages/provider-minimax/src/music';
import {
  createMiniMaxSpeechAdapter,
  MINIMAX_TTS_ASYNC_ENDPOINT,
  MINIMAX_TTS_ENDPOINT,
} from '../../../packages/provider-minimax/src/speech';
import {
  createMiniMaxVoiceAdapter,
  MINIMAX_VOICE_CLONE_ENDPOINT,
  MINIMAX_VOICE_DELETE_ENDPOINT,
  MINIMAX_VOICE_DESIGN_ENDPOINT,
  MINIMAX_VOICE_LIST_ENDPOINT,
} from '../../../packages/provider-minimax/src/voice';
import { createMiniMaxLyricsAdapter, MINIMAX_LYRICS_ENDPOINT } from '../../../packages/provider-minimax/src/lyrics';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(capturedUrls: string[]) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    capturedUrls.push(url);

    const baseResp = { status_code: 0, status_msg: 'success' };
    let body: unknown = { base_resp: baseResp };

    if (url.includes('/image_generation')) {
      body = { base_resp: baseResp, image_urls: ['https://example.com/image.png'] };
    } else if (url.includes('/query/video_generation')) {
      body = { base_resp: baseResp, task_id: 'video-task', status: 'Success', file_id: 'file-1' };
    } else if (url.includes('/video_generation')) {
      body = { base_resp: baseResp, task_id: 'video-task' };
    } else if (url.includes('/music_generation')) {
      body = { base_resp: baseResp, audio_url: 'https://example.com/song.mp3' };
    } else if (url.includes('/t2a_async_v2')) {
      body = { base_resp: baseResp, task_id: 'speech-task' };
    } else if (url.includes('/t2a_v2')) {
      body = { base_resp: baseResp, data: { audio: '00ff' } };
    } else if (url.includes('/voice_clone')) {
      body = { base_resp: baseResp, voice_id: 'voice-clone' };
    } else if (url.includes('/voice_design')) {
      body = { base_resp: baseResp, voice_id: 'voice-design' };
    } else if (url.includes('/get_voice')) {
      body = { base_resp: baseResp, voices: [] };
    } else if (url.includes('/delete_voice')) {
      body = { base_resp: baseResp };
    } else if (url.includes('/lyrics_generation')) {
      body = { base_resp: baseResp, lyrics: '[Verse]\nTest lyric' };
    }

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

describe('MiniMax endpoint and base URL configuration', () => {
  test('uses the current official MiniMax API host for language and native defaults', () => {
    expect(MINIMAX_DEFAULT_BASE_URL).toBe('https://api.minimax.io/v1');
    expect(MINIMAX_NATIVE_BASE_URL).toBe('https://api.minimax.io/v1');
  });

  test('native endpoint constants are relative to the /v1 base URL', () => {
    expect(MINIMAX_IMAGE_ENDPOINT).toBe('/image_generation');
    expect(MINIMAX_VIDEO_GENERATION_ENDPOINT).toBe('/video_generation');
    expect(MINIMAX_VIDEO_QUERY_ENDPOINT).toBe('/query/video_generation');
    expect(MINIMAX_MUSIC_ENDPOINT).toBe('/music_generation');
    expect(MINIMAX_TTS_ENDPOINT).toBe('/t2a_v2');
    expect(MINIMAX_TTS_ASYNC_ENDPOINT).toBe('/t2a_async_v2');
    expect(MINIMAX_VOICE_CLONE_ENDPOINT).toBe('/voice_clone');
    expect(MINIMAX_VOICE_DESIGN_ENDPOINT).toBe('/voice_design');
    expect(MINIMAX_VOICE_LIST_ENDPOINT).toBe('/get_voice');
    expect(MINIMAX_VOICE_DELETE_ENDPOINT).toBe('/delete_voice');
    expect(MINIMAX_LYRICS_ENDPOINT).toBe('/lyrics_generation');
  });

  test('native adapters default to documented api.minimax.io/v1 URLs', async () => {
    const capturedUrls: string[] = [];
    mockFetch(capturedUrls);

    const image = createMiniMaxImageAdapter('test-key');
    const video = createMiniMaxVideoAdapter('test-key');
    const music = createMiniMaxMusicAdapter('test-key');
    const speech = createMiniMaxSpeechAdapter('test-key');
    const voice = createMiniMaxVoiceAdapter('test-key');
    const lyrics = createMiniMaxLyricsAdapter('test-key');

    const run = <A, E>(effect: Effect.Effect<A, E>) =>
      Effect.runPromise(effect.pipe(Effect.provide(FetchHttpClient.layer)));

    await run(image.generate({ model: 'image-01', prompt: 'sunset' }));
    await run(video.createTask({ model: 'video-01', prompt: 'cat' }));
    await run(video.queryTask({ task_id: 'video-task' }));
    await run(music.generate({ model: 'music-01', prompt: 'bright pop' }));
    await run(speech.synthesize({ model: 'speech-02', text: 'hello' }));
    await run(speech.createAsyncTask({ model: 'speech-02', text: 'long text' }));
    await run(voice.clone({ audio_source: 'https://example.com/voice.mp3' }));
    await run(voice.design({ prompt: 'warm narrator', preview_text: 'hello' }));
    await run(voice.list());
    await run(voice.delete({ voice_id: 'voice-design' }));
    await run(lyrics.generate({ mode: 'write_full_song', prompt: 'write a hook' }));

    expect(capturedUrls).toEqual([
      'https://api.minimax.io/v1/image_generation',
      'https://api.minimax.io/v1/video_generation',
      'https://api.minimax.io/v1/query/video_generation?task_id=video-task',
      'https://api.minimax.io/v1/music_generation',
      'https://api.minimax.io/v1/t2a_v2',
      'https://api.minimax.io/v1/t2a_async_v2',
      'https://api.minimax.io/v1/voice_clone',
      'https://api.minimax.io/v1/voice_design',
      'https://api.minimax.io/v1/get_voice',
      'https://api.minimax.io/v1/delete_voice',
      'https://api.minimax.io/v1/lyrics_generation',
    ]);
  });
});
