---
note_type: decision
template_version: 2
contract_version: 1
title: fred-baml uses provider-style library integration instead of CLI plugin runtime wiring
decision_id: DEC-0127
status: accepted
decided_on: '2026-04-29'
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
supersedes: []
superseded_by: []
related_notes:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]'
tags:
  - agent-vault
  - decision
---

# DEC-0127 - fred-baml uses provider-style library integration instead of CLI plugin runtime wiring

Use one note per durable choice. Record what was chosen, why, tradeoffs, and supersession history, and link back to the phase, bug, or architecture note that made the choice necessary. See [[07_Templates/Note_Contracts|Note Contracts]].

## Status

- Current status: accepted.
- Accepted during PHASE-55 refinement after team research and user confirmation.

## Context

- `fred-baml` needs to integrate BAML-authored functions/tests with Fred without breaking the existing markdown/frontmatter agent workflow.
- The existing CLI plugin subsystem under `packages/cli/src/plugin/*` is command/UI oriented and does not feed `Fred.initializeFromConfig()` or core runtime initialization today.
- Provider packages such as `packages/provider-openai` already demonstrate the desired package shape: a core-adjacent library package with explicit imports/registration behavior and package-local public exports.
- Related notes: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]].

## Decision

- Implement `fred-baml` as a core-adjacent extension/library package, planned under `packages/fred-baml`, with explicit helper exports and provider-style registration/lifecycle patterns.
- Do **not** use CLI plugin registration as the primary runtime integration seam for BAML-backed agents/tools.
- Preserve markdown/frontmatter discovery, parsing, duplicate-ID behavior, and hot reload as first-class core behavior.
- Treat BAML as an additive source system for generated typed functions, tool wrappers, tests/evals, and optional runtime helpers.

## Alternatives Considered

- CLI plugin-first integration: rejected because current CLI plugins do not wire into core runtime initialization and would make agent/tool behavior depend on a UI/command subsystem.
- Replacing markdown agents with BAML definitions: rejected because examples, config initialization, templates, watcher behavior, and current user workflows depend on markdown/frontmatter remaining authoritative.
- Hidden generate-on-runtime integration: rejected for the initial slice because stale or missing `baml_client` artifacts must fail loudly and be reproducible in CI.

## Tradeoffs

- The package will need explicit setup/build commands instead of being magically discovered by the CLI.
- Users may have both Fred validation and BAML validation steps, so docs and scripts must explain ownership clearly.
- Additive boundaries reduce migration risk but require careful duplicate-name/ID diagnostics when BAML tools are attached to markdown-authored agents.

## Consequences

- Step execution should model `fred-baml` package structure after `packages/provider-*`, not `packages/cli/src/plugin/*`.
- Initial API should emphasize explicit helpers such as `createBamlTool`, `BamlAgent`, `initFredBamlRuntime`, and test/eval helpers.
- Source/build steps must make `baml_src/` and generated `baml_client/` lifecycle explicit and avoid writing generated BAML files into watched `src/agents` directories.
- Any future CLI affordance should be a thin convenience layer over the package API, not the source of runtime truth.

## Related Notes

<!-- AGENT-START:decision-related-notes -->
- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
<!-- AGENT-END:decision-related-notes -->

## Change Log

<!-- AGENT-START:decision-change-log -->
- 2026-04-29 - Created as `proposed`.
- 2026-04-29 - Accepted as the PHASE-55 integration boundary.
<!-- AGENT-END:decision-change-log -->
