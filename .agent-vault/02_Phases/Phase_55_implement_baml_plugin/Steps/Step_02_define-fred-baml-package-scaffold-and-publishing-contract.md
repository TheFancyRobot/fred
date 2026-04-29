---
note_type: step
template_version: 2
contract_version: 1
title: 'Define fred-baml package scaffold and publishing contract'
step_id: STEP-55-02
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model|STEP-55-01 Plan step: baml plugin boundary and package model]]'
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 02 - Define fred-baml package scaffold and publishing contract

## Purpose

- Create package contract for `packages/fred-baml` in the Bun workspace (core-adjacent extension library).
- Define public API shape and imports (`import '@fancyrobot/fred-baml'` side-effects vs explicit runtime helpers).
- Expose planned exports aligned with research findings: `createBamlTool`, `BamlAgent`, `initFredBamlRuntime` (or equivalent), and BAML test-runner helpers.
- Define build/test/dependency posture for Bun and monorepo publishing consistency, including `@boundaryml/baml` peer/optional contracts.

## Outcome

- Concrete package blueprint:
  - `package.json` (version/peer dependencies/export/entrypoints/scripts/build)
  - `src/index.ts` with public exports
  - `src/agent.ts` / `src/tools.ts` / `src/testing.ts` module boundaries (or equivalent)
  - workspace wiring notes and package visibility in Bun config
- Decision on runtime registration pattern (effect service factory or pure helper exports) and explicit registration call sites.

## Required Reading

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]
- `packages/core/README.md`
- `packages/provider-openai/README.md`
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model|STEP-55-01]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract/Validation_Plan|Validation Plan]]

## Success Conditions

- [ ] New package directory and workspace-visible structure is planned, with clear production/test entrypoints.
- [ ] `@boundaryml/baml`, `@fancyrobot/fred`, and Effect-related peer/runtime dependencies are explicit.
- [ ] Public API contract documents the helper names for adapters and test/eval runners.
- [ ] No source code changes planned in this repo yet are omitted from this step plan (documentation + manifest only).

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract/Validation_Plan|Validation Plan]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract/Implementation_Notes|Implementation Notes]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract/Outcome|Outcome]]

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: See Execution Brief.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: ready for first-day junior execution after STEP-55-01. Scaffold only; avoid importing generated BAML client at package top level.
- Key dependency: mirror provider package export/build conventions before inventing a new package shape.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->
