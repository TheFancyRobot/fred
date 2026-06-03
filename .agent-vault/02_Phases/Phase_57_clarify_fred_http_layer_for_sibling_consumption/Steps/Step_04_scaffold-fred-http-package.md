---
note_type: step
template_version: 2
contract_version: 1
title: Scaffold fred-http package
step_id: STEP-57-04
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

# Step 04 - Scaffold fred-http package

Use this note as a thin index for one executable step. Keep detail in companion notes so execution can load only the smallest note needed.

## Purpose

- Outcome: Scaffold fred-http package.
- Parent phase: [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]].

## Required Reading

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_04_scaffold-fred-http-package/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_04_scaffold-fred-http-package/Validation_Plan|Validation Plan]]

## Companion Notes

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_04_scaffold-fred-http-package/Execution_Brief|Execution Brief]] - Why the step exists, prerequisites, likely code paths, and the smallest execution checklist.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_04_scaffold-fred-http-package/Validation_Plan|Validation Plan]] - Acceptance checks, commands, edge cases, and regression expectations.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_04_scaffold-fred-http-package/Implementation_Notes|Implementation Notes]] - Durable findings discovered while the step is being executed.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_04_scaffold-fred-http-package/Outcome|Outcome]] - Final result, validation evidence, and explicit follow-up.

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: completed
- Current owner: 
- Last touched: 2026-06-02
- Next action: Step complete; `packages/fred-http` scaffold exists and package-surface tests pass.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Put judgment calls or cautions here.
### Readiness checklist
- Exact outcome: create `packages/fred-http` with `package.json`, `README.md`, `src/index.ts`, stub `src/server.ts`, stub `src/security.ts`, stub `src/app-builder.ts`; wire root workspace dependency; add package-surface test; verify test passes.
- Why it matters: establishes the new `@fancyrobot/fred-http` package as the home for all reusable HTTP server APIs.
- Prerequisites: Phase 57 vault notes updated (Task 1).
- Starting files/directories: `packages/fred-http/` (new), `package.json` (root).
- Constraints: Bun-only runtime; Effect peer dependencies; no `Effect.runPromise` in domain logic.
- Validation: `bun test tests/unit/http/package-surface.test.ts` passes.
- Edge cases: peer dependency version ranges must be compatible with monorepo.
- Security/performance: no server behavior changes yet; scaffolding only.

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
