# @fancyrobot/fred-openrouter

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-openrouter)](https://www.npmjs.com/package/@fancyrobot/fred-openrouter)

OpenRouter provider for Fred AI framework.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
and Effect AI lines.

## Installation

```bash
bun add @fancyrobot/fred-openrouter@5.1.0 \
  @fancyrobot/fred@2.2.0 effect@^3.21.5 \
  @effect/ai@^0.35.0 @effect/ai-openrouter@^0.10.0
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
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

const fred = await createFred();
await fred.providers.use('openrouter');
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

- [Fred core](https://github.com/TheFancyRobot/fred/blob/main/packages/core/README.md) -- main framework documentation
- [All packages](https://github.com/TheFancyRobot/fred#packages) -- monorepo overview

## License

MIT
