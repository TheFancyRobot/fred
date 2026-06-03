# @fancyrobot/fred-minimax

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-minimax)](https://www.npmjs.com/package/@fancyrobot/fred-minimax)

MiniMax multi-modality provider for Fred AI framework.

## Installation

```bash
bun add @fancyrobot/fred-minimax
```

## Setup

Set your API key:

```bash
export MINIMAX_API_KEY=your-api-key
```

## Usage

### Auto-Registration

Import the package to auto-register the provider:

```typescript
import '@fancyrobot/fred-minimax';
```

This is the recommended approach — the provider registers itself when imported.

### Programmatic

```typescript
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-minimax';

const fred = new Fred();
fred.registerDefaultProviders();
```

### Config File (YAML)

```yaml
providers:
  - id: minimax
    type: minimax
```

## Supported Capabilities

| Capability  | Status       | Description                              |
|-------------|-------------|------------------------------------------|
| Language    | Pending      | Chat completions via MiniMax API         |
| Image       | Pending      | Image generation                         |
| Video       | Pending      | Video generation                         |
| Speech      | Pending      | Text-to-speech                           |
| Voice       | Pending      | Voice cloning, design, and management    |
| Music       | Pending      | Music generation                         |

See [MiniMax documentation](https://www.minimaxi.com/en) for available models and APIs.

## Related

- [Fred core](../core/README.md) — main framework documentation
- [All packages](../../README.md) — monorepo overview

## License

MIT
