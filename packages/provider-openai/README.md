# @fancyrobot/fred-openai

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred-openai)](https://www.npmjs.com/package/@fancyrobot/fred-openai)

OpenAI provider for Fred AI framework.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
and Effect AI lines.

## Installation

```bash
bun add @fancyrobot/fred-openai@4.1.1 \
  @fancyrobot/fred@2.1.1 effect@^3.21.5 \
  @effect/ai@^0.35.0 @effect/ai-openai@^0.39.0 \
  @effect/ai-openrouter@^0.10.0 @effect/platform@^0.96.0
```

## Setup

Set your API key:

```bash
export OPENAI_API_KEY=your-api-key
```

## Generic OpenAI-Compatible Providers

Use any endpoint that implements the OpenAI Chat Completions protocol
(`POST {baseUrl}/chat/completions`) without creating a new provider package.
Create a factory with your own provider ID and register it on the client:

```typescript
import { createFred } from '@fancyrobot/fred';
import { createOpenAiCompatibleProviderFactory } from '@fancyrobot/fred-openai';

const fred = await createFred();
const definition = await fred.providers.registerFactory(
  createOpenAiCompatibleProviderFactory({ id: 'my-local-llm' }),
  {
    baseUrl: 'http://127.0.0.1:11434/v1',
    credentials: { kind: 'none' },
  },
);

await fred.agents.register({
  id: 'local-agent',
  platform: 'my-local-llm',
  model: 'llama3.1',
});
```

`createOpenAiCompatibleProviderFactory(options)` takes `{ id, aliases? }`,
is pure, and performs no side effects; the factory's `load` defers all
validation and client construction. `fred.providers.registerFactory(factory,
config?)` stores the factory under `factory.id`, calls `factory.load(config)`
once, and returns the stored `ProviderDefinition`.

### Capability floor

Generic compatible providers support text generation, SSE streaming, tool
calls, and JSON-schema structured output through `/chat/completions`. They
do not support embeddings, image generation, model discovery, retries, or
transport fallback.

### Endpoint and authentication rules

- `baseUrl` must be an absolute `http:` or `https:` URL without userinfo,
  query string, or fragment. Path prefixes such as `/v1` are preserved; the
  adapter appends exactly one `/chat/completions` suffix.
- Use `https:` for production endpoints. Plain `http:` is for loopback and
  trusted local networks only.
- `credentials` accepts `none`, `api-key` (sent as `Authorization: Bearer`),
  or `basic`. `oauth2-bearer` is rejected.
- A custom `Authorization` entry in `headers` is rejected rather than
  shadowed: authentication always comes from credentials.

Invalid configuration fails with `InvalidOpenAiCompatibleProviderConfigError`
before any network I/O, with a stable `reason`:

| Reason | Meaning |
| --- | --- |
| `missing-base-url` | `baseUrl` is absent or blank |
| `invalid-url` | `baseUrl` is not an absolute URL |
| `unsupported-scheme` | `baseUrl` scheme is not `http:` or `https:` |
| `userinfo` | `baseUrl` contains `user:pass@` |
| `query-string` | `baseUrl` contains a query string |
| `fragment` | `baseUrl` contains a fragment |
| `authorization-header` | `headers` contains an `Authorization` entry |
| `unsupported-credential-kind` | `credentials` kind is `oauth2-bearer` |

### Persistence

Hosted `openai` keeps its Responses transport; this factory never changes it.
For persisted endpoints, a saved `local-compatible` connection declaring the
`openai-compatible` protocol remains the recommended path and now shares this
same runtime and validation.

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
