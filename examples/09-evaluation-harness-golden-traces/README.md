# 09 - Typed Agents + Golden Trace Assertions

This example pairs a schema-backed agent with a deterministic golden trace. The
test suite never calls a model.

- `src/typed-agent.ts`: input/output Effect Schemas and the typed agent config
- `config.yaml` and `src/agents/billing.md`: the unchanged declarative string-prompt path
- `src/index.ts`: an optional live demo that calls `agent.run(typedInput)`
- `test/eval.test.ts`: offline schema validation and golden assertions
- `src/baml-layer.ts`: BAML prompt adapter composition without a core BAML dependency

## Architecture

### Typed agent (`src/typed-agent.ts`)

- Validates a `RefundRequest` before provider execution
- Requests a `RefundDecision` through `LanguageModel.generateObject`
- Exposes the decoded value as `response.output`
- Allows one additional attempt only when the provider reports malformed output

### Eval runtime (`test/eval.test.ts`)

- Runs assertion checks against `test/golden-traces/sample.golden.json`
- Uses `@fancyrobot/fred/eval`
- Does not depend on live inference for test execution
- Checks `output.decision`, `output.refundAmount`, and `output.currency` with
  `response.pathEquals`
- Decodes the fixture input and output with the same Effect Schemas as the agent

## System message forms

`AgentConfig.systemMessage` accepts three forms:

```typescript
// Plain text or a markdown path
systemMessage: 'You are a billing specialist.'

// Eta template plus local variables
systemMessage: {
  template: 'Use a <%= vars.tone %> tone.',
  variables: { tone: 'clear' },
}

// Function rendered by an installed BAML prompt adapter
systemMessage: { baml: { function: 'BuildBillingPrompt' } }
```

The BAML adapter is supplied at Fred's Effect layer boundary:

```typescript
import { makeFredRuntimeLayer } from '@fancyrobot/fred';
import { BamlPromptSourceLayer } from '@fancyrobot/fred-baml';

const promptSourceLayer = BamlPromptSourceLayer(
  ({ functionName, input }) => generatedPromptRenderer(functionName, input),
);

const fredLayer = makeFredRuntimeLayer({ promptSourceLayer });
```

The adapter receives the BAML function name, agent ID, and decoded agent input.
Fred core does not import a generated BAML client.

## Structured streaming

An agent with an `output` schema validates its complete model result before it
is exposed. When that agent streams through the Effect-native agent service,
Fred emits a
validated synthetic stream rather than partial structured JSON. The final
`run-end` event carries the decoded value at `event.result.output`. A malformed
result fails validation (after any configured malformed-only retries), so an
invalid object is never published as a successful stream result.

## Why this structure matters

You can iterate on prompts and schemas in TypeScript while keeping regression
checks deterministic. `input` and `output` are programmatic-only because Effect
Schemas are runtime values; YAML/JSON agent files continue to describe
serializable agent settings.

## Prerequisites

- Bun installed
- `OPENROUTER_API_KEY` in `.env` only for the optional live demo

```bash
cp .env.example .env
```

## Run the app demo

```bash
bun run src/index.ts
```

## Run eval assertions

```bash
bun test
```

## Files

- `src/index.ts` - Standalone app entry point
- `src/typed-agent.ts` - Typed agent config and Effect Schemas
- `src/baml-layer.ts` - `BamlPromptSourceLayer` runtime composition
- `config.yaml` / `src/agents/billing.md` - Declarative compatibility example
- `test/eval.test.ts` - Golden trace assertion runner
- `test/golden-traces/sample.golden.json` - Trace fixture used by eval tests
