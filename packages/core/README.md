# @fancyrobot/fred
[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred)](https://www.npmjs.com/package/@fancyrobot/fred)
TypeScript AI agent framework with intent-based routing and pipeline orchestration.

## Installation
```bash
bun add @fancyrobot/fred effect
```

Add at least one provider package:

- [@fancyrobot/fred-openrouter](../provider-openrouter/README.md) (or any provider in the [Providers](#providers) table below)

## Quick Start
Recommended workflow: markdown agent files (`.md`) + `config.yaml`.

### 1) Create an agent file

Create `src/agents/assistant.md`:

```markdown
---
id: assistant
platform: openrouter
model: openrouter/auto
utterances:
  - hello
  - help
---

You are a concise, practical assistant.
```

### 2) Create config.yaml

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

### 3) Initialize and send a message

```typescript
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

const fred = await Fred.create();
await fred.initializeFromConfig('config.yaml');

const response = await fred.processMessage('Hello Fred!', {
  conversationId: 'quickstart',
});

console.log(response.content);
await fred.shutdown();
```

### Programmatic alternative (secondary)

```typescript
const fred = new Fred();
fred.registerDefaultProviders();
await fred.createAgent({
  id: 'assistant',
  systemMessage: 'You are concise and helpful.',
  platform: 'openrouter',
  model: 'openrouter/auto',
});
fred.setDefaultAgent('assistant');
await fred.processMessage('What can you do?');
```

## Agents

### Markdown Agent Files (Recommended)

Agent files use YAML frontmatter for runtime configuration and markdown body for the prompt.

```markdown
---
id: support-agent
platform: openai
model: gpt-4o
tools:
  - calculator
utterances:
  - billing
  - invoice
  - /refund/i
---

You are a billing specialist.
Explain charges clearly and ask for missing details.
```

- Configure discovery directories with `agentDirs` and keep agents in `src/agents`

### Programmatic Agents

```typescript
await fred.createAgent({
  id: 'triage',
  systemMessage: 'Route requests to the right specialist.',
  platform: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  tools: ['calculator'],
  utterances: ['urgent', 'outage', /priority/i],
});
```

### ETA Templates

Prompts support ETA templating for expressions, conditionals, loops, and partials.
See the [Examples](#examples) section for end-to-end patterns.

## Tools

### Effect Schema (recommended)

```typescript
import { Schema } from 'effect';

fred.registerTool({
  id: 'weather',
  name: 'weather',
  description: 'Get weather for a city',
  schema: {
    input: Schema.Struct({ city: Schema.String }),
    success: Schema.String,
    metadata: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
  },
  execute: async ({ city }) => `Sunny in ${city}`,
});
```

### Legacy JSON Schema

```typescript
fred.registerTool({
  id: 'lookup-order',
  name: 'lookup-order',
  description: 'Get order status by ID',
  parameters: {
    type: 'object',
    properties: {
      orderId: { type: 'string' },
    },
    required: ['orderId'],
  },
  execute: async ({ orderId }) => `Order ${orderId}: in transit`,
});
```

Fred also includes a built-in calculator tool via `@fancyrobot/fred/tools`.

## Intent Routing

```yaml
intents:
  - id: billing
    utterances: [billing, invoice, /refund/i]
    action:
      type: agent
      target: billing-agent

routing:
  defaultAgent: billing-agent
  rules: []
```

Priority: `utterances` -> `intents` -> `routing.defaultAgent`.

## Pipelines

### Sequential Pipelines

```typescript
import { PipelineBuilder } from '@fancyrobot/fred';

const pipeline = new PipelineBuilder('classify-plan-summarize')
  .addAgentStep('classifier')
  .addAgentStep('planner')
  .addAgentStep('summarizer')
  .build();

await fred.createPipeline({ ...pipeline, checkpoint: { enabled: true } });
const result = await fred.executePipeline('classify-plan-summarize', 'Draft launch checklist');
console.log(result.finalOutput);
```

### Graph Workflows

```typescript
import { GraphWorkflowBuilder } from '@fancyrobot/fred';

const workflow = new GraphWorkflowBuilder('research-flow')
  .addNode('classifier', { type: 'agent', agentId: 'classifier' })
  .addNode('factual', { type: 'agent', agentId: 'researcher' })
  .addNode('creative', { type: 'agent', agentId: 'ideator' })
  .addNode('merge', { type: 'agent', agentId: 'synthesizer' })
  .addEdge('classifier', 'factual')
  .setDefaultEdge('classifier', 'creative')
  .addEdge('factual', 'merge')
  .addEdge('creative', 'merge')
  .setEntry('classifier')
  .build();

fred.registerGraphWorkflow(workflow);
```

### Checkpoints and Pause/Resume

```typescript
const resumed = await fred.resume(runId, {
  humanInput: 'approve',
  resumeBehavior: 'continue',
});
```

## Hooks

Fred exposes 21 hook points across the message lifecycle.

```typescript
fred.registerHook('beforeMessageReceived', async (event) => {
  if (typeof event.data !== 'string') return;
  return { data: event.data.replace(/secret/gi, '[REDACTED]') };
});

fred.registerHook('afterResponseGenerated', async (event) => {
  console.log('Generated response:', event.data);
});
```

## Configuration

### YAML Config

```yaml
providers:
  - id: openai
    type: openai

agentDirs:
  - ./src/agents

agents:
  - id: fallback-agent
    systemMessage: ./prompts/fallback.md
    platform: openai
    model: gpt-4o

intents:
  - id: refunds
    utterances: [refund, chargeback]
    action:
      type: agent
      target: support-agent

routing:
  defaultAgent: fallback-agent
  rules: []
```

### Config API

```typescript
await fred.initializeFromConfig('config.yaml');
```

## Context and Persistence

### SQLite (local development)

```typescript
import { SqliteContextStorage } from '@fancyrobot/fred/context/sqlite';

const fred = new Fred({
  storage: new SqliteContextStorage({ path: './fred.db' }),
});
```

### Postgres (production)

```typescript
import { PostgresContextStorage } from '@fancyrobot/fred/context/postgres';

const fred = new Fred({
  storage: new PostgresContextStorage({
    connectionString: process.env.FRED_POSTGRES_URL,
  }),
});
```

## Providers

| Provider | Package | Env Variable |
|----------|---------|-------------|
| OpenAI | [@fancyrobot/fred-openai](../provider-openai/README.md) | `OPENAI_API_KEY` |
| Anthropic | [@fancyrobot/fred-anthropic](../provider-anthropic/README.md) | `ANTHROPIC_API_KEY` |
| Google | [@fancyrobot/fred-google](../provider-google/README.md) | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Groq | [@fancyrobot/fred-groq](../provider-groq/README.md) | `GROQ_API_KEY` |
| OpenRouter | [@fancyrobot/fred-openrouter](../provider-openrouter/README.md) | `OPENROUTER_API_KEY` |
| MiniMax | [@fancyrobot/fred-minimax](../provider-minimax/README.md) | `MINIMAX_API_KEY` |

## Advanced: Effect Services

Fred is built on Effect and exposes service tags for custom Layer composition.

```typescript
import { Effect, Runtime } from 'effect';
import {
  FredLayers,
  AgentService,
  PipelineService,
  ProviderRegistryService,
} from '@fancyrobot/fred';

const program = Effect.gen(function* () {
  const providers = yield* ProviderRegistryService;
  const agents = yield* AgentService;
  const pipelines = yield* PipelineService;

  return {
    providers: yield* providers.listProviders(),
    agents: yield* agents.listAgents(),
    pipelines: yield* pipelines.listPipelines(),
  };
}).pipe(Effect.provide(FredLayers));

const result = await Runtime.runPromise(Runtime.defaultRuntime)(program);
console.log(result);
```

Use this path when you need low-level service control or custom runtime wiring.

## Examples
See [examples/README.md](../../examples/README.md) for the 12-example learning path covering quickstart, tools, routing, pipelines, hooks, observability, evaluation, MCP integration, and CLI/TUI workflows.

## License

MIT
