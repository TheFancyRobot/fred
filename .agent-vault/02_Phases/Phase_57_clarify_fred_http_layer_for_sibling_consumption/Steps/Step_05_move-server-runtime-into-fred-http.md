---
note_type: step
template_version: 2
contract_version: 1
title: Move server runtime into fred-http
step_id: STEP-57-05
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

# Step 05 - Move server runtime into fred-http

Use this note as a thin index for one executable step. Keep detail in companion notes so execution can load only the smallest note needed.

## Purpose

- Outcome: Move server runtime into fred-http.
- Parent phase: [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]].

## Required Reading

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_05_move-server-runtime-into-fred-http/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_05_move-server-runtime-into-fred-http/Validation_Plan|Validation Plan]]

## Companion Notes

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_05_move-server-runtime-into-fred-http/Execution_Brief|Execution Brief]] - Why the step exists, prerequisites, likely code paths, and the smallest execution checklist.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_05_move-server-runtime-into-fred-http/Validation_Plan|Validation Plan]] - Acceptance checks, commands, edge cases, and regression expectations.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_05_move-server-runtime-into-fred-http/Implementation_Notes|Implementation Notes]] - Durable findings discovered while the step is being executed.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_05_move-server-runtime-into-fred-http/Outcome|Outcome]] - Final result, validation evidence, and explicit follow-up.

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: completed
- Current owner: 
- Last touched: 2026-06-02
- Next action: Step complete; server runtime moved into `packages/fred-http` and regression tests pass.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Put judgment calls or cautions here.
### Readiness checklist
- Exact outcome: copy/move server modules from `packages/dev/src/server/` to `packages/fred-http/src/` (app.ts, handlers.ts, rate-limiter.ts, routes.ts, security.ts); refactor `packages/fred-http/src/server.ts` to own `startServer`/`ServerApp`; update `packages/dev/src/index.ts` to remove server re-exports; update test imports.
- Why it matters: separates reusable HTTP server from dev-only tooling.
- Prerequisites: STEP-57-04 scaffold complete.
- Starting files/directories: `packages/dev/src/server/`, `packages/fred-http/src/`.
- Constraints: adjust relative imports only; preserve semantic behavior; no new `Effect.runPromise` in helpers.
- Validation: `bun test tests/unit/dev/security.test.ts tests/unit/dev/rate-limiter.test.ts` passes with new import paths.
- Edge cases: circular imports between fred-http and fred-dev must not exist.
- Security/performance: preserve all existing security behavior unchanged.

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
