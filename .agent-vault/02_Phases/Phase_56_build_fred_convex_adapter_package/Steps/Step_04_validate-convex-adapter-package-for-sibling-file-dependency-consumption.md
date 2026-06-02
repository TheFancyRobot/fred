---
note_type: step
template_version: 2
contract_version: 1
title: Validate Convex adapter package for sibling file-dependency consumption
step_id: STEP-56-04
phase: '[[02_Phases/Phase_56_build_fred_convex_adapter_package/Phase|Phase 56 build fred convex adapter package]]'
status: completed
owner: step-56-04-worker
created: '2026-06-02'
updated: '2026-06-02'
depends_on: []
related_sessions:
  - '[[05_Sessions/2026-06-02-210703-validate-convex-adapter-package-for-sibling-file-dependency-consumption-step-56-04-worker|SESSION-2026-06-02-210703 step-56-04-worker session for Validate Convex adapter package for sibling file-dependency consumption]]'
related_bugs: []
tags:
  - agent-vault
  - step
context_id: SESSION-2026-06-02-210703
active_session_id: 05_Sessions/2026-06-02-210703-validate-convex-adapter-package-for-sibling-file-dependency-consumption-step-56-04-worker
context_status: completed
context_summary: Completed [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption|STEP-56-04 Validate Convex adapter package for sibling file-dependency consumption]].
---

# Step 04 - Validate Convex adapter package for sibling file-dependency consumption

Use this note as a thin index for one executable step. Keep detail in companion notes so execution can load only the smallest note needed.

## Purpose

- Outcome: Validate Convex adapter package for sibling file-dependency consumption.
- Parent phase: [[02_Phases/Phase_56_build_fred_convex_adapter_package/Phase|Phase 56 build fred convex adapter package]].

## Required Reading

- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Phase|Phase 56 build fred convex adapter package]]
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption/Execution_Brief|Execution Brief]]
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption/Validation_Plan|Validation Plan]]

## Companion Notes

- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption/Execution_Brief|Execution Brief]] - Why the step exists, prerequisites, likely code paths, and the smallest execution checklist.
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption/Validation_Plan|Validation Plan]] - Acceptance checks, commands, edge cases, and regression expectations.
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption/Implementation_Notes|Implementation Notes]] - Durable findings discovered while the step is being executed.
- [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption/Outcome|Outcome]] - Final result, validation evidence, and explicit follow-up.

## Agent-Managed Snapshot

<!-- AGENT-START:step-agent-managed-snapshot -->
- Status: completed
- Current owner: step-56-04-worker
- Last touched: 2026-06-02
- Next action: Phase complete. All 4 steps done.
<!-- AGENT-END:step-agent-managed-snapshot -->

## Human Notes

- Put judgment calls or cautions here.
### Readiness checklist
- Exact outcome: prove `@fancyrobot/fred-convex` works from Fred tests and from a throwaway sibling-style project using normal package names with local `file:` specifiers.
- Why it matters: Stanza MVP depends on local package resolution, not published packages.
- Prerequisites: STEP-56-02 scaffold and STEP-56-03 implementation complete.
- Starting files/directories: `tests/unit/fred-convex/`, `packages/fred-convex/package.json`, temporary directory under `/tmp` or another throwaway path outside `/Users/dino/dev/stanza`.
- Constraints: do not modify Stanza; do not require live Convex deployment; preserve workspace dev dependency strategy.
- Validation commands: `bun test tests/unit/fred-convex`; `bun run --filter '@fancyrobot/fred-convex' build`; temp install with `@fancyrobot/fred: file:/Users/dino/dev/fred/packages/core` and `@fancyrobot/fred-convex: file:/Users/dino/dev/fred/packages/fred-convex`; import and execute a stub adapter smoke script.
- Edge cases: peer dependency resolution must not try `workspace:^` outside Fred; package exports must resolve by normal npm name; tests must fail clearly if Convex peer package is absent and required.
- Security/performance: temp scripts must use fake tokens/URLs only; cleanup temp files after validation if practical.
- Integration touchpoints: Bun installer, package exports, Fred core package, test fixtures.
- Blockers: TypeScript repo-wide issues unrelated to package may be reported separately rather than blocking targeted package validation.
- Junior readiness verdict: pass after prior steps complete.

## Session History

<!-- AGENT-START:step-session-history -->
- 2026-06-02 - [[05_Sessions/2026-06-02-210703-validate-convex-adapter-package-for-sibling-file-dependency-consumption-step-56-04-worker|SESSION-2026-06-02-210703 step-56-04-worker session for Validate Convex adapter package for sibling file-dependency consumption]] - Session created.
<!-- AGENT-END:step-session-history -->

## Related Notes

- [[07_Templates/Note_Contracts|Note Contracts]]
- [[07_Templates/Phase_Template|Phase Template]]
- [[01_Architecture/Code_Map|Code Map]]
- [[01_Architecture/Integration_Map|Integration Map]]
