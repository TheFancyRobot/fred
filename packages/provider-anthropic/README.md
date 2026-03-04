# @fancyrobot/fred-anthropic

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-anthropic)](https://www.npmjs.com/package/@fancyrobot/fred-anthropic)

Anthropic provider for Fred AI framework.

## Installation

```bash
bun add @fancyrobot/fred-anthropic
```

## Setup

Set your API key:

```bash
export ANTHROPIC_API_KEY=your-api-key
```

## Usage

### Auto-Registration

Import the package to auto-register the provider:

```typescript
import '@fancyrobot/fred-anthropic';
```

This is the recommended approach -- the provider registers itself when imported.

### Programmatic

```typescript
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-anthropic';

const fred = new Fred();
fred.registerDefaultProviders();
```

### Config File (YAML)

```yaml
providers:
  - id: anthropic
    type: anthropic
```

### Agent File (.md)

```markdown
---
id: my-agent
platform: anthropic
model: claude-sonnet-4-20250514
---

You are a helpful assistant.
```

## Supported Models

See [Anthropic documentation](https://docs.anthropic.com/en/docs/about-claude/models) for available models.

## Related

- [Fred core](../core/README.md) -- main framework documentation
- [All packages](../../README.md) -- monorepo overview

## License

MIT
