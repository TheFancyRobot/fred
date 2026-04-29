---
note_type: step
template_version: 2
contract_version: 1
title: 'Implement baml client adapter: agent/tool mapping and typing'
step_id: STEP-55-04
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification|STEP-55-03 Define baml source/build lifecycle and generation verification]]'
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 04 - Implement baml client adapter: agent/tool mapping and typing

## Purpose

- Define the runtime adapter that turns generated BAML functions into Fred tools/agent components.
- Establish typed tool schemas from BAML generated classes/types and deterministic function discovery.
- Confirm required function invocation shapes using `b.func.*` (and sync/async behavior) and `b.stream.*` where supported.
- Define how adapters are invoked from Fred message pipelines without touching CLI plugin APIs.

## Outcome

- Executable adapter plan with:
  - `BAML` client boundary wrapper,
  - function -> `Tool` conversion helper (`createBamlTool`),
  - agent factory or registration wrapper (`BamlAgent`),
  - safe execution and error propagation into Effect-compatible flow.
- Duplicate tool/function conflict policy, deterministic naming, and diagnostics for ambiguous generation metadata.
- Explicit handling of helper outputs from test/eval tooling if exported.

## Required Reading

- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- `packages/core/src/tool/tool.ts`
- `packages/core/src/agent/agent.ts`
- `packages/core/src/agent/factory.ts`
- `packages/core/src/tool-gate/types.ts`
- https://docs.boundaryml.com/guide/baml-advanced/checks-and-asserts
- https://docs.boundaryml.com/guide/installation-language/typescript
- https://docs.boundaryml.com/reference/typescript
- https://docs.boundaryml.com/reference/clients
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing/Validation_Plan|Validation Plan]]

## Success Conditions

- [ ] Tool registration path is reproducible and deterministic (`createBamlTool` output names and argument schemas).
- [ ] Non-tool outputs and structured outputs preserve BAML class/union typing.
- [ ] Error path maps to Fred tool-call/tool-result semantics for consistency.
- [ ] Adapter supports sync and async call paths with explicit branching (`b.func.*` vs async wrappers).

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing/Validation_Plan|Validation Plan]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing/Implementation_Notes|Implementation Notes]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing/Outcome|Outcome]]

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: See Execution Brief.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: ready for first-day junior execution after STEP-55-03. Start with explicit schemas and mocked generated functions.
- Key caution: do not depend on automatic BAML schema introspection unless official metadata APIs prove stable.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->
