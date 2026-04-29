---
note_type: step
template_version: 2
contract_version: 1
title: 'Preserve markdown/frontmatter and resolve duplicate-ID boundaries'
step_id: STEP-55-05
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

# Step 05 - Preserve markdown/frontmatter and resolve duplicate-ID boundaries

## Purpose

- Ensure BAML tooling complements, not replaces, existing markdown agent loading and hot-reload.
- Define explicit behavior for duplicate IDs across markdown agents, config-defined agents, BAML-wrapped tools, and generated test artifacts.
- Preserve existing ambiguity checks on `.md` frontmatter ownership.
- Reaffirm additive BAML boundary: markdown/frontmatter discovery and hot-reload remain authoritative; BAML only augments tool surface.
- Verify that package build settings cannot mutate or shadow existing markdown-owned IDs by default.

## Outcome

- Boundary map that states what becomes an agent vs a tool when BAML is present.
- No changes to `file-loader`/`file-watcher` semantics except if adapter registration requires explicit config hooks.

## Required Reading

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- [[01_Architecture/System_Overview|System Overview]]
- `packages/core/src/config/initializer.ts`
- `packages/core/src/agent/file-loader.ts`
- `packages/core/src/agent/file-watcher.ts`
- `packages/core/src/config/loader.ts:297`
- tests/unit/core/config/agent-file-integration.test.ts
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries/Validation_Plan|Validation Plan]]

## Success Conditions

- [ ] Clear namespace policy for BAML-generated tool names vs markdown-defined agent IDs.
- [ ] No regressions in `ConfigInitializer` duplicate ID validation behavior.
- [ ] Markdown frontmatter remains valid for config-first and file-first agent workflows.
- [ ] Explicitly document handling when Markdown and BAML try to claim same semantic identifier.

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries/Validation_Plan|Validation Plan]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries/Implementation_Notes|Implementation Notes]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries/Outcome|Outcome]]

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: See Execution Brief.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: ready for first-day junior execution after STEP-55-04. Existing markdown/frontmatter behavior is protected by regression tests.
- Key caution: BAML functions become tools by explicit mapping; they do not become Fred agent IDs automatically.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->
