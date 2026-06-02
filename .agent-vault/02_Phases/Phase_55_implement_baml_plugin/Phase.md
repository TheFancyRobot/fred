---
note_type: phase
template_version: 2
contract_version: 1
title: Implement BAML plugin
phase_id: PHASE-55
status: planned
owner: ''
created: '2026-04-29'
updated: '2026-06-02'
depends_on:
  - '[[02_Phases/Phase_54_cancellation_propagation/Phase|PHASE-54 Cancellation Propagation]]'
related_architecture:
  - '[[01_Architecture/System_Overview|System Overview]]'
  - '[[01_Architecture/Code_Map|Code Map]]'
  - '[[02_Phases/Phase_32_plugin_architecture/Phase|Phase 32 Plugin Architecture]]'
related_decisions:
  - '[[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127 fred-baml uses provider-style library integration instead of CLI plugin runtime wiring]]'
related_bugs:
  - '[[03_Bugs/BUG-0001_failed-release-action-4-2-26|BUG-0001 Failed release action 4-2-26]]'
tags:
  - agent-vault
  - phase
---

# Phase 55 Implement BAML plugin

Use this note for a bounded phase. Keep it focused, link outward, and avoid duplicating durable detail from architecture, bug, or decision notes. See [[07_Templates/Note_Contracts|Note Contracts]].

## Objective

- Define and plan the first implementation slice of a new `fred-baml` extension package that:
  - uses `@boundaryml/baml`/generated clients for type-safe function surfaces,
  - maps BAML functions into Fred tooling safely (`createBamlTool`, `BamlAgent` style helpers),
  - preserves markdown + frontmatter agent authoring as first-class, and
  - adds generation/build/test guardrails for reproducible upgrades.

## Why This Phase Exists

- Fred has a mature markdown-agent runtime and provider plugin model, but no first-class BAML integration surface.
- This phase establishes the seam so BAML can be used as an additive function/tool authoring mode without replacing existing frontmatter workflows.

## Scope

- Design `packages/fred-baml` package structure, build/registration contract, and public exports.
- Design `packages/fred-baml` structure as a core-adjacent extension/library package with explicit registration/build steps.
- Define BAML source/build lifecycle and validation policy (`@boundaryml/baml`, `baml_src/`, `generators.baml`, generated `baml_client/`).
- Specify adapter architecture for BAML function discovery, tool registration, and streaming/error/event handling.
- Preserve existing markdown/frontmatter behavior and avoid ID conflicts with current `ConfigInitializer`/`AgentFileWatcher` behavior.
- Plan deterministic testing and release-readiness checks (including stale generation and duplicate-ID guards).

## Non-Goals

- Replacing the existing markdown agent system.
- Building a full BAML authoring IDE or custom runtime compiler.
- Using CLI plugin registration as the primary runtime integration path.
- Expanding into language-model migration tooling or production deployment orchestration.

## Dependencies

- Depends on [[02_Phases/Phase_54_cancellation_propagation/Phase|PHASE-54 Cancellation Propagation]].

## Key Assumptions

- BAML integration should follow the same pattern as provider packages (`packages/provider-*`) for registration/lifecycle and **not** the CLI plugin model.
- `fred-baml` should act as a provider-like runtime library, with optional explicit helper exports like `createBamlTool`, `BamlAgent`, and test/runtime init helpers.
- Generation outputs remain codegen artifacts and are managed explicitly in project scripts/CI.
- Core config parser should remain unchanged for markdown agent discovery semantics.
- Streaming support requires explicit adapter mapping to existing Fred `StreamEvent` contracts.
- Version compatibility with `@boundaryml/baml` should be declared as part of the package contract.

## Risks

- Generated client drift or stale outputs causing runtime mismatch.
- Bun/CLI workflow complexity around `baml-cli` availability in CI.
- API fidelity mismatch between BAML sync/async client shapes and Fred expectations (`b.func.*` vs `b.stream.*`).
- Event contract mismatch between BAML streaming and Fred stream consumers.
- Additional test systems (`baml test` + Fred eval) increasing run-time and CI cost.
- Version compatibility risk across `@boundaryml/baml` releases and Bun package/tooling constraints.

## Acceptance Criteria

- [ ] Step notes are created and fully sequenced (8 executable steps).
- [ ] Package boundary and registration seam is fixed as provider-style extension, not CLI plugin path.
- [ ] Markdown/frontmatter load paths and duplicate-ID constraints remain unchanged and validated.
- [ ] Streaming/error/event behavior has explicit mapping and acceptance checks.
- [ ] Testing plan includes stale-generation detection, adapter correctness, and example/guard coverage.
- [ ] Documentation/example plan includes a **mandatory** `examples/14-baml-integration/` artifact and coexistence guidance for Markdown + BAML with explicit registration/build usage.
- [ ] Planned API contract includes concrete helper exports (`createBamlTool`, `BamlAgent`, test helper/init helper names).
- [ ] Steps include updating `tests/unit/examples/examples-guard.test.ts` and `examples/README.md` indexing when adding the new example.

## Open Questions

- Generation lifecycle default: do not generate on every runtime call and do not generate inside `node_modules`; Step 03 must verify the exact Bun-compatible BAML CLI command and choose checked-in fixture output vs deterministic test setup for package fixtures.
- Streaming fidelity default: non-streaming `createBamlTool` is required; streaming is opt-in and Step 06 must fill the explicit BAML-to-Fred event mapping matrix before implementing full fidelity.
- BAML server mode default: deferred unless direct generated TypeScript client mode cannot satisfy runtime needs; document as a caveat in Step 03/08.
- Version compatibility default: Step 03/07 must pin or guard the supported `@boundaryml/baml` range and fail with actionable diagnostics for unsupported generated client shapes.
- Boundary rules default: markdown/frontmatter owns Fred agent discovery; BAML functions become tools only through explicit mapping; optional `BamlAgent` wrappers require explicit IDs and must respect existing duplicate-ID behavior.

## Linear Context

<!-- AGENT-START:phase-linear-context -->
- Previous phase: [[02_Phases/Phase_54_cancellation_propagation/Phase|PHASE-54 Cancellation Propagation]]
- Current phase status: planned
- Next phase: [[02_Phases/Phase_56_build_fred_convex_adapter_package/Phase|PHASE-56 Build Fred Convex adapter package]]
<!-- AGENT-END:phase-linear-context -->

## Related Architecture

<!-- AGENT-START:phase-related-architecture -->
- [[01_Architecture/System_Overview|System Overview]]
- [[01_Architecture/Code_Map|Code Map]]
- [[02_Phases/Phase_32_plugin_architecture/Phase|Phase 32 Plugin Architecture]]
<!-- AGENT-END:phase-related-architecture -->

## Related Decisions

<!-- AGENT-START:phase-related-decisions -->
- [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127 fred-baml uses provider-style library integration instead of CLI plugin runtime wiring]]
<!-- AGENT-END:phase-related-decisions -->

## Related Bugs

<!-- AGENT-START:phase-related-bugs -->
- [[03_Bugs/BUG-0001_failed-release-action-4-2-26|BUG-0001 Failed release action 4-2-26]]
<!-- AGENT-END:phase-related-bugs -->

## Steps

<!-- AGENT-START:phase-steps -->
- [x] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_01_plan-step-baml-plugin-boundary-and-package-model|STEP-55-01 Plan step: baml plugin boundary and package model]]
- [ ] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_02_define-fred-baml-package-scaffold-and-publishing-contract|STEP-55-02 Define fred-baml package scaffold and publishing contract]]
- [ ] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification|STEP-55-03 Define baml source/build lifecycle and generation verification]]
- [ ] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing|STEP-55-04 Implement baml client adapter: agent/tool mapping and typing]]
- [ ] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries|STEP-55-05 Preserve markdown/frontmatter and resolve duplicate-ID boundaries]]
- [ ] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools|STEP-55-06 Add streaming and runtime contracts for baml tools]]
- [ ] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks|STEP-55-07 Add testing, validation, and compatibility checks]]
- [ ] [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation|STEP-55-08 Ship docs/examples and final release-readiness validation]]
<!-- AGENT-END:phase-steps -->

## Refinement Summary

- Refined on 2026-04-29 using the vault-refine checklist.
- Phase-level workflow map: decide extension boundary (Step 01) -> scaffold package (Step 02) -> make BAML generation reproducible (Step 03) -> adapt generated functions to Fred tools/agents (Step 04) -> protect markdown/frontmatter coexistence (Step 05) -> add streaming/runtime contracts (Step 06) -> add deterministic validation (Step 07) -> ship docs/examples/readiness checks (Step 08).
- Shared starting paths: `packages/provider-openai/`, `packages/core/src/tool/tool.ts`, `packages/core/src/tool/service.ts`, `packages/core/src/config/initializer.ts`, `packages/core/src/agent/file-loader.ts`, `packages/core/src/agent/file-watcher.ts`, `packages/core/src/stream/events.ts`, `tests/unit/core/config/agent-file-integration.test.ts`, and `tests/unit/examples/examples-guard.test.ts`.
- Shared constraints: no CLI-plugin-first runtime wiring, no markdown/frontmatter behavior regressions, no hidden runtime BAML generation, no generated BAML artifacts in watched agent directories, no provider API keys in deterministic tests.
- Readiness verdict: all eight steps now have concrete execution briefs, starting files, validation commands, edge cases, and junior-developer readiness notes.

## Notes

- Add architecture, bug, and decision links as the milestone becomes more concrete.
- Use the `Steps/` directory for first executable units instead of expanding this note too far.
- Keep all source changes out of this phase until execution is explicitly handed off.
