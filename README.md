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

Install core + one provider package:

```bash
bun add @fancyrobot/fred @fancyrobot/fred-openrouter effect
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
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

const fred = await Fred.create();
await fred.initializeFromConfig('config.yaml');
const response = await fred.processMessage('Hello!', { conversationId: 'demo' });
console.log(response.content);
await fred.shutdown();
```

See the [core package documentation](packages/core/README.md) for the full getting-started guide and programmatic API.

## Packages

| Package | Description |
|---------|-------------|
| [@fancyrobot/fred](packages/core/README.md) | Core framework |
| [@fancyrobot/fred-cli](packages/cli/README.md) | CLI and TUI |
| [@fancyrobot/fred-dev](packages/dev/README.md) | Development tooling |
| [@fancyrobot/fred-openai](packages/provider-openai/README.md) | OpenAI provider |
| [@fancyrobot/fred-anthropic](packages/provider-anthropic/README.md) | Anthropic provider |
| [@fancyrobot/fred-google](packages/provider-google/README.md) | Google (Gemini) provider |
| [@fancyrobot/fred-groq](packages/provider-groq/README.md) | Groq provider |
| [@fancyrobot/fred-openrouter](packages/provider-openrouter/README.md) | OpenRouter provider |

## Examples

Fred includes 12 progressive examples covering quickstart, tools, routing, pipelines, hooks, MCP, and CLI/TUI usage. Start here: [examples/README.md](examples/README.md).

## Documentation

Full guides and API reference: [sincspecv.github.io/fred](https://sincspecv.github.io/fred)

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
