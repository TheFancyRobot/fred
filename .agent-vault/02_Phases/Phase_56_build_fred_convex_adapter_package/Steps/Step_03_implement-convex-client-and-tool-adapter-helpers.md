---
note_type: step
template_version: 2
contract_version: 1
title: Implement Convex client and tool adapter helpers
step_id: STEP-56-03
phase: '[[02_Phases/Phase_56_build_fred_convex_adapter_package/Phase|Phase 56 build fred convex adapter package]]'
status: completed
owner: step-56-03-worker
created: '2026-06-02'
updated: '2026-06-02'
depends_on: []
related_sessions:
  - '[[05_Sessions/2026-06-02-210246-implement-convex-client-and-tool-adapter-helpers-step-56-03-worker|SESSION-2026-06-02-210246 step-56-03-worker session for Implement Convex client and tool adapter helpers]]'
related_bugs: []
tags:
  - agent-vault
  - step
context_id: SESSION-2026-06-02-210246
active_session_id: 05_Sessions/2026-06-02-210246-implement-convex-client-and-tool-adapter-helpers-step-56-03-worker
context_status: completed
context_summary: Completed [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers|STEP-56-03 Implement Convex client and tool adapter helpers]].
---

# Step 03 - Implement Convex client and tool adapter helpers

Use this note as a thin index for one executable step. Keep detail in companion notes so execution can load only the smallest note needed.

## Purpose

- Outcome: Implement Convex client and tool adapter helpers.
- Parent phase: [[02_Phases/Phase_56_build_fred_convex_adapter_package/Phase|Phase 56 build fred convex adapter package]].

## Required Reading

- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Phase|Phase 56 build fred convex adapter package]]
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers/Validation_Plan|Validation Plan]]

## Companion Notes

- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers/Execution_Brief|Execution Brief]] - Why the step exists, prerequisites, likely code paths, and the smallest execution checklist.
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers/Validation_Plan|Validation Plan]] - Acceptance checks, commands, edge cases, and regression expectations.
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers/Implementation_Notes|Implementation Notes]] - Durable findings discovered while the step is being executed.
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers/Outcome|Outcome]] - Final result, validation evidence, and explicit follow-up.

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: completed
- Current owner: step-56-03-worker
- Last touched: 2026-06-02
- Next action: Execute [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption|STEP-56-04 Validate Convex adapter package for sibling file-dependency consumption]].
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Put judgment calls or cautions here.
### Readiness checklist
- Exact outcome: implement approved Convex runtime/client wrapper and Fred tool helper(s), returning normal Fred `Tool` objects with Effect Schema input/success metadata.
- Why it matters: this is the reusable adapter logic Stanza should import instead of building Stanza-only Fred↔Convex glue.
- Prerequisites: STEP-56-01 approved API and STEP-56-02 scaffold merged in working tree.
- Starting files/directories: `packages/fred-convex/src/index.ts`, likely `runtime.ts`, `tools.ts`, `errors.ts`, `testing.ts`; compare `packages/fred-baml/src/tools.ts` and `packages/fred-baml/src/runtime.ts`.
- Constraints: no app-generated Convex API imports; caller passes client/function reference; no `/Users/dino/dev/stanza` edits; use typed errors instead of unstructured throws where practical; keep public API small.
- Validation: targeted unit tests for query/mutation/action dispatch against a stub client; Fred integration test registering a Convex-backed tool and executing it through `Fred.getTool(...).execute(...)`.
- Edge cases: missing client, rejected Convex call, unknown operation type, invalid tool input, function result shape mismatch, optional auth token not present.
- Security/performance: never log Convex URL/token; no automatic retries unless explicit in design; document timeout/retry behavior as caller responsibility if not implemented.
- Integration touchpoints: `Tool` schema metadata, Fred registry validation, package exports, sibling `file:` dependency install.
- Blockers: exact Convex client package/API version may need confirmation before implementation if not already present in dependencies.
- Junior readiness verdict: pass after API approval and scaffold exist; otherwise blocked.

## Session History

<!-- AGENT-START:step-session-history -->
- 2026-06-02 - [[05_Sessions/2026-06-02-210246-implement-convex-client-and-tool-adapter-helpers-step-56-03-worker|SESSION-2026-06-02-210246 step-56-03-worker session for Implement Convex client and tool adapter helpers]] - Session created.
<!-- AGENT-END:step-session-history -->

## Related Notes

- [[07_Templates/Note_Contracts|Note Contracts]]
- [[07_Templates/Phase_Template|Phase Template]]
- [[01_Architecture/Code_Map|Code Map]]
- [[01_Architecture/Domain_Model|Domain Model]]
- [[01_Architecture/Integration_Map|Integration Map]]
- [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127 provider-style package precedent]]
