---
note_type: step
template_version: 2
contract_version: 1
title: 'Define baml source/build lifecycle and generation verification'
step_id: STEP-55-03
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract|STEP-55-02 Define fred-baml package scaffold and publishing contract]]'
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 03 - Define baml source/build lifecycle and generation verification

## Purpose

- Specify source-of-truth directories (`baml_src/` user-authored, `baml_client/` generated) and regeneration strategy.
- Define when and where `baml generate` runs in Bun workspace dev/build/test flow.
- Define stale-generation checks and deterministic diffs for CI safety.
- Decide when to run for async vs sync clients and how to expose any "server mode" assumptions in package docs.

## Outcome

- A robust generation contract, including:
  - required generation inputs (`baml_src`, `generators.baml`),
  - output expectation (`baml_client`),
  - generation checks in scripts and validation gates.
- A policy for whether generated artifacts are committed or generated during local CI, including whether `baml_client/` ships in repo or is generated in CI/build.

## Required Reading

- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- `packages/core/README.md`
- https://docs.boundaryml.com/guide/installation-language/typescript
- https://docs.boundaryml.com/guide/development/environment-variables
- https://docs.boundaryml.com/reference/typescript
- https://docs.boundaryml.com/reference/clients
- `packages/core/src/config/initializer.ts`
- `packages/cli/src/commands/chat.ts`
- `packages/core/src/agent/file-watcher.ts`
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification/Validation_Plan|Validation Plan]]

## Success Conditions

- [ ] Build lifecycle defines exactly when generation runs and what command fails on mismatch (including optional fail-fast for stale generated client).
- [ ] Validation includes stale/out-of-date artifact detection and explicit `baml_client` integrity checks.
- [ ] Decisions captured for async/sync clients and `b.stream.*` support in the generated runtime.
- [ ] Bun compatibility risks around `baml-cli` tool availability are planned and mitigated.
- [ ] Open question on generation in "server mode" resolved into an explicit plan item.

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification/Validation_Plan|Validation Plan]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification/Implementation_Notes|Implementation Notes]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification/Outcome|Outcome]]

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: See Execution Brief.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: ready for first-day junior execution after STEP-55-02. Start by verifying exact Bun-compatible BAML CLI commands.
- Key caution: no hidden runtime generation; missing/stale generated clients must fail loudly with recovery commands.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->
