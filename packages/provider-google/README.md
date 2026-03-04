# @fancyrobot/fred-google

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-google)](https://www.npmjs.com/package/@fancyrobot/fred-google)

Google (Gemini) provider for Fred AI framework.

## Installation

```bash
bun add @fancyrobot/fred-google
```

## Setup

Set your API key:

```bash
export GOOGLE_GENERATIVE_AI_API_KEY=your-api-key
```

## Usage

### Auto-Registration

Import the package to auto-register the provider:

```typescript
import '@fancyrobot/fred-google';
```

This is the recommended approach -- the provider registers itself when imported.

### Programmatic

```typescript
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-google';

const fred = new Fred();
fred.registerDefaultProviders();
```

### Config File (YAML)

```yaml
providers:
  - id: google
    type: google
```

### Agent File (.md)

```markdown
---
id: my-agent
platform: google
model: gemini-2.0-flash
---

You are a helpful assistant.
```

## Supported Models

See [Google documentation](https://ai.google.dev/gemini-api/docs/models) for available models.

## Related

- [Fred core](../core/README.md) -- main framework documentation
- [All packages](../../README.md) -- monorepo overview

## License

MIT
