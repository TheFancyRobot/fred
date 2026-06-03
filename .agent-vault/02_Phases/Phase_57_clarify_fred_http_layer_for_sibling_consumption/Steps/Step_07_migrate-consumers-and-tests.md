---
note_type: step
template_version: 2
contract_version: 1
title: Migrate consumers and tests
step_id: STEP-57-07
phase: '[[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]]'
status: completed
owner: ''
created: '2026-06-02'
updated: '2026-06-02'
depends_on: []
related_sessions: []
related_bugs: []
tags:
  - agent-vault
  - step
---

# Step 07 - Migrate consumers and tests

Use this note as a thin index for one executable step. Keep detail in companion notes so execution can load only the smallest note needed.

## Purpose

- Outcome: Migrate consumers and tests.
- Parent phase: [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]].

## Required Reading

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_07_migrate-consumers-and-tests/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_07_migrate-consumers-and-tests/Validation_Plan|Validation Plan]]

## Companion Notes

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_07_migrate-consumers-and-tests/Execution_Brief|Execution Brief]] - Why the step exists, prerequisites, likely code paths, and the smallest execution checklist.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_07_migrate-consumers-and-tests/Validation_Plan|Validation Plan]] - Acceptance checks, commands, edge cases, and regression expectations.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_07_migrate-consumers-and-tests/Implementation_Notes|Implementation Notes]] - Durable findings discovered while the step is being executed.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_07_migrate-consumers-and-tests/Outcome|Outcome]] - Final result, validation evidence, and explicit follow-up.

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: completed
- Current owner: 
- Last touched: 2026-06-02
- Next action: Step complete; repo consumers and tests now reference `@fancyrobot/fred-http`.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Put judgment calls or cautions here.
### Readiness checklist
- Exact outcome: remove reusable server exports from `packages/dev/src/index.ts`; update `packages/dev/package.json` and README; update all repo docs/import examples to reference `@fancyrobot/fred-http`; update root package dependencies; add sibling-consumption smoke test.
- Why it matters: completes the migration so `@fancyrobot/fred-dev` is dev-only.
- Prerequisites: STEP-57-06 composable API complete.
- Starting files/directories: `packages/dev/`, `README.md`, `docs/`, `package.json`.
- Constraints: `packages/dev/src/server.ts` may remain as a repo-local CLI bridge but must not be exported from package.
- Validation: `bun test tests/unit/http/` passes; `bun test tests/unit/dev/` passes; `rg -n '@fancyrobot/fred-dev.*ServerApp|@fancyrobot/fred-dev.*startServer' . -g '!node_modules'` returns no active consumer references.
- Edge cases: old import references in changelog/history are acceptable.
- Security/performance: no weakening of security behavior.

## Session History

<!-- AGENT-START:step-session-history -->
- No sessions yet.
<!-- AGENT-END:step-session-history -->

## Related Notes

- [[07_Templates/Note_Contracts|Note Contracts]]
- [[07_Templates/Phase_Template|Phase Template]]
- [[01_Architecture/Code_Map|Code Map]]
- [[01_Architecture/Integration_Map|Integration Map]]
- [[01_Architecture/System_Overview|System Overview]]
