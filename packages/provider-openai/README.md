# @fancyrobot/fred-openai

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-openai)](https://www.npmjs.com/package/@fancyrobot/fred-openai)

OpenAI provider for Fred AI framework.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
and Effect AI lines.

## Installation

```bash
bun add @fancyrobot/fred-openai@4.1.1 \
  @fancyrobot/fred@2.1.0 effect@^3.21.5 \
  @effect/ai@^0.35.0 @effect/ai-openai@^0.39.0 \
  @effect/ai-openrouter@^0.10.0
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
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openai';

const fred = await createFred();
await fred.providers.use('openai');
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

Saved `local-compatible` connections that declare `openai-compatible` use the
Chat Completions protocol, including JSON-schema structured output. Hosted
OpenAI keeps the Responses transport.

## Related

- [Fred core](https://github.com/TheFancyRobot/fred/blob/main/packages/core/README.md) -- main framework documentation
- [All packages](https://github.com/TheFancyRobot/fred#packages) -- monorepo overview

## License

MIT
