# 07 - Hooks & Middleware: Intercepting the Message Lifecycle

This example demonstrates Fred's middleware model using practical hook registrations for redaction, policy injection, and structured event logging. The assistant prompt is loaded from `agents/assistant.md` and uses ETA conditionals plus a reusable partial.

## What You'll Learn

- How to register hooks with `fred.registerHook(...)`
- How hook handlers can modify `event.data` by returning `{ data: ... }`
- How to add metadata/context during execution
- How to capture structured lifecycle logs for observability
- How ETA conditionals (`<% if %>`) and partials (`<%~ include %>`) shape agent behavior

## Why This Is a Differentiator

Fred exposes 22 hook points across routing, tooling, context, and pipeline execution. That is more granular middleware coverage than competing frameworks.

## Hook Execution Order (High-Level)

```text
beforeMessageReceived
  -> beforeRouting
    -> beforeIntentDetermined
      -> beforeAgentSelected
        -> beforeToolCalled / afterToolCalled (if tools run)
          -> beforeResponseGenerated
            -> afterResponseGenerated
              -> afterMessageReceived
```

Pipeline runs add:

```text
beforePipeline -> beforeStep -> afterStep -> afterPipeline
onStepError / onPipelineError (error paths)
```

## Full Hook Type Reference (22)

| Hook Type | Purpose |
| --- | --- |
| beforeMessageReceived | Inspect/modify inbound message before processing |
| afterMessageReceived | Observe inbound message handling completion |
| beforeIntentDetermined | Inspect data before intent matching |
| afterIntentDetermined | Observe selected intent |
| beforeAgentSelected | Modify context before agent selection |
| afterAgentSelected | Observe selected agent |
| beforeToolCalled | Validate or gate tool execution |
| afterToolCalled | Observe tool result and telemetry |
| afterPolicyDecision | Inspect policy allow/deny decisions |
| beforeResponseGenerated | Modify data before final model response |
| afterResponseGenerated | Observe final response payload |
| beforeContextInserted | Inspect messages before context persistence |
| afterContextInserted | Observe context write completion |
| beforeRouting | Modify input before routing rules run |
| afterRouting | Observe routing completion |
| afterRoutingDecision | Inspect routed decision metadata |
| beforePipeline | Hook before pipeline execution starts |
| afterPipeline | Hook after pipeline succeeds |
| beforeStep | Hook before each pipeline/graph step |
| afterStep | Hook after each pipeline/graph step |
| onStepError | Hook for step-level errors |
| onPipelineError | Hook for pipeline-level failure |

## Run

1. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`
2. Run `bun install` from the repo root
3. Run the example:

```bash
bun run examples/07-hooks-and-middleware/src/index.ts
```

You should see:
- Redaction logs for email/API-key/SSN patterns
- Policy-injection log before agent selection
- Structured lifecycle log output from logging hooks

## ETA Prompt Features

- `vars.verbose` in frontmatter toggles verbose guidance through an ETA conditional block
- `partials/safety-rules.md` is included via `<%~ include("@safety-rules") %>` to keep policy text reusable
- Hooks remain in `src/index.ts` because runtime middleware behavior belongs in code
