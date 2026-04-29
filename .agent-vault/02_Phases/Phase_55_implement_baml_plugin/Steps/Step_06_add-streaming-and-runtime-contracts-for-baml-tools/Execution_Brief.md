# Execution Brief

## Exact Outcome

Define and implement the supported streaming contract for BAML-backed tools/functions, including how `b.stream.*` maps to Fred stream events or why it is deferred for the first slice.

## Why This Matters

Fred streaming is event-rich (`token`, `tool-call`, `tool-result`, `tool-error`, `usage`, `run-end`). BAML streaming may provide partial structured output with different semantics. Silent mismatch would break TUI/dev-server consumers.

## Prerequisites

- STEP-55-04 adapter exists.
- Read `packages/core/src/stream/events.ts` and any available BAML TS streaming docs/API.

## Starting Files and Directories

- `packages/core/src/stream/events.ts` - required event shapes.
- `packages/core/src/agent/factory.ts` - current stream integration around tools/providers.
- `packages/core/src/message-processor/processor.ts` or service equivalent - stream orchestration.
- `packages/cli/src/commands/chat.ts` - stream consumer behavior.
- `packages/fred-baml/src/streaming.ts` - planned adapter/mapping module.
- `packages/fred-baml/src/errors.ts` - unsupported stream/version errors.

## Initial Supported Policy

- Non-streaming `createBamlTool` is required.
- Streaming is opt-in and must advertise capability explicitly.
- If BAML stream fidelity cannot provide Fred token/tool semantics, emit/document a limited compatibility mode instead of faking missing events.
- Unsupported `b.stream.*` clients must fail with a typed actionable error.

## Mapping Matrix To Fill During Execution

| BAML stream item | Fred event | Required metadata | Notes |
| --- | --- | --- | --- |
| partial structured output | token or package-specific metadata on tool-result | runId/messageId/toolCallId/step if surfaced through Fred stream | Decide after API inspection. |
| final structured output | tool-result | output, durationMs, metadata | Preserve typed value. |
| BAML error | tool-error or stream-error | message/name/stack in dev | Do not swallow partial output. |
| usage if available | usage | token fields | Optional if BAML exposes it. |

## Abort/Timeout Expectations

- Honor Fred tool timeout/retry semantics where BAML invocation is wrapped as a tool.
- If BAML supports `AbortSignal`, pass it through; otherwise document that abort stops Fred stream consumption but cannot cancel upstream call.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Junior Readiness Verdict

Ready, but streaming implementation must begin with API verification and may intentionally defer full fidelity if BAML does not expose required details.
