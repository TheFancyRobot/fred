---
note_type: step
template_version: 2
contract_version: 1
title: Define fred-baml package scaffold and publishing contract
step_id: STEP-55-02
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-06-11'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model|STEP-55-01 Plan step: baml plugin boundary and package model]]'
related_sessions:
  - '[[05_Sessions/2026-04-29-044749-define-fred-baml-package-scaffold-and-publishing-contract-implementor-2|SESSION-2026-04-29-044749 implementor-2 session for Define fred-baml package scaffold and publishing contract]]'
  - '[[05_Sessions/2026-04-29-044755-define-fred-baml-package-scaffold-and-publishing-contract-implementor-1|SESSION-2026-04-29-044755 implementor-1 session for Define fred-baml package scaffold and publishing contract]]'
  - '[[05_Sessions/2026-06-02-183554-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml|SESSION-2026-06-02-183554 fred-baml session for Define fred-baml package scaffold and publishing contract]]'
  - '[[05_Sessions/2026-06-11-194010-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml|SESSION-2026-06-11-194010 fred-baml session for Define fred-baml package scaffold and publishing contract]]'
related_bugs: []
tags:
  - agent-vault
  - step
context_id: SESSION-2026-06-11-194010
active_session_id: 05_Sessions/2026-06-11-194010-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml
context_status: active
context_summary: Advance [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract|STEP-55-02 Define fred-baml package scaffold and publishing contract]].
---

# Step 02 - Define fred-baml package scaffold and publishing contract

## Purpose

- Create package contract for `packages/fred-baml` in the Bun workspace (core-adjacent extension library).
- Define public API shape and imports (`import '@fancyrobot/fred-baml'` side-effects vs explicit runtime helpers).
- Expose planned exports aligned with research findings: `createBamlTool`, `BamlAgent`, `initFredBamlRuntime`, and explicit test helpers (`createStubBamlRuntime`, `loadStubBamlClient`).
- Define build/test/dependency posture for Bun and monorepo publishing consistency, including whether `@boundaryml/baml` is a direct package dependency or remains consumer-owned.

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
- [ ] Consumer-owned BAML runtime expectations and `@fancyrobot/fred` / Effect peer dependencies are explicit.
- [ ] Public API contract documents the helper names for adapters and test helpers, including `baml.<functionName>` tool-id generation.
- [ ] Step contract covers the scaffolded source modules, tests, manifests, and docs needed for the first publishable `fred-baml` package slice.

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
- Key dependency: mirror provider package export/build conventions before inventing a new package shape, while keeping generated-client loading and `@boundaryml/baml` version ownership in the consumer app.

## Session History

<!-- AGENT-START:step-session-history -->
- 2026-04-29 - [[05_Sessions/2026-04-29-044749-define-fred-baml-package-scaffold-and-publishing-contract-implementor-2|SESSION-2026-04-29-044749 implementor-2 session for Define fred-baml package scaffold and publishing contract]] - Session created.
- 2026-04-29 - [[05_Sessions/2026-04-29-044755-define-fred-baml-package-scaffold-and-publishing-contract-implementor-1|SESSION-2026-04-29-044755 implementor-1 session for Define fred-baml package scaffold and publishing contract]] - Session created.
- 2026-06-02 - [[05_Sessions/2026-06-02-183554-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml|SESSION-2026-06-02-183554 fred-baml session for Define fred-baml package scaffold and publishing contract]] - Session created.
- 2026-06-11 - [[05_Sessions/2026-06-11-194010-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml|SESSION-2026-06-11-194010 fred-baml session for Define fred-baml package scaffold and publishing contract]] - Session created.
<!-- AGENT-END:step-session-history -->
- [[05_Sessions/2026-06-05-201221-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml|SESSION-2026-06-05-201221 fred-baml package-resolution validation]]
- [[05_Sessions/2026-06-06-223452-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml|SESSION-2026-06-06-223452 fred-baml package-resolution validation]]
- [[05_Sessions/2026-06-08-151842-define-fred-baml-package-scaffold-and-publishing-contract-fred-baml|SESSION-2026-06-08-151842 fred-baml sibling-consumption validation]]
