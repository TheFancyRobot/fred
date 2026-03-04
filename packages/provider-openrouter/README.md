# @fancyrobot/fred-openrouter

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-openrouter)](https://www.npmjs.com/package/@fancyrobot/fred-openrouter)

OpenRouter provider for Fred AI framework.

## Installation

```bash
bun add @fancyrobot/fred-openrouter
```

## Setup

Set your API key:

```bash
export OPENROUTER_API_KEY=your-api-key
```

## Usage

### Auto-Registration

Import the package to auto-register the provider:

```typescript
import '@fancyrobot/fred-openrouter';
```

This is the recommended approach -- the provider registers itself when imported.

### Programmatic

```typescript
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

const fred = new Fred();
fred.registerDefaultProviders();
```

### Config File (YAML)

```yaml
providers:
  - id: openrouter
    type: openrouter
```

### Agent File (.md)

```markdown
---
id: my-agent
platform: openrouter
model: openrouter/auto
---

You are a helpful assistant.
```

## Supported Models

See [OpenRouter documentation](https://openrouter.ai/models) for available models.

## Related

- [Fred core](../core/README.md) -- main framework documentation
- [All packages](../../README.md) -- monorepo overview

## License

MIT
