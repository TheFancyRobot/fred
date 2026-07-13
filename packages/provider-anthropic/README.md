# @fancyrobot/fred-anthropic

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-anthropic)](https://www.npmjs.com/package/@fancyrobot/fred-anthropic)

Anthropic provider for Fred AI framework.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
and Effect AI lines.

## Installation

```bash
bun add @fancyrobot/fred-anthropic@4.0.0-alpha.1 \
  @fancyrobot/fred@2.0.0-alpha.2 effect@^3.21.5 \
  @effect/ai@^0.35.0 @effect/ai-anthropic@^0.25.0
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
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-anthropic';

const fred = await createFred();
await fred.providers.use('anthropic');
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

- [Fred core](https://github.com/TheFancyRobot/fred/blob/main/packages/core/README.md) -- main framework documentation
- [All packages](https://github.com/TheFancyRobot/fred#packages) -- monorepo overview

## License

MIT
