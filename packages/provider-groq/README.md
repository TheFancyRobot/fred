# @fancyrobot/fred-groq

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-groq)](https://www.npmjs.com/package/@fancyrobot/fred-groq)

Groq provider for Fred AI framework.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
and Effect AI lines.

## Installation

```bash
bun add @fancyrobot/fred-groq@4.0.0-alpha.2 \
  @fancyrobot/fred@2.0.0-alpha.2 effect@^3.21.5 \
  @effect/ai@^0.35.0 @effect/platform@^0.96.0
```

## Setup

Set your API key:

```bash
export GROQ_API_KEY=your-api-key
```

## Usage

### Auto-Registration

Import the package to auto-register the provider:

```typescript
import '@fancyrobot/fred-groq';
```

This is the recommended approach -- the provider registers itself when imported.

### Programmatic

```typescript
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-groq';

const fred = await createFred();
await fred.providers.use('groq');
```

### Config File (YAML)

```yaml
providers:
  - id: groq
    type: groq
```

### Agent File (.md)

```markdown
---
id: my-agent
platform: groq
model: llama-3.3-70b-versatile
---

You are a helpful assistant.
```

## Supported Models

See [Groq documentation](https://console.groq.com/docs/models) for available models.

## Related

- [Fred core](https://github.com/TheFancyRobot/fred/blob/main/packages/core/README.md) -- main framework documentation
- [All packages](https://github.com/TheFancyRobot/fred#packages) -- monorepo overview

## License

MIT
