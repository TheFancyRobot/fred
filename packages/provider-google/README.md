# @fancyrobot/fred-google

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-google)](https://www.npmjs.com/package/@fancyrobot/fred-google)

Google (Gemini) provider for Fred AI framework.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
and Effect AI lines.

## Installation

```bash
bun add @fancyrobot/fred-google@4.0.0-alpha.2 \
  @fancyrobot/fred@2.0.0-alpha.2 effect@^3.21.5 \
  @effect/ai@^0.35.0 @effect/ai-google@^0.14.0 @effect/platform@^0.96.0
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
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-google';

const fred = await createFred();
await fred.providers.use('google');
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

- [Fred core](https://github.com/TheFancyRobot/fred/blob/main/packages/core/README.md) -- main framework documentation
- [All packages](https://github.com/TheFancyRobot/fred#packages) -- monorepo overview

## License

MIT
