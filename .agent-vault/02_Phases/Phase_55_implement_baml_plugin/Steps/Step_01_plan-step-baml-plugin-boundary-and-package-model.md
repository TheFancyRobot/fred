---
note_type: step
template_version: 2
contract_version: 1
title: 'Plan step: baml plugin boundary and package model'
step_id: STEP-55-01
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
depends_on: []
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 01 - Plan step: baml plugin boundary and package model

Use this note as a thin index for one executable step. Keep detail in companion notes so execution can load only the smallest note needed.

## Purpose

- Define the integration seam for BAML that preserves markdown/frontmatter as first-class and avoids overloading the CLI plugin layer.
- Confirm that `fred-baml` is packaged as a core runtime extension package (provider-like) with optional convenience helpers, not a CLI-only plugin.
- Establish clear assumptions about generation ownership, tool registration boundaries, and where configuration enters Fred (`@fancyrobot/fred` APIs, not `plugins[]`).

## Outcome

- One-line architecture decision:
  - `fred-baml` owns BAML loading/tool wrapping only.
  - Markdown agents, frontmatter parsing, and hot-reload remain in core.
  - CLI/plugin subsystem is not required for runtime feature wiring.
- A documented dependency chain for later steps.

## Required Reading

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- [[02_Phases/Phase_32_plugin_architecture/Phase|Phase 32 Plugin Architecture]]
- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]
- [[01_Architecture/Integration_Map|Integration Map]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Validation_Plan|Validation Plan]]

## Key Evidence (Non-file)

- BAML should be integrated through explicit package/runtime APIs and the provider-like extension model.
- CLI plugin subsystem (`packages/cli/src/plugin/*`) does not route into `Fred.initializeFromConfig()` and is command/UI-only today.
- `plugins[].options` and object-form declarations are present in config parsing but effectively unused by core runtime config pipeline.
- Research confirmed BAML surfaces in TypeScript as `@boundaryml/baml` with generated client (`baml_client`) exposing `b.func.*` and `b.stream.*` APIs.

## Success Conditions

- [ ] Step defines a stable package boundary and rejected alternatives (CLI plugin-first, per-project CLI flags) with rationale.
- [ ] Step confirms research consensus that `fred-baml` is a core-adjacent extension/library package, not primary CLI plugin runtime wiring.
- [ ] Step defines whether `fred-baml` requires a pre-generated/checked-in `baml_client/` policy.
- [ ] Step identifies what “BAML function -> Fred tool” means and what stays unchanged.

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Execution_Brief|Execution Brief]] - Why the step exists, prerequisites, likely code paths, and the smallest execution checklist.
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Validation_Plan|Validation Plan]] - Acceptance checks, commands, edge cases, and regression expectations.
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Implementation_Notes|Implementation Notes]] - Durable findings discovered while the step is being executed.
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Outcome|Outcome]] - Final result, validation evidence, and explicit follow-up.

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: Read [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Execution_Brief|Execution Brief]] and [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model/Validation_Plan|Validation Plan]].
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: ready for first-day junior execution. This is a documentation/decision step; do not implement runtime code here.
- Key dependency: DEC-0127 accepted boundary must remain the anchor for all later steps.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->

## Related Notes

- [[07_Templates/Note_Contracts|Note Contracts]]
- [[07_Templates/Phase_Template|Phase Template]]
