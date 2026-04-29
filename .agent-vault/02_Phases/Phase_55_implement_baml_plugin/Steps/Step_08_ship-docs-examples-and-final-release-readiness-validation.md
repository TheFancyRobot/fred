---
note_type: step
template_version: 2
contract_version: 1
title: 'Ship docs/examples and final release-readiness validation'
step_id: STEP-55-08
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-04-29'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks|STEP-55-07 Add testing, validation, and compatibility checks]]'
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 08 - Ship docs/examples and final release-readiness validation

## Purpose

- Finalize documentation and example scaffolding for adopting `fred-baml`.
- Include concrete usage patterns for `@fancyrobot/fred-baml` exports (`createBamlTool`, `BamlAgent`, `init`/test helper) and build commands.
- Add and document a mandatory new example: `examples/14-baml-integration/` (not optional).
- Ensure release/packaging checklists, CI expectations, and guardrails are explicit.
- Confirm no regression against existing examples and phase/guard workflows.
- Document coexistence model: markdown/frontmatter remains default discovery while BAML adds additive function/tool registration.

## Outcome

- README updates for package + workspace guidance.
- Add `examples/14-baml-integration/` as a required artifact with required structure: `package.json`, `README.md`, `.env.example`, `tsconfig.json`, `src/`, config files, and a documented `baml_src/` + generated `baml_client/` workflow.
- Demonstrate markdown/frontmatter agents coexisting with BAML-backed tool/function registration in the same sample.
- Release/readiness checklist (build, tests, examples, smoke) with rollback hooks.
- Explicitly call out server-mode assumptions and version compatibility caveats.

## Required Reading

- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]

- [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]
- `examples/README.md`
- `examples/13-multi-agent-workflows/src/runtime.ts`
- `examples/13-multi-agent-workflows/fred.runtime.ts`
- `tests/unit/examples/examples-guard.test.ts`
- `packages/cli/src/commands/chat.ts`
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation/Validation_Plan|Validation Plan]]

## Success Conditions

- [ ] `fred-baml` developer path is discoverable and copy-pasteable.
- [ ] New/updated docs explicitly preserve markdown/frontmatter workflow and show coexisting usage.
- [ ] `examples/14-baml-integration/` is created as mandatory, required deliverable.
- [ ] `examples/14-baml-integration/` includes required structure (`package.json`, `README.md`, `.env.example`, `tsconfig.json`, `src/`, markdown agent files) and demonstrates markdown + BAML coexistence.
- [ ] `tests/unit/examples/examples-guard.test.ts` is updated to include `14-baml-integration` in `EXPECTED_EXAMPLES`.
- [ ] `bun run test` + generation + example checks are listed and passing in final phase checklist.
- [ ] Final docs mention whether examples check in `baml_client/` artifacts or generate them during bootstrap.
- [ ] Final notes include risks, assumptions, and unresolved follow-up items.

## Companion Notes

- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation/Validation_Plan|Validation Plan]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation/Implementation_Notes|Implementation Notes]]
- [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation/Outcome|Outcome]]

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: planned
- Current owner: 
- Last touched: 2026-04-29
- Next action: See Execution Brief.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Refinement verdict: explicit execution requirement — create `examples/14-baml-integration/` and update examples guard expectations.
- Key caution: align `examples/README.md` numbering and test guard list if example is created.
- Keep generated/checked-in `baml_client/` artifact policy explicit for reproducible CI behavior.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->
