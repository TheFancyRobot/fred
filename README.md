# Fred

[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred)](https://www.npmjs.com/package/@fancyrobot/fred)
[![CI](https://github.com/TheFancyRobot/fred/actions/workflows/ci.yml/badge.svg)](https://github.com/TheFancyRobot/fred/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Fred is a TypeScript framework for building AI agents with intent-based routing, pipeline orchestration, and multi-provider support. It is built on [Effect](https://effect.website) for reliability and designed to run on [Bun](https://bun.sh).

## Features

- Intent-based routing with exact, regex, and semantic matching
- Sequential pipelines and graph workflows with checkpoint/resume support
- Reusable tools with Effect Schema or JSON Schema definitions
- Agent handoff, hooks, and middleware across the message lifecycle
- Built-in support for CLI/TUI workflows, local dev server mode, and evaluation

## Quick Start

> Migrating from the legacy `Fred` facade or HTTP adapters? Read the
> [Phase 68 migration guide](MIGRATION.md) and its exact independent-version
> compatibility matrix before installing prereleases.

Install core + one provider package:

```bash
bun add --exact \
  @fancyrobot/fred@2.0.0-alpha.0 \
  @fancyrobot/fred-openrouter@5.0.0-alpha.0 \
  effect@^3.21.0 @effect/ai@^0.35.0 \
  @effect/platform@^0.96.0 @effect/ai-openrouter@^0.10.0
```

Create an agent file at `src/agents/assistant.md`:

```markdown
---
id: assistant
platform: openrouter
model: openrouter/auto
---

You are a concise and helpful assistant.
```

Create `config.yaml`:

```yaml
providers:
  - id: openrouter
    type: openrouter
agentDirs:
  - ./src/agents
routing:
  defaultAgent: assistant
  rules: []
```

Use it from TypeScript:

```typescript
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

const fred = await createFred({ configPath: 'config.yaml' });
const response = await fred.messages.process('Hello!', { conversationId: 'demo' });
console.log(response.content);
await fred.shutdown();
```

See the [core package documentation](packages/core/README.md) for the full getting-started guide and programmatic API.

## Packages

| Package | Current prerelease | Description |
|---------|--------------------|-------------|
| [@fancyrobot/fred](packages/core/README.md) | `2.0.0-alpha.0` | Core framework |
| [@fancyrobot/fred-cli](packages/cli/README.md) | `0.5.1-alpha.0` | CLI, development chat, and interactive TUI |
| [@fancyrobot/fred-dev](packages/dev/README.md) | `1.0.0-alpha.0` | Deprecated one-release CLI compatibility shim |
| [@fancyrobot/fred-http](packages/fred-http/README.md) | `1.0.0-alpha.0` | Bun HTTP server and composable API layer |
| [@fancyrobot/fred-baml](packages/fred-baml/README.md) | `1.0.0-alpha.0` | Consumer-owned BAML integration |
| [@fancyrobot/fred-convex](packages/fred-convex/README.md) | `1.0.0-alpha.0` | Convex integration helpers |
| [@fancyrobot/fred-openai](packages/provider-openai/README.md) | `4.0.0-alpha.0` | OpenAI provider |
| [@fancyrobot/fred-anthropic](packages/provider-anthropic/README.md) | `4.0.0-alpha.0` | Anthropic provider |
| [@fancyrobot/fred-google](packages/provider-google/README.md) | `4.0.0-alpha.0` | Google (Gemini) provider |
| [@fancyrobot/fred-groq](packages/provider-groq/README.md) | `4.0.0-alpha.0` | Groq provider |
| [@fancyrobot/fred-openrouter](packages/provider-openrouter/README.md) | `5.0.0-alpha.0` | OpenRouter provider |
| [@fancyrobot/fred-minimax](packages/provider-minimax/README.md) | `2.0.0-alpha.0` | MiniMax multi-modality provider |

Packages intentionally retain independent major lines. The
[compatibility matrix](MIGRATION.md#package-compatibility-matrix), not a shared
Fred version number, defines a release set.

## Examples

Fred includes 15 progressive examples covering quickstart, tools, routing,
pipelines, hooks, MCP, CLI/TUI, multi-agent orchestration, and the optional HTTP
layer. Start here: [examples/README.md](examples/README.md).

## Documentation

Full guides and API reference:
[TheFancyRobot.github.io/fred](https://TheFancyRobot.github.io/fred)

Release operators should also read the [release runbook](RELEASE.md).

## Contributing

```bash
git clone https://github.com/TheFancyRobot/fred.git
cd fred
bun install
bun test
bun run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for development workflow details.

## License

MIT
