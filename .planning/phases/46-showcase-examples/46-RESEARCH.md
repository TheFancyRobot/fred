# Phase 46: Showcase Examples & Framework Differentiation - Research

**Researched:** 2026-03-02
**Domain:** Example authoring, framework differentiation, API surface coverage, guard testing
**Confidence:** HIGH

## Summary

Phase 46 replaces 5 stale example directories and 1 config file with 12 progressive, self-contained examples that form a learning path demonstrating Fred's v0.3.0 Effect-based public API. The existing examples use broken relative imports (`../../src/index`), lack READMEs and `.env.example` files, and overlap heavily (basic/default-agent/chat-tool are near-identical).

The research confirms three critical API gaps that must be resolved before examples can be authored: (1) Fred class has no public methods for pipeline V2 step-based creation, (2) Fred class has no public methods for graph workflow registration/execution, and (3) PipelineService.executeGraphWorkflow is stubbed (returns `Effect.fail`). The imperative graph executor in `graph-executor.ts` (1017 lines) is fully functional and should be used.

Competitive analysis across LangChain/LangGraph, CrewAI, AutoGen, Mastra, and Semantic Kernel confirms Fred's strongest differentiators are: (a) built-in intent-based routing with exact/regex/semantic matching, (b) pipeline checkpointing with resume, (c) golden-trace evaluation harness with assertion DSL and suite runner, and (d) 22-hook-point middleware system. No single competing framework combines all four.

**Primary recommendation:** Implement the 3 API prerequisite methods first, then author examples in dependency order (01-04 can run in parallel, 05-06 depend on pipeline/graph API additions, 07-12 can proceed once hooks/observability/eval/config/MCP/CLI infrastructure is confirmed working).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Example set and ordering (12 examples, numbered as learning path)**
   - 01-quickstart-single-agent
   - 02-tools-basics
   - 03-intent-routing-basics
   - 04-dynamic-handoff
   - 05-pipeline-sequential
   - 06-pipeline-graph-workflow
   - 07-hooks-and-middleware
   - 08-observability-tracing
   - 09-evaluation-harness-golden-traces
   - 10-config-driven-yaml
   - 11-mcp-integration
   - 12-cli-and-tui

2. **Per-example packaging structure** - Each example is fully self-contained with its own `package.json`, `README.md`, `src/`, `.env.example`, and optionally `config.yaml` and `test/`.

3. **Top-level examples organization** - `examples/README.md` listing all 12 in order; all examples use `@fancyrobot/fred` package imports (not relative paths); provider packages are separate (`@fancyrobot/fred-openai`, etc.).

4. **Competitive research requirement** - At least 2 examples must highlight functionality not cleanly shown in other frameworks.

5. **API prerequisites (3 items)**:
   - Pipeline V2 step-based creation on Fred class
   - Graph workflow public methods on Fred class
   - Hook registration timing fix (queue hooks for replay, or document Fred.create() requirement)

6. **Dynamic handoff approach (Example 04)** - Show both tool-based handoff via `createHandoffTool()` and mention intent re-routing alternative. Bidirectional transfer required.

7. **Examples guard test** - Must be created as a Phase 46 deliverable following the Phase 44 boundary guard pattern.

### Claude's Discretion

- Exact mock tool implementations (weather, calculator, etc.)
- README formatting and prose style
- Whether to use async/await or Effect-style in example code (prefer async/await for approachability, mention Effect alternative where relevant)
- Loading skeleton / progress output format in examples
- Which specific hook points to feature in example 07 (pick most impressive 2-3)
- Exact graph topology for example 06
- Which MCP server to use in example 11 (filesystem is fine)

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.
</user_constraints>

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@fancyrobot/fred` | workspace:* | Core framework | Only dependency for all examples |
| `@fancyrobot/fred-openai` | workspace:* | OpenAI provider | Default provider for examples |
| `bun` | runtime | Execution runtime | Project standard; examples use `bun run` |
| `typescript` | ^5.9.3 | Typechecking | Examples must typecheck via guard test |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@fancyrobot/fred-anthropic` | workspace:* | Anthropic provider | Alternative provider mention in READMEs |
| `@fancyrobot/fred-google` | workspace:* | Google provider | Alternative provider mention |
| `@modelcontextprotocol/server-filesystem` | latest | MCP server | Example 11 (MCP integration) |
| `@opentelemetry/exporter-trace-otlp-http` | ^0.212.0 | OTEL exporter | Example 08 (optional OTEL wiring) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| OpenAI as default provider | Anthropic | OpenAI is more universally available; mention Anthropic as alternative |
| Filesystem MCP server | GitHub MCP server | Filesystem needs no auth; GitHub requires token |
| Bun-native typecheck | `tsc --noEmit` | Bun typecheck is faster but less strict; guard test should use `bunx tsc` for correctness |

### Installation

Examples use workspace resolution within the monorepo. Each example `package.json` declares:
```json
{
  "dependencies": {
    "@fancyrobot/fred": "workspace:*",
    "@fancyrobot/fred-openai": "workspace:*"
  }
}
```

## Architecture Patterns

### Recommended Example Structure

```
examples/
├── README.md                           # Learning path overview
├── 01-quickstart-single-agent/
│   ├── package.json
│   ├── README.md
│   ├── .env.example
│   ├── tsconfig.json                   # Extends ../../tsconfig.base.json
│   └── src/
│       └── index.ts
├── 05-pipeline-sequential/
│   ├── package.json
│   ├── README.md
│   ├── .env.example
│   ├── tsconfig.json
│   └── src/
│       └── index.ts
├── 09-evaluation-harness-golden-traces/
│   ├── package.json
│   ├── README.md
│   ├── .env.example
│   ├── tsconfig.json
│   ├── src/
│   │   └── index.ts
│   └── test/
│       ├── golden-traces/
│       │   └── sample.golden.json
│       └── eval.test.ts
├── 10-config-driven-yaml/
│   ├── package.json
│   ├── README.md
│   ├── .env.example
│   ├── tsconfig.json
│   ├── config.yaml
│   └── src/
│       ├── config-driven.ts            # Runs from config.yaml
│       └── programmatic-equivalent.ts  # Same behavior, code-only
└── 12-cli-and-tui/
    ├── package.json
    ├── README.md
    ├── .env.example
    ├── tsconfig.json
    ├── config.yaml
    └── src/
        └── index.ts                    # May be minimal; focus is README walkthrough
```

### Pattern 1: Fred.create() + Async/Await Entry Point

**What:** All examples use the async factory `Fred.create()` and async/await for the main flow.
**When to use:** Every example's entry point.
**Why:** `new Fred()` emits a deprecation warning in development mode. `Fred.create()` ensures the Effect runtime is initialized before any operations.

```typescript
// Source: packages/core/src/index.ts lines 144-148
import { Fred } from '@fancyrobot/fred';

async function main() {
  const fred = await Fred.create();
  // ... register providers, agents, tools
  const response = await fred.processMessage('Hello!');
  console.log(response?.content);
}

main().catch(console.error);
```

### Pattern 2: Provider Registration

**What:** Register AI providers before creating agents.
**When to use:** Every example that sends messages to an LLM.

```typescript
// Register a specific provider pack
await fred.registerProviderPack('openai');

// Or register all available providers (auto-detects from env vars)
await fred.registerDefaultProviders();
```

### Pattern 3: Tool Registration with Effect Schema

**What:** Register tools using the recommended Effect Schema format.
**When to use:** Examples 02, 04, 07, 09.

```typescript
// Source: packages/core/src/tool/tool.ts, packages/core/src/tool/calculator.ts
import { Schema } from 'effect';
import type { Tool } from '@fancyrobot/fred';

const weatherTool: Tool = {
  id: 'get-weather',
  name: 'get-weather',
  description: 'Get current weather for a city',
  schema: {
    input: Schema.Struct({ city: Schema.String }),
    success: Schema.String,
    metadata: {
      type: 'object',
      properties: {
        city: { type: 'string', description: 'City name' }
      },
      required: ['city']
    }
  },
  execute: async ({ city }) => `Weather in ${city}: Sunny, 22°C`
};

fred.registerTool(weatherTool);
```

### Pattern 4: Hook Registration (After Fred.create())

**What:** Register hooks AFTER `Fred.create()` to avoid the silent no-op issue.
**When to use:** Example 07 and any example using hooks.

```typescript
// IMPORTANT: Must be after Fred.create() — hooks silently no-op before runtime init
const fred = await Fred.create();
await fred.registerProviderPack('openai');

fred.registerHook('beforeMessageReceived', async (event) => {
  console.log(`[HOOK] Message received: ${event.data}`);
  // Return modified data or void
  return { data: event.data.replace(/secret/gi, '[REDACTED]') };
});
```

### Pattern 5: Config-Driven Initialization

**What:** Load Fred entirely from a YAML config file.
**When to use:** Example 10 and 12.

```typescript
// Source: packages/core/src/config/loader.ts
const fred = await Fred.create();
await fred.initializeFromConfig('./config.yaml', {
  providers: { /* optional overrides */ }
});
```

### Anti-Patterns to Avoid

- **`new Fred()` without `Fred.create()`:** Emits deprecation warning; runtime is lazily initialized which can cause race conditions with hook registration.
- **Relative imports (`../../src/index`):** All existing examples use this broken pattern. Examples MUST use `@fancyrobot/fred` package imports.
- **`Effect.runPromise` in example code:** Examples should use Fred's async/await public API. Effect internals are for the framework, not end users.
- **Missing `.env.example`:** Every example needs this file documenting required environment variables.
- **Overlapping examples:** Existing basic/default-agent/chat-tool are near-identical. Each new example must demonstrate a distinct capability.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool schema definition | Custom JSON Schema builder | Effect Schema + metadata pattern from `tool/tool.ts` | Effect Schema provides type safety + runtime validation |
| Pipeline step orchestration | Custom step runner | `PipelineBuilder` from `packages/core/src/pipeline/builder.ts` | Handles naming, ordering, hooks, checkpoint config |
| Graph workflow construction | Manual `GraphWorkflowConfig` objects | `GraphWorkflowBuilder` from `packages/core/src/pipeline/graph-builder.ts` | Validates DAG structure, handles edge conditions |
| MCP tool conversion | Manual MCP-to-Fred tool mapping | `convertMCPToolsToFredTools()` from `packages/core/src/mcp/adapter.ts` | Handles schema conversion, error wrapping, namespacing |
| Golden trace recording | Manual trace construction | `GoldenTraceRecorder` from `packages/core/src/eval/recorder.ts` | Manages span capture, routing metadata, timing |
| Test suite execution | Custom test runner | `runSuite()` + YAML manifest from `packages/core/src/eval/suite.ts` | Handles assertions, compare, replay, metrics |
| Handoff tool creation | Custom handoff tool | `createHandoffTool()` from `packages/core/src/tool/handoff.ts` | Handles agent validation, context passing, tracing |

**Key insight:** Fred provides builders and utilities for every complex operation. Examples should showcase these ergonomic APIs rather than building from primitives.

## Common Pitfalls

### Pitfall 1: Hook Registration Before Runtime Init

**What goes wrong:** `fred.registerHook()` silently no-ops if called before `Fred.create()` or `ensureRuntime()`.
**Why it happens:** The hook manager service is part of the Effect runtime which is lazily initialized.
**How to avoid:** Always use `Fred.create()` (which calls `ensureRuntime()`), then register hooks afterward. Example 07 must document this prominently.
**Warning signs:** Hooks that never fire despite being registered.

### Pitfall 2: PipelineService.executeGraphWorkflow Is Stubbed

**What goes wrong:** Calling graph execution through the Effect service path returns `Effect.fail("Graph execution path requires Effect fiber implementation")`.
**Why it happens:** The PipelineService graph execution was left as a stub during the Effect migration (confirmed at `packages/core/src/pipeline/service.ts` lines 1003-1029).
**How to avoid:** The Fred-level graph workflow method (to be added as API prerequisite) must use the working imperative executor in `graph-executor.ts`, NOT the stubbed Effect service path.
**Warning signs:** `PipelineExecutionError` with "requires Effect fiber implementation" message.

### Pitfall 3: Fred Class Missing Pipeline V2 and Graph Public Methods

**What goes wrong:** There is no `fred.createPipelineV2()`, `fred.registerGraphWorkflow()`, or `fred.executeGraphWorkflow()` on the Fred class.
**Why it happens:** These methods exist only on PipelineService (accessible via `fred.getRuntime()`), but the Fred facade doesn't expose them.
**How to avoid:** API prerequisites must add these methods before examples 05 and 06 can be authored. The methods should delegate to PipelineService (for V2) and the imperative graph executor (for graph workflows).
**Warning signs:** TypeScript errors on `fred.createPipeline()` when passing a `PipelineConfigV2` (it only accepts `PipelineConfig`).

### Pitfall 4: Example Package Resolution in Monorepo

**What goes wrong:** Examples with `workspace:*` dependencies don't resolve unless included in the Bun workspace.
**Why it happens:** `examples/*` is not in the root `package.json` workspaces array (only `packages/*` is).
**How to avoid:** Either (a) add `examples/*` to the root workspaces array, or (b) use relative path dependencies like `"@fancyrobot/fred": "../../packages/core"`. Option (a) is cleaner and matches the monorepo pattern.
**Warning signs:** `Module not found: @fancyrobot/fred` when running examples.

### Pitfall 5: Guard Test Typecheck Scope

**What goes wrong:** Running `bunx tsc --noEmit` at the project root checks all packages, not just examples.
**Why it happens:** The root tsconfig uses project references for packages only.
**How to avoid:** Each example needs its own `tsconfig.json` that extends `../../tsconfig.base.json`. The guard test should run `bunx tsc --noEmit` scoped to each example directory individually.
**Warning signs:** Guard test passing even when example has type errors (wrong tsconfig scope).

### Pitfall 6: Config-Driven Pipeline Functions Need Code Registration

**What goes wrong:** YAML config can reference function steps by `functionId`, but the function must be registered in code before loading config.
**Why it happens:** YAML cannot contain function references. The `registerPipelineFunction()` bridge exists in `packages/core/src/config/loader.ts`.
**How to avoid:** Example 10 must show the `registerPipelineFunction()` call before `initializeFromConfig()`.
**Warning signs:** Pipeline execution fails with "function not found" errors.

## Code Examples

### Example 01: Quickstart Single Agent

```typescript
// Source: packages/core/src/index.ts (Fred.create, registerProviderPack, createAgent, processMessage)
import { Fred } from '@fancyrobot/fred';

async function main() {
  const fred = await Fred.create();
  await fred.registerProviderPack('openai');

  await fred.createAgent({
    id: 'assistant',
    systemMessage: 'You are a helpful assistant. Be concise.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  fred.setDefaultAgent('assistant');
  const response = await fred.processMessage('What is TypeScript?');
  console.log(response?.content);
  await fred.shutdown();
}

main().catch(console.error);
```

### Example 03: Intent Routing with Router Transcript

```typescript
// Source: packages/core/src/index.ts (registerIntent, routeMessage, configureRouting)
import { Fred } from '@fancyrobot/fred';
import type { Intent } from '@fancyrobot/fred';

async function main() {
  const fred = await Fred.create();
  await fred.registerProviderPack('openai');

  // Create 3 specialist agents
  await fred.createAgent({ id: 'billing', systemMessage: 'You handle billing questions.', platform: 'openai', model: 'gpt-4o-mini' });
  await fred.createAgent({ id: 'tech-support', systemMessage: 'You handle technical support.', platform: 'openai', model: 'gpt-4o-mini' });
  await fred.createAgent({ id: 'general', systemMessage: 'You handle general inquiries.', platform: 'openai', model: 'gpt-4o-mini' });

  // Register intents with exact/regex matching
  fred.registerIntent({
    id: 'billing-intent',
    utterances: ['invoice', 'payment', 'billing', /refund|charge/i.source],
    action: { type: 'agent', target: 'billing' },
  });

  fred.registerIntent({
    id: 'tech-intent',
    utterances: ['bug', 'error', 'crash', 'not working'],
    action: { type: 'agent', target: 'tech-support' },
  });

  // Route and show transcript
  const route = await fred.routeMessage('I need a refund for my last invoice');
  console.log('Route decision:', JSON.stringify(route, null, 2));
}

main().catch(console.error);
```

### Example 05: Pipeline with Checkpointing (Needs API Prerequisite)

```typescript
// Source: packages/core/src/pipeline/builder.ts (PipelineBuilder)
// NOTE: Requires fred.createPipeline() to accept PipelineConfigV2
import { Fred } from '@fancyrobot/fred';
import { PipelineBuilder } from '@fancyrobot/fred'; // Needs re-export

async function main() {
  const fred = await Fred.create();
  await fred.registerProviderPack('openai');

  // Create agents for pipeline steps
  await fred.createAgent({ id: 'classifier', systemMessage: 'Classify the input...', platform: 'openai', model: 'gpt-4o-mini' });
  await fred.createAgent({ id: 'planner', systemMessage: 'Create a plan...', platform: 'openai', model: 'gpt-4o-mini' });
  await fred.createAgent({ id: 'summarizer', systemMessage: 'Summarize the results...', platform: 'openai', model: 'gpt-4o-mini' });

  const pipeline = new PipelineBuilder('classify-plan-summarize')
    .addAgentStep('classifier')
    .addFunctionStep('execute-tools', async (ctx) => {
      // Custom function step
      return { toolResults: `Processed: ${ctx.outputs['classifier']}` };
    })
    .addAgentStep('summarizer')
    .build();

  // Execute pipeline (needs Fred-level V2 support)
  // const result = await fred.executePipelineV2(pipeline, 'Analyze this data...');
}

main().catch(console.error);
```

### Example 09: Golden Trace Evaluation

```typescript
// Source: packages/core/src/eval/assertions.ts, packages/core/src/eval/suite.ts
import { runTestCases, formatTestResults, loadGoldenTrace } from '@fancyrobot/fred/eval';
import type { TestCase } from '@fancyrobot/fred/eval';

async function main() {
  const trace = await loadGoldenTrace('./test/golden-traces/sample.golden.json');

  const cases: TestCase[] = [
    {
      name: 'Routes to billing agent',
      trace,
      assertions: [
        { type: 'routing', expected: { agentId: 'billing', method: 'intent.matching' } },
        { type: 'response', text: 'refund' },
      ],
    },
  ];

  const results = await runTestCases(cases);
  console.log(formatTestResults(results));
}

main().catch(console.error);
```

## API Prerequisites Analysis

### 1. Fred.createPipeline() Must Accept PipelineConfigV2

**Current state:** `Fred.createPipeline(config: PipelineConfig)` only accepts V1 configs (agent chain).
**Required:** Accept `AnyPipelineConfig` (discriminated via `isPipelineConfigV2()`).
**Implementation path:**
- Change signature to `createPipeline(config: AnyPipelineConfig)`
- Use `isPipelineConfigV2()` type guard to route to `PipelineService.createPipelineV2()` for V2 configs
- V1 path remains unchanged
**Confidence:** HIGH -- PipelineService already has `createPipelineV2()` method

### 2. Fred Must Expose Graph Workflow Methods

**Current state:** No `registerGraphWorkflow()` or `executeGraphWorkflow()` on Fred class.
**Required:** Public Fred methods that delegate to the working imperative executor.
**Implementation path:**
- Add `registerGraphWorkflow(config: GraphWorkflowConfig)` -- delegates to `PipelineService.registerGraphWorkflow()`
- Add `executeGraphWorkflow(id: string, input: string, options?)` -- must use `executeGraphWorkflow()` from `graph-executor.ts`, NOT the stubbed PipelineService method
- Re-export `GraphWorkflowBuilder`, `GraphWorkflowConfig`, `GraphExecutionResult` from main entrypoint
**Confidence:** HIGH -- imperative executor is battle-tested (1017 lines, extensive test suite in `graph-executor.test.ts`)

### 3. Hook Registration Timing

**Current state:** `registerHook()` silently no-ops if called before runtime init.
**Resolution options:**
- **Option A (recommended):** Queue hooks for replay like tools/agents/intents do. All three use snapshot Maps that get replayed in `applyRuntimeState()`.
- **Option B:** Document in examples that `Fred.create()` must precede `registerHook()`. Less ideal but minimal code change.
**Confidence:** MEDIUM -- Option A mirrors existing patterns (toolSnapshot, intentSnapshot, providerSnapshot) but hooks use `HookManagerService.register()` which needs the runtime.

### Re-Exports Needed

The following must be added to `exports.ts` or `index.ts` for examples to import cleanly:
- `PipelineBuilder` from `pipeline/builder.ts`
- `GraphWorkflowBuilder` from `pipeline/graph-builder.ts`
- `GraphWorkflowConfig`, `GraphExecutionResult` from pipeline types
- `createHandoffTool` from `tool/handoff.ts`
- `GoldenTraceRecorder` from `eval/recorder.ts` (may already be exported)

## Competitive Analysis & Differentiators

### Framework Landscape (2026)

| Framework | Language | Routing | Pipelines | Checkpointing | Eval | Hooks/Middleware |
|-----------|----------|---------|-----------|---------------|------|-----------------|
| **Fred** | TypeScript | Intent-based (exact/regex/semantic) | V1 + V2 + graph | Built-in | Golden traces + assertions + suite runner | 22 hook points |
| **LangGraph** | Python | LLM-based / graph edges | Graph-native | Built-in (PostgreSQL, SQLite, S3) | Via LangSmith (separate product) | Callbacks |
| **CrewAI** | Python | Role-based task assignment | Sequential/parallel | Limited | `crewai test` CLI | Task hooks |
| **AutoGen** | Python | Conversational routing | Conversation-driven | ConversableAgent state | Limited built-in | Agent callbacks |
| **Mastra** | TypeScript | LLM-based | DAG workflows | Limited | Built-in scorers | Plugin system |
| **Semantic Kernel** | C#/Python/Java | Planner-based | Stepwise planner | Limited | Via external tools | Filters/hooks |

### Fred's Genuine Differentiators

1. **Intent-based routing with match transcripts (Example 03)** -- No competing framework offers declarative intent routing with exact/regex/semantic matching AND a routing explanation/transcript showing WHY the router chose a specific agent. LangGraph and Mastra use LLM-based routing (slower, less deterministic). CrewAI uses role-based task assignment (no user-message routing). This is Fred's most distinctive capability. **Confidence: HIGH**

2. **Golden-trace evaluation harness (Example 09)** -- Fred has a first-class evaluation framework with: golden trace recording, assertion DSL (tool.calls, routing, response, checkpoint, schema), comparator with scorecard, replay with modes (retry/skip/restart), suite runner with YAML manifests, and intent metrics (precision/recall/F1). No competing framework bundles this directly; LangChain delegates to LangSmith (separate SaaS product), CrewAI has basic `crewai test`, AutoGen has no built-in eval. **Confidence: HIGH**

3. **22-hook-point middleware system (Example 07)** -- Fred offers 22 distinct hook points covering the full message lifecycle (beforeMessageReceived through onPipelineError). Each hook can modify data, inject context, skip steps, or abort pipelines. Semantic Kernel has filters/hooks but fewer points; LangGraph has callbacks; CrewAI has task hooks. The breadth of Fred's hook system is genuinely rare. **Confidence: HIGH**

4. **Pipeline checkpointing with resume and human-in-the-loop (Example 05)** -- While LangGraph also has checkpointing, Fred's `PipelineConfigV2` integrates checkpointing directly with the step-based pipeline builder, pause/resume for human input, and hook integration at each step. The combination of pause-for-human-input + checkpoint resume is well-integrated. **Confidence: MEDIUM** (LangGraph's checkpointing is more mature)

### Examples That Highlight Differentiators

| Example | Differentiator | Competing Framework Gap |
|---------|---------------|------------------------|
| 03-intent-routing-basics | Intent-based routing + router transcript | LangGraph/Mastra/CrewAI have no equivalent |
| 09-evaluation-harness-golden-traces | Built-in golden trace eval + assertion DSL | LangChain needs LangSmith; CrewAI/AutoGen have minimal eval |
| 07-hooks-and-middleware | 22 hook points, data modification, abort | Semantic Kernel has 4-6 filter points; others have callbacks |
| 05-pipeline-sequential | Checkpoint + resume + human-in-the-loop | Partial overlap with LangGraph; Fred's integration is tighter |

## Guard Test Architecture

### Pattern Reference

The guard test follows the Phase 44 boundary guard pattern in `tests/unit/core/migration/phase-44-boundary-guard.test.ts`. Key patterns:
- Uses `bun:test` (describe/expect/test)
- Uses `node:fs` for filesystem scanning
- Fails loudly on violations with descriptive error messages

### Guard Test Requirements

```typescript
// tests/unit/examples/examples-guard.test.ts
describe('Examples guard', () => {
  // 1. Verify all 12 example directories exist
  // 2. Each has required structure: package.json, README.md, src/, .env.example
  // 3. All .ts files in src/ import from '@fancyrobot/fred' (no relative paths)
  // 4. No imports from '../../src' or '../packages/' patterns
  // 5. Typecheck: run `bunx tsc --noEmit` per example directory (or verify tsconfig exists)
});
```

### Typecheck Strategy

Each example needs a `tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "noEmit": true
  },
  "include": ["src/**/*"]
}
```

The guard test can verify typechecking by running `bunx tsc --noEmit -p examples/XX-name/tsconfig.json` for each example. This is slower but ensures real type safety. Alternatively, scan for forbidden import patterns as a faster heuristic with periodic full typecheck in CI.

## Workspace Configuration

### Adding Examples to Monorepo

The root `package.json` workspaces currently only includes `packages/*`. For examples to resolve workspace dependencies, add `examples/*`:

```json
{
  "workspaces": ["packages/*", "examples/*"]
}
```

This allows each example's `package.json` to use `workspace:*` protocol for Fred dependencies.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `new Fred()` constructor | `Fred.create()` async factory | v0.3.0 Phase 43 | Examples must use factory pattern |
| Relative imports `../../src` | Package imports `@fancyrobot/fred` | v0.3.0 Phase 45 | Clean modular imports |
| Imperative managers | Effect services via runtime | v0.3.0 Phase 41-44 | No direct manager access |
| `PipelineConfig` (agent chain) | `PipelineConfigV2` (step-based) | v0.2.0 Phase 5+ | Richer pipeline semantics |
| Callback-based streaming | `fred.streamMessage()` -> `StreamResult` | v0.3.0 | Unified streaming API |

**Deprecated/outdated:**
- `new Fred()` -- deprecated; use `Fred.create()`
- `ToolRegistry`, `AgentManager`, `PipelineManager` etc. -- deleted in Phase 44
- Relative imports from examples -- broken; must use package imports

## Open Questions

1. **PipelineBuilder re-export location**
   - What we know: `PipelineBuilder` lives in `packages/core/src/pipeline/builder.ts` but is NOT exported from main entrypoint (`exports.ts` or `index.ts`)
   - What's unclear: Should it go in `exports.ts`, or should a new sub-path like `@fancyrobot/fred/pipeline` be created?
   - Recommendation: Add to `exports.ts` for simplicity; sub-path exports can come later

2. **Graph executor delegation strategy**
   - What we know: PipelineService.executeGraphWorkflow() is stubbed; imperative `executeGraphWorkflow()` in graph-executor.ts works
   - What's unclear: Should the Fred-level method call the imperative executor directly, or fix the PipelineService stub?
   - Recommendation: Fred-level method should call imperative executor directly (as user decided in CONTEXT.md). Fixing the PipelineService stub is a separate concern.

3. **Example execution without real API keys**
   - What we know: Examples need real API keys to actually run
   - What's unclear: Should examples include a "mock mode" or dry-run path?
   - Recommendation: Keep examples authentic (real API calls). The `.env.example` file and README should make key setup clear. Guard test only typechecks, doesn't execute.

4. **Examples workspace addition**
   - What we know: `examples/*` is not in root workspaces
   - What's unclear: Whether adding it will cause issues with Bun workspace hoisting
   - Recommendation: Add `examples/*` to workspaces; test resolution immediately

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | bun:test |
| Config file | None -- uses Bun's default test discovery |
| Quick run command | `bun test tests/unit/examples/examples-guard.test.ts` |
| Full suite command | `bun test` |

### Phase Requirements -> Test Map

No explicit requirement IDs were provided for this phase. The guard test covers the structural requirements from CONTEXT.md:

| Behavior | Test Type | Automated Command | File Exists? |
|----------|-----------|-------------------|-------------|
| All 12 example directories exist | unit (guard) | `bun test tests/unit/examples/examples-guard.test.ts` | No -- Wave 0 |
| Each example has required structure | unit (guard) | Same | No -- Wave 0 |
| No relative imports in examples | unit (guard) | Same | No -- Wave 0 |
| All examples typecheck | unit (guard) | Same | No -- Wave 0 |

### Sampling Rate

- **Per task commit:** `bun test tests/unit/examples/examples-guard.test.ts`
- **Per wave merge:** `bun test`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps

- [ ] `tests/unit/examples/examples-guard.test.ts` -- covers all structural requirements
- [ ] Example `tsconfig.json` template -- needed for typecheck validation

## Sources

### Primary (HIGH confidence)
- `packages/core/src/index.ts` -- Fred class public API surface, method signatures
- `packages/core/src/pipeline/service.ts` lines 1003-1029 -- confirmed graph execution stub
- `packages/core/src/pipeline/builder.ts` -- PipelineBuilder fluent API
- `packages/core/src/pipeline/graph-builder.ts` -- GraphWorkflowBuilder fluent API
- `packages/core/src/pipeline/graph-executor.ts` -- working imperative graph executor
- `packages/core/src/tool/handoff.ts` -- createHandoffTool() with Effect Schema
- `packages/core/src/hooks/types.ts` -- 22 hook types enumeration
- `packages/core/src/eval/` -- golden trace, assertions, suite, replay, metrics modules
- `packages/core/src/mcp/adapter.ts` -- convertMCPToolsToFredTools()
- `packages/core/src/config/types.ts` -- FrameworkConfig for YAML config structure
- `packages/core/src/exports.ts` -- current public API exports
- `tests/unit/core/migration/phase-44-boundary-guard.test.ts` -- guard test pattern reference

### Secondary (MEDIUM confidence)
- [LangGraph checkpointing docs](https://www.langchain.com/langgraph) -- LangGraph has mature checkpointing with PostgreSQL/SQLite/S3
- [CrewAI testing](https://docs.crewai.com/en/concepts/testing) -- CrewAI has `crewai test` CLI but no golden trace equivalent
- [Mastra docs](https://mastra.ai/docs) -- TypeScript framework with DAG workflows, built-in scorers
- [Semantic Kernel](https://learn.microsoft.com/en-us/semantic-kernel/overview/) -- Filters/hooks in C#, limited TypeScript support

### Tertiary (LOW confidence)
- [AI Agent Framework comparisons](https://www.turing.com/resources/ai-agent-frameworks) -- General landscape overview, may not be current
- [Intent routing techniques](https://gist.github.com/mkbctrl/a35764e99fe0c8e8c00b2358f55cd7fa) -- Community gist, not official docs

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries are already in the monorepo; no new dependencies except MCP server for example 11
- Architecture: HIGH -- example structure follows CONTEXT.md decisions; guard test follows established Phase 44 pattern
- API prerequisites: HIGH -- confirmed all 3 gaps via code inspection; implementation paths are clear
- Competitive analysis: MEDIUM -- based on web search + project knowledge; competitor features may have changed
- Pitfalls: HIGH -- all identified from direct code inspection of the Fred codebase

**Research date:** 2026-03-02
**Valid until:** 2026-04-02 (30 days -- stable domain, no fast-moving external dependencies)
