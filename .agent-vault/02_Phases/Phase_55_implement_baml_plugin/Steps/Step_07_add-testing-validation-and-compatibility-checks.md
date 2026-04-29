---
note_type: step
template_version: 2
contract_version: 1
title: 'Add testing, validation, and compatibility checks'
step_id: STEP-55-07
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification|STEP-55-03 Define baml source/build lifecycle and generation verification]]'
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing|STEP-55-04 Implement baml client adapter: agent/tool mapping and typing]]'
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools|STEP-55-06 Add streaming and runtime contracts for baml tools]]'
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 07 - Add testing, validation, and compatibility checks

## Purpose

- Create deterministic test plan around generation checks, adapter mapping, duplicate IDs, streaming contracts, and config boundaries.
- Incorporate BAML-native testing (`baml test`) and any planned test runner helper into package-level validation.
- Add boundary guards so missing/stale generation and runtime incompatibilities are explicit failures.
- Verify Fred integration compatibility and docs claims in examples, including mixed markdown/BAML workflows.

## Outcome

- Complete verification matrix for:
  - generation stale/missing,
  - `b.func.*`/`b.stream.*` invocation success/failure,
  - streaming event consistency,
  - duplicate-id protection,
  - server/CI-mode behavior, if scoped,
  - example + smoke compatibility.

## Required Reading

- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- `packages/cli/tests/plugin/phase32-plugin-smoke.test.ts`
- `packages/cli/tests/commands/route.test.ts`
- `packages/core/src/agent/file-loader.ts`
- `packages/core/src/stream/events.ts`
- https://docs.boundaryml.com/guide/baml-advanced/checks-and-asserts
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks/Validation_Plan|Validation Plan]]

## Success Conditions

- [ ] Unit/integration test plan includes at least: generation check, adapter happy path, tool conflict path, streaming compatibility path.
- [ ] `baml test` and generated-client checks are explicitly included (or intentionally deferred with rationale).
- [ ] Tests are isolated from live provider calls or explicitly marked live.
- [ ] Verification fails loud on stale gen/client mismatch and ambiguous config combinations.
- [ ] Compatibility checks include whether `fred-baml` can coexist with markdown/frontmatter agents in the same repo.

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks/Validation_Plan|Validation Plan]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks/Implementation_Notes|Implementation Notes]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks/Outcome|Outcome]]

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: See Execution Brief.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: ready for first-day junior execution after STEPs 03, 04, and 06. Keep deterministic tests separate from live BAML/provider tests.
- Key caution: provider API keys must not be required for normal unit tests.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->
