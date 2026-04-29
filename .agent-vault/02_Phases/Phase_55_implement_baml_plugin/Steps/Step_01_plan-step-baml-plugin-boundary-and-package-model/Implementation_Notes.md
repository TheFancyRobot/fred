---
note_type: step-companion
template_version: 1
contract_version: 1
title: Implementation Notes - STEP-55-01
step_id: STEP-55-01
phase: '[[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]'
status: completed
created: '2026-04-29'
updated: '2026-04-29'
tags:
  - agent-vault
  - step-companion
  - implementation-notes
---

# Implementation Notes - STEP-55-01

- Capture durable findings learned during execution. Prefer short bullets with file paths, commands, and observed behavior.

## Decision Record (DEC-0127 confirmed)

**One-line architecture decision:**
`fred-baml` is a core-adjacent extension/library package (provider-style) with explicit helper exports. It owns BAML loading/tool wrapping only. Markdown agents, frontmatter parsing, and hot-reload remain in core. CLI/plugin subsystem is NOT required for runtime feature wiring.

## Source Ownership Boundaries

| Source | Owner | Notes |
|--------|-------|-------|
| `src/agents/*.md` (and `agents/` fallback) | Core (`packages/core`) | Fred agent discovery, hot reload, duplicate-ID diagnostics |
| `baml_src/` + `baml_client/` | `packages/fred-baml` | Generated client files MUST NOT be under watched agent directories |

## Rejected Alternatives

| Alternative | Reason for Rejection |
|-------------|---------------------|
| CLI plugin-first integration | `packages/cli/src/plugin/*` does not wire into `Fred.initializeFromConfig()` |
| Replacing markdown agents | User workflows, examples, templates depend on frontmatter |
| Hidden generate-on-runtime | Must fail loudly; stale outputs must be reproducible in CI |
| Runtime BAML generation under watched dirs | `src/agents/*.md` and `agents/` must remain clean of generated artifacts |

## Generation Policy (Provisional - STEP-55-03 finalizes)

- Runtime expects an **explicit pre-generated client**; no hidden runtime generation
- No generated artifacts in watched agent directories (`src/agents/` or `agents/`)
- Fixture/check-in policy finalized in STEP-55-03 (BAML CLI command, fixture strategy)

## Duplicate-ID/Name Boundary

- BAML functions become Fred tools **only** through explicit mapping
- Optional `BamlAgent` wrappers require explicit IDs
- Must respect existing duplicate-ID diagnostics from core
- Conflict-first mutation policy: reject duplicates before any persistent state update

## Validation Commands Run

- `vault_validate target=all` → ✅ 242 notes checked, 0 errors, 0 warnings

## Revision 1 Corrections Applied (from reviewer feedback)

1. ✅ Removed scope drift: STEP-55-01 is **documentation/decision boundary record only**
2. ✅ Rephrased generation policy as explicit/reproducible (STEP-55-03 finalizes lifecycle)
3. ✅ Added duplicate-ID/name boundary constraint
4. ✅ Added watched-directory constraint for generated files
5. ✅ Added validation/vault outputs to this note

## Cross-Step Validation

STEP-55-02 Execution_Brief.md references STEP-55-01 boundary and DEC-0127: ✅ Confirmed
- File: `Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract/Execution_Brief.md`
- References "Boundary: STEP-55-01 provides the integration boundary and DEC-0127 contract"

This confirms the boundary is locked and later steps inherit it as required reading.

- Provider pattern reference: `packages/provider-openai/src/index.ts` (EffectProviderFactory pattern)
- Tool interface reference: `packages/core/src/tool/tool.ts` (Tool<Input, Output, Failure>)
- CLI plugin reference: `packages/cli/src/plugin/manager.ts` (rejected prior art)
- Core agent files: `packages/core/src/agent/file-loader.ts`, `packages/core/src/agent/file-watcher.ts` (unchanged)

## Related Notes

- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model|STEP-55-01 Plan step: baml plugin boundary and package model]]
- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|Phase 55 implement baml plugin]]