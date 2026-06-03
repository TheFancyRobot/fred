---
note_type: step
template_version: 2
contract_version: 1
title: Add composable custom-route API with shared security
step_id: STEP-57-06
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

# Step 06 - Add composable custom-route API with shared security

Use this note as a thin index for one executable step. Keep detail in companion notes so execution can load only the smallest note needed.

## Purpose

- Outcome: Add composable custom-route API with shared security.
- Parent phase: [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]].

## Required Reading

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Phase|Phase 57 clarify fred http layer for sibling consumption]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_06_add-composable-custom-route-api-with-shared-security/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_06_add-composable-custom-route-api-with-shared-security/Validation_Plan|Validation Plan]]

## Companion Notes

- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_06_add-composable-custom-route-api-with-shared-security/Execution_Brief|Execution Brief]] - Why the step exists, prerequisites, likely code paths, and the smallest execution checklist.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_06_add-composable-custom-route-api-with-shared-security/Validation_Plan|Validation Plan]] - Acceptance checks, commands, edge cases, and regression expectations.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_06_add-composable-custom-route-api-with-shared-security/Implementation_Notes|Implementation Notes]] - Durable findings discovered while the step is being executed.
- [[02_Phases/Phase_57_clarify_fred_http_layer_for_sibling_consumption/Steps/Step_06_add-composable-custom-route-api-with-shared-security/Outcome|Outcome]] - Final result, validation evidence, and explicit follow-up.

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: completed
- Current owner: 
- Last touched: 2026-06-02
- Next action: Step complete; `createFredHttpApp` supports public/authenticated custom routes with shared hardening.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Put judgment calls or cautions here.
### Readiness checklist
- Exact outcome: implement `createFredHttpApp` in `packages/fred-http/src/app-builder.ts` that accepts `fred`, optional `security` config, and optional custom `routes` array; returns a fetch-capable app; custom routes support `public` and `authenticated` visibility; shared security pipeline applied consistently; consumer handler errors are sanitized.
- Why it matters: enables consumers to define custom HTTP routes under Fred's security pipeline without forking.
- Prerequisites: STEP-57-05 server runtime move complete.
- Starting files/directories: `packages/fred-http/src/app-builder.ts` (new), `packages/fred-http/src/app.ts`, `packages/fred-http/src/routes.ts`, `packages/fred-http/src/security.ts`.
- Constraints: composable route API must not bypass security pipeline; `ServerApp` should consume same route-composition primitive where practical; no `Effect.runPromise` in domain logic.
- Validation: `bun test tests/unit/http/composition.test.ts` passes; `bun test tests/unit/http/error-sanitization.test.ts` passes.
- Edge cases: custom handler throws; unauthenticated request to authenticated route; rate limiting on custom routes.
- Security/performance: pipeline order preserved: CORS preflight → route classification → rate limit → auth for authenticated routes → handler execution → conditional CORS headers → sanitized errors.

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
