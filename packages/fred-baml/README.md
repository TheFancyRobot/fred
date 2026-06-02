# @fancyrobot/fred-baml

Lightweight BAML integration surface for Fred.

## Current package contract

This scaffold intentionally avoids importing any generated `baml_client` module at package top level.
You can safely import `@fancyrobot/fred-baml` before a consumer has a BAML project or generated output.

Current public exports:

- `createBamlTool` - create a Fred-compatible tool from a lazy BAML-backed executor
- `BamlAgent` - helper object for building explicit Fred agent configs with BAML tool ids
- `initFredBamlRuntime` - runtime helper that defers generated client loading until explicitly requested
- `createStubBamlRuntime` - test helper for import-safe and deterministic tests
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

## Non-goals in this scaffold

- no CLI plugin wiring
- no implicit code generation
- no fixed `@boundaryml/baml` version policy yet
- no generated-client imports in module initialization paths
