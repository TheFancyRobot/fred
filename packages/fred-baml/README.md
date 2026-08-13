# @fancyrobot/fred-baml

Lightweight BAML integration surface for Fred.

See the [Phase 68 migration matrix](https://github.com/TheFancyRobot/fred/blob/main/MIGRATION.md) for the compatible core
line and the Stanza BAML import recipe.

## Installation

```bash
bun add @fancyrobot/fred-baml@1.0.0 \
  @fancyrobot/fred@2.1.0 effect@^3.21.5
```

## Current package contract

This scaffold intentionally avoids importing any generated `baml_client` module at package top level.
You can safely import `@fancyrobot/fred-baml` before a consumer has a BAML project or generated output.

Current public exports:

- `createBamlTool` - create a Fred-compatible tool from a lazy BAML-backed executor
- `BamlAgent` - helper object for building explicit Fred agent configs with `baml.<functionName>` tool ids
- `BamlPromptSourceLayer` - connect BAML prompt functions through a caller-owned renderer
- `initFredBamlRuntime` - runtime helper that defers generated client loading until explicitly requested
- `createStubBamlRuntime` / `loadStubBamlClient` - test helpers for import-safe and deterministic tests (also available from `@fancyrobot/fred-baml/testing`)
- typed errors from `errors.ts`

## Example

```ts
import { Schema } from 'effect';
import { BamlAgent, createBamlTool, initFredBamlRuntime } from '@fancyrobot/fred-baml';

const runtime = initFredBamlRuntime({
  loadClient: () => import('../baml_client'),
});

const summarize = createBamlTool({
  id: BamlAgent.toolId('summarize'),
  description: 'Summarize text via BAML',
  inputSchema: Schema.Struct({ text: Schema.String }),
  successSchema: Schema.String,
  runtime,
  execute: async ({ text }, activeRuntime) => {
    const client = await activeRuntime.loadClient();
    void client;
    return `summary:${text}`;
  },
});
```

## BAML prompt sources

Fred agents can name a BAML function as their system prompt without making core
depend on BAML. Supply a renderer that calls your generated client, then provide
the resulting layer when composing the Fred runtime:

```ts
import { makeFredRuntimeLayer } from '@fancyrobot/fred';
import { BamlPromptSourceLayer } from '@fancyrobot/fred-baml';
import { b } from '../baml_client';

const promptSourceLayer = BamlPromptSourceLayer(
  async ({ functionName, agentId, input }) => {
    if (functionName !== 'BuildSupportPrompt') {
      throw new Error(
        `Unknown BAML prompt function for ${agentId}: ${functionName}`,
      );
    }

    // The modular request API renders BAML without making its model call.
    // This BAML function is authored with exactly one string system message.
    const request = await b.request.BuildSupportPrompt(String(input));
    const body = request.body.json() as {
      messages?: Array<{ role: string; content: string }>;
    };
    const systemPrompt = body.messages?.find(
      (message) => message.role === 'system',
    )?.content;
    if (!systemPrompt) {
      throw new Error('BuildSupportPrompt did not render one system message');
    }
    return systemPrompt;
  },
);

const supportAgent = {
  id: 'support',
  platform: 'openai',
  model: 'gpt-4o-mini',
  systemMessage: { baml: { function: 'BuildSupportPrompt' } },
};

const runtimeLayer = makeFredRuntimeLayer({ promptSourceLayer });
```

The renderer is explicit by design: `@fancyrobot/fred-baml` never imports your
generated client or assumes its module path. The first adapter contract expects
one text system prompt; multi-role or multimodal BAML requests should stay on
the BAML execution path until Fred exposes a richer resolved-prompt contract.

## Dependency posture

`@fancyrobot/fred-baml` does not import `@boundaryml/baml` directly.
Consumers own their BAML toolchain version and generated client output; this package only consumes caller-provided loaders and renderers.

## Non-goals in this scaffold

- no CLI plugin wiring
- no implicit code generation
- no generated-client imports in module initialization paths
