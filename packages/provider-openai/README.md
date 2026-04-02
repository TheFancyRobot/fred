# @fancyrobot/fred-openai

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-openai)](https://www.npmjs.com/package/@fancyrobot/fred-openai)

OpenAI provider for Fred AI framework.

## Installation

```bash
bun add @fancyrobot/fred-openai
```

## Setup

Set your API key:

```bash
export OPENAI_API_KEY=your-api-key
```

## Usage

### Auto-Registration

Import the package to auto-register the provider:

```typescript
import '@fancyrobot/fred-openai';
```

This is the recommended approach -- the provider registers itself when imported.

### Programmatic

```typescript
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openai';

const fred = new Fred();
fred.registerDefaultProviders();
```

### Config File (YAML)

```yaml
providers:
  - id: openai
    type: openai
```

### Agent File (.md)

```markdown
---
id: my-agent
platform: openai
model: gpt-4o
---

You are a helpful assistant.
```

## Supported Models

See [OpenAI documentation](https://platform.openai.com/docs/models) for available models.

## Related

- [Fred core](../core/README.md) -- main framework documentation
- [All packages](../../README.md) -- monorepo overview

## License

MIT
