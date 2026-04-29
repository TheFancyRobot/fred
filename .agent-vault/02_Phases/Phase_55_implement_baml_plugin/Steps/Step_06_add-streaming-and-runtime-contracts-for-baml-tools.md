---
note_type: step
template_version: 2
contract_version: 1
title: 'Add streaming and runtime contracts for baml tools'
step_id: STEP-55-06
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing|STEP-55-04 Implement baml client adapter: agent/tool mapping and typing]]'
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 06 - Add streaming and runtime contracts for baml tools

## Purpose

- Integrate BAML streaming (`b.stream.*`) into Fred stream-event expectations without breaking existing contracts.
- Compare streaming API fidelity between BAML stream outputs and Fred expected chunking/event granularity.
- Define async adapter behavior for partial results, buffering, and error surfacing.
- Evaluate where streaming belongs: direct adapter-to-Effect boundary vs separate service method.

## Outcome

- Contract map from BAML streaming chunk events to `packages/core/src/stream/events.ts` event types.
- Explicit mapping matrix for `b.stream.*` payload shape, timing, and completion semantics.
- Standardized abort/timeout/error behavior for stream calls.
- Guardrails against silent swallowing of partial tool output.
- Open point: determine whether stream-mode requires dedicated compatibility adapter in Fred or can reuse existing effect stream abstractions.

## Required Reading

- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- `packages/core/src/stream/events.ts`
- `packages/core/src/message-processor/processor.ts`
- `packages/core/src/tool-gate/types.ts`
- `packages/cli/src/commands/chat.ts`
- https://docs.boundaryml.com/guide/installation-language/typescript
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools/Validation_Plan|Validation Plan]]

## Success Conditions

- [ ] Streaming behavior has a defined failure mode for unsupported clients and version mismatches.
- [ ] Streaming events include enough context (`toolCallId`, `step`, `run`) for existing consumers.
- [ ] No mismatch in stream contract assumptions versus generated async iterator behavior.
- [ ] Open question on stream fidelity/compatibility is resolved by explicit matrix and test coverage.

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools/Validation_Plan|Validation Plan]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools/Implementation_Notes|Implementation Notes]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools/Outcome|Outcome]]

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: See Execution Brief.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: ready for first-day junior execution after STEP-55-04, but implementation must begin with BAML stream API verification.
- Key caution: document limited compatibility rather than faking Fred stream events that BAML cannot support.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->
