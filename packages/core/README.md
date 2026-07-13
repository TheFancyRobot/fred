# @fancyrobot/fred
[![npm version](https://img.shields.io/npm/v/@fancyrobot/fred)](https://www.npmjs.com/package/@fancyrobot/fred)
TypeScript AI agent framework with intent-based routing and pipeline orchestration.

> Upgrading from `Fred`, `FredInstance`, or manager-style methods? Use the
> repository [migration guide](../../MIGRATION.md). Package versions are
> independent; the guide contains the exact compatible release matrix.

## Installation
```bash
bun add --exact @fancyrobot/fred@2.0.0-alpha.0 \
  effect@^3.21.0 @effect/ai@^0.35.0 @effect/platform@^0.96.0
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
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

const fred = await createFred({ configPath: 'config.yaml' });

const response = await fred.messages.process('Hello Fred!', {
  conversationId: 'quickstart',
});

console.log(response.content);
await fred.shutdown();
```

### Programmatic alternative (secondary)

```typescript
const fred = await createFred({
  routing: { defaultAgent: 'assistant', rules: [] },
});
await fred.providers.use('openrouter');
await fred.agents.register({
  id: 'assistant',
  systemMessage: 'You are concise and helpful.',
  platform: 'openrouter',
  model: 'openrouter/auto',
});
await fred.messages.process('What can you do?');
await fred.shutdown();
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
await fred.agents.register({
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

### Typed prompts and agent I/O

`systemMessage` accepts plain text, an explicit ETA template, or a BAML prompt
reference. BAML references require `@fancyrobot/fred-baml` and a
`BamlPromptSourceLayer`; core never imports generated BAML clients.

```typescript
import { Effect, Schema } from 'effect';

const Input = Schema.Struct({ question: Schema.String });
const Output = Schema.Struct({ answer: Schema.String, confidence: Schema.Number });

const agent = await fred.agents.register({
  id: 'typed-answer',
  platform: 'openai',
  model: 'gpt-4o-mini',
  systemMessage: {
    template: 'Answer as a concise <%= vars.role %>.',
    variables: { role: 'researcher' },
  },
  input: Input,
  output: Output,
  outputRetry: { maxRetries: 1 },
});

const response = await Effect.runPromise(
  agent.run({ question: 'What is Effect?' }),
);
console.log(response.output?.answer);
```

`input` and `output` are programmatic Effect Schemas; YAML and Markdown cannot
serialize live schema values. Output schemas must encode to objects; scalar and
array roots are rejected at agent creation. `outputRetry` retries only malformed
structured model output, not provider, network, or tool failures. Structured
agents use validated `processMessage` fallback events instead of exposing
unvalidated incremental JSON through `streamMessage`.

## Tools

### Effect Schema (recommended)

```typescript
import { Schema } from 'effect';

await fred.tools.register({
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
await fred.tools.register({
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
import { PipelineBuilder, createFred } from '@fancyrobot/fred';

const fred = await createFred();
const pipeline = new PipelineBuilder('classify-plan-summarize')
  .addAgentStep('classifier')
  .addAgentStep('planner')
  .addAgentStep('summarizer')
  .build();

await fred.workflows.define({ ...pipeline, checkpoint: { enabled: true } });
const result = await fred.workflows.run('classify-plan-summarize', 'Draft launch checklist');
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

await fred.workflows.define(workflow);
```

### Checkpoints and Pause/Resume

```typescript
const resumed = await fred.workflows.resume(runId, {
  humanInput: 'approve',
  resumeBehavior: 'continue',
});
```

## Hooks

Fred exposes 22 hook points across the message lifecycle.

```typescript
await fred.hooks.register('beforeMessageReceived', async (event) => {
  if (typeof event.data !== 'string') return;
  return { data: event.data.replace(/secret/gi, '[REDACTED]') };
});

await fred.hooks.register('afterResponseGenerated', async (event) => {
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
const fred = await createFred({ configPath: 'config.yaml' });
```

## Context and Persistence

### SQLite (local development)

```typescript
import { SqliteContextStorage } from '@fancyrobot/fred/context/sqlite';

const fred = await createFred({
  storage: new SqliteContextStorage({ path: './fred.db' }),
});
```

### Postgres (production)

```typescript
import { PostgresContextStorage } from '@fancyrobot/fred/context/postgres';

const fred = await createFred({
  storage: new PostgresContextStorage({
    connectionString: process.env.FRED_POSTGRES_URL!,
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
import { Effect } from 'effect';
import {
  AgentService,
  PipelineService,
  ProviderRegistryService,
} from '@fancyrobot/fred/effect';

const program = Effect.gen(function* () {
  const providers = yield* ProviderRegistryService;
  const agents = yield* AgentService;
  const pipelines = yield* PipelineService;

  return {
    providers: yield* providers.listProviders(),
    agents: yield* agents.getAllAgents(),
    pipelines: yield* pipelines.listWorkflows(),
  };
});

// Reuse the client's scoped services. Application entry points own this
// Promise boundary; domain logic stays as Effect.
const result = await fred.effects.run(program);
console.log(result);
```

Use this path when you need low-level service control or custom runtime wiring.

## Examples
See [examples/README.md](../../examples/README.md) for the 15-example learning
path covering quickstart, tools, routing, pipelines, hooks, observability,
evaluation, MCP, CLI/TUI, multi-agent orchestration, and optional HTTP.

## License

MIT
