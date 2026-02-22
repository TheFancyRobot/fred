# Fred

A TypeScript framework for building AI agents with intent-based routing, pipeline orchestration, and multi-provider support. Built on [Effect](https://effect.website) and [@effect/ai](https://github.com/Effect-TS/effect/tree/main/packages/ai) for the Bun runtime.

## Features

- **Intent-based routing** -- match messages to agents via exact, regex, or semantic matching
- **Pipeline orchestration** -- sequential and graph-based agent workflows with checkpointing and pause/resume
- **Multi-provider AI** -- OpenAI, Anthropic, Google, Groq, and OpenRouter via `@effect/ai`
- **Tool system** -- registry of reusable tools with Effect Schema or JSON Schema definitions
- **MCP integration** -- connect agents to Model Context Protocol servers for automatic tool discovery
- **Dynamic handoff** -- agents can transfer conversations to other agents via tool calls
- **Pipeline hooks** -- intercept and modify the message pipeline at 21 hook points
- **Observability** -- lightweight tracing with optional OpenTelemetry integration
- **Evaluation harness** -- golden trace-based testing for regression detection
- **YAML/JSON config** -- define agents, intents, pipelines, and tools declaratively
- **Interactive TUI** -- terminal chat interface with session management, streaming, and markdown rendering

## Installation

```bash
# Core package (required)
bun add @fancyrobot/fred effect

# Add providers as needed
bun add @fancyrobot/fred-openai @effect/ai-openai
bun add @fancyrobot/fred-anthropic @effect/ai-anthropic
bun add @fancyrobot/fred-google @effect/ai-google
bun add @fancyrobot/fred-groq @effect/platform
bun add @fancyrobot/fred-openrouter @effect/ai-openai

# CLI (optional)
bun add -g @fancyrobot/fred-cli
```

Each provider package auto-registers when imported.

### Requirements

- [Bun](https://bun.sh) >= 1.0
- At least one provider API key (e.g. `OPENAI_API_KEY`)

## Quick Start

```typescript
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openai'; // auto-registers provider

const fred = new Fred();
fred.registerDefaultProviders(); // reads API keys from environment

// Register a tool
fred.registerTool({
  id: 'calculator',
  name: 'calculator',
  description: 'Perform basic arithmetic',
  parameters: {
    type: 'object',
    properties: {
      operation: { type: 'string', enum: ['add', 'subtract'] },
      a: { type: 'number' },
      b: { type: 'number' },
    },
    required: ['operation', 'a', 'b'],
  },
  execute: async (args) => {
    return args.operation === 'add' ? args.a + args.b : args.a - args.b;
  },
});

// Create agents
await fred.createAgent({
  id: 'math-agent',
  systemMessage: './prompts/math-agent.md',
  platform: 'openai',
  model: 'gpt-4',
  tools: ['calculator'],
  utterances: ['calculate', 'math', 'compute'],
});

await fred.createAgent({
  id: 'default-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-4',
});
fred.setDefaultAgent('default-agent');

// Process a message
const response = await fred.processMessage('What is 15 + 27?', {
  conversationId: 'my-conversation',
});
console.log(response.content);
```

### Config File

Agents, intents, tools, and pipelines can also be defined in YAML or JSON:

```yaml
agents:
  - id: greeting-agent
    systemMessage: ./prompts/greeting.md
    platform: openai
    model: gpt-4
    utterances: [hello, hi, hey]

intents:
  - id: greeting
    utterances: [hello, hi]
    action:
      type: agent
      target: greeting-agent
```

```typescript
await fred.initializeFromConfig('config.yaml');
```

## CLI

The `fred` CLI provides interactive chat, resource inspection, and testing:

```bash
fred chat                    # Interactive TUI chat
fred run                     # Headless agent execution
fred agents                  # List agents
fred tools                   # List tools
fred providers               # List providers
fred session list             # List saved sessions
fred config validate          # Validate config file
fred init                    # Scaffold new project
fred test                    # Run golden trace tests
fred eval                    # Evaluation workflows
fred mcp list                # List MCP servers
```

## Development Chat

```bash
bun run dev
```

Starts an interactive terminal chat that auto-detects providers from environment variables. Works with zero configuration -- creates a temporary dev agent if none are configured.

## Server Mode

```bash
bun run server --config config.yaml --port 3000
```

Exposes an OpenAI-compatible API:

| Endpoint | Description |
|---|---|
| `POST /v1/chat/completions` | OpenAI-compatible chat (works with Chatbox, etc.) |
| `POST /chat` | Simplified chat endpoint |
| `POST /message` | Process with intent matching options |
| `GET /agents` | List agents |
| `GET /intents` | List intents |
| `GET /tools` | List tools |
| `GET /health` | Health check |

## Providers

| Provider | Package | Backend |
|---|---|---|
| OpenAI | `@fancyrobot/fred-openai` | `@effect/ai-openai` |
| Anthropic | `@fancyrobot/fred-anthropic` | `@effect/ai-anthropic` |
| Google | `@fancyrobot/fred-google` | `@effect/ai-google` |
| Groq | `@fancyrobot/fred-groq` | `@effect/ai` (Chat Completions) |
| OpenRouter | `@fancyrobot/fred-openrouter` | `@effect/ai-openai` |

Set API keys via environment variables:

```bash
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GOOGLE_GENERATIVE_AI_API_KEY=...
GROQ_API_KEY=...
OPENROUTER_API_KEY=...
```

Or pass them programmatically:

```typescript
const openai = await fred.useProvider('openai', { apiKey: 'your_key' });
```

## Architecture

Fred routes messages in priority order:

1. **Agent utterances** -- direct routing (highest priority)
2. **Intent matching** -- exact, then regex, then semantic similarity
3. **Default agent** -- fallback

The message pipeline supports 21 hook points across message lifecycle, intent resolution, agent selection, tool execution, routing, and pipeline orchestration. See the [Hooks documentation](https://sincspecv.github.io/fred/advanced/hooks/) for details.

## Documentation

Full guides, API reference, and examples: **[sincspecv.github.io/fred](https://sincspecv.github.io/fred)**

## Contributing

```bash
git clone https://github.com/TheFancyRobot/fred.git
cd fred
bun install

bun test           # Run all tests
bun test:unit      # Unit tests only
bun run build      # Build all packages
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT
