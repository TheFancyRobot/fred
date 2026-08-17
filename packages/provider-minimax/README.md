# @fancyrobot/fred-minimax

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-minimax)](https://www.npmjs.com/package/@fancyrobot/fred-minimax)

MiniMax multi-modality provider for the Fred AI framework. Supports seven capabilities — language, image, video, speech, voice, music, and lyrics — through a single package.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
line and the Stanza provider migration recipe.

## Installation

```bash
bun add @fancyrobot/fred-minimax@2.1.0 \
  @fancyrobot/fred@2.1.1 effect@^3.21.5 \
  @effect/ai@^0.35.0 @effect/platform@^0.96.0
```

## Setup

Set your API key:

```bash
export MINIMAX_API_KEY=your-api-key
```

## Usage

### Auto-Registration (Recommended)

Import the package to auto-register the provider with Fred's pack registry:

```typescript
import '@fancyrobot/fred-minimax';
```

The provider registers itself on import — no manual `registerProvider()` call needed.

### Programmatic

```typescript
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-minimax';

const fred = await createFred();
await fred.providers.use('minimax');
```

### Browser-safe lyrics adapter

Browser bundles that only need lyrics generation can import the focused subpath:

```typescript
import { createMiniMaxLyricsAdapter } from '@fancyrobot/fred-minimax/lyrics';
```

This entrypoint does not auto-register the provider or import Fred core.

### Config File (YAML)

```yaml
providers:
  - id: minimax
    type: minimax
```

## Supported Capabilities

| Capability | Status | Adapter | Description |
|------------|--------|---------|-------------|
| Language | ✅ Stable | `language.ts` | Chat completions via OpenAI-compatible API |
| Image | ✅ Stable | `image.ts` | Text-to-image and image-to-image generation |
| Video | ✅ Stable | `video.ts` | Text-to-video and image-to-video (async) |
| Speech | ✅ Stable | `speech.ts` | Text-to-speech (sync and async) |
| Voice | ✅ Stable | `voice.ts` | Voice cloning, voice design, voice management |
| Music | ✅ Stable | `music.ts` | Song generation from text prompts and lyrics |
| Lyrics | ✅ Stable | `lyrics.ts` | Lyrics generation and editing for music workflows |

## Architecture: Compatibility Endpoint vs Native API

MiniMax exposes two API surfaces:

- **Compatibility endpoint** (`https://api.minimax.io/v1`): An OpenAI-compatible Chat Completions API used for the **language** capability. This mirrors the `/v1/chat/completions` endpoint shape so tools and streaming work identically to other OpenAI-compatible providers.

- **Native MiniMax API** (`https://api.minimax.io/v1`): Used for all multi-modality capabilities (image, video, speech, voice, music, lyrics). These endpoints use MiniMax's own request/response format with `base_resp` status fields. Each adapter module (`image.ts`, `video.ts`, etc.) calls the native API directly via `@effect/platform` HttpClient.

The provider factory (`MiniMaxProviderFactory`) delegates language model loading to the compatibility adapter and exports separate adapter creation functions for native capabilities.

### Default Base URL

```
https://api.minimax.io/v1
```

Override via `baseUrl` in config:

```yaml
providers:
  - id: minimax
    baseUrl: https://api.minimax.io/v1
```

## API Endpoints

| Capability | Endpoint | Method |
|------------|----------|--------|
| Language (compatibility) | `/chat/completions` | POST |
| Image generation | `/image_generation` | POST |
| Video generation (create) | `/video_generation` | POST |
| Video generation (query) | `/query/video_generation` | GET |
| Speech (sync TTS) | `/t2a_v2` | POST |
| Speech (async TTS) | `/t2a_async_v2` | POST |
| Voice clone | `/voice_clone` | POST |
| Voice design | `/voice_design` | POST |
| Voice list/get | `/get_voice` | POST |
| Voice delete | `/delete_voice` | POST |
| Music generation | `/music_generation` | POST |
| Lyrics generation | `/lyrics_generation` | POST |

## Error Handling

All adapters use `Data.TaggedError` for typed, catchable errors:

- `MiniMaxMissingApiKeyError` — thrown when `MINIMAX_API_KEY` is not set
- `MiniMaxLanguageModelError` — language/chat completion failures
- `MiniMaxImageError` — image generation failures
- `MiniMaxVideoError` — video generation/query failures
- `MiniMaxMusicError` — music generation failures
- `MiniMaxSpeechError` — TTS failures
- `MiniMaxVoiceError` — voice clone/design/management failures
- `MiniMaxLyricsError` — lyrics generation/editing failures

All errors share a common `{ module, method, description, cause? }` shape for consistent logging.

### Retry Behavior

Transient errors (5xx, 429 rate-limit, network failures) are retried automatically with exponential backoff (500ms → 1s → 2s, max 3 retries). Client errors (400, 401, 403, 404, 422) are not retried.

## Exports

```typescript
// Provider factory (auto-registers on import)
export { MiniMaxProviderFactory, minimaxPack } from '@fancyrobot/fred-minimax';

// Language
export { createMiniMaxLanguageModel, MiniMaxMissingApiKeyError, MiniMaxLanguageModelError } from '@fancyrobot/fred-minimax';

// Image
export { createMiniMaxImageAdapter, MiniMaxImageError } from '@fancyrobot/fred-minimax';

// Video
export { createMiniMaxVideoAdapter, MiniMaxVideoError } from '@fancyrobot/fred-minimax';

// Music
export { createMiniMaxMusicAdapter, MiniMaxMusicError } from '@fancyrobot/fred-minimax';

// Speech
export { createMiniMaxSpeechAdapter, MiniMaxSpeechError } from '@fancyrobot/fred-minimax';

// Voice
export { createMiniMaxVoiceAdapter, MiniMaxVoiceError } from '@fancyrobot/fred-minimax';

// Lyrics
export { createMiniMaxLyricsAdapter, MiniMaxLyricsError } from '@fancyrobot/fred-minimax/lyrics';
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `MINIMAX_API_KEY` | Yes | MiniMax API key for all capabilities |

Override the env var name in config:

```yaml
providers:
  - id: minimax
    apiKeyEnvVar: MY_CUSTOM_MINIMAX_KEY
```

## Related

- [Fred core](https://github.com/TheFancyRobot/fred/blob/main/packages/core/README.md) — main framework documentation
- [All packages](https://github.com/TheFancyRobot/fred#packages) — monorepo overview

## License

MIT
