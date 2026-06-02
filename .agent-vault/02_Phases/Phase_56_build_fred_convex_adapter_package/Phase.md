---
note_type: phase
template_version: 2
contract_version: 1
title: Build Fred Convex adapter package
phase_id: PHASE-56
status: completed
owner: ''
created: '2026-06-02'
updated: '2026-06-02'
depends_on:
  - '[[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]'
related_architecture: '[[01_Architecture/Code_Map|Code Map]]; [[01_Architecture/Domain_Model|Domain Model]]; [[01_Architecture/Integration_Map|Integration Map]]'
related_decisions: '[[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127 fred-baml uses provider-style library integration instead of CLI plugin runtime wiring]]'
related_bugs: ''
tags:
  - agent-vault
  - phase
---

# Phase 56 Build Fred Convex adapter package

Use this note for a bounded phase. Keep it focused, link outward, and avoid duplicating durable detail from architecture, bug, or decision notes. See [[07_Templates/Note_Contracts|Note Contracts]].

## Objective

- Define and complete the Build Fred Convex adapter package milestone.
- Build or define a reusable Fred↔Convex adapter package/API in the Fred monorepo so sibling applications such as Stanza can keep app-specific Convex schema/functions locally while reusing Fred-side adapter logic.
- Preserve normal npm package names with local `file:` resolution for sibling MVP consumption.
- Do not modify `/Users/dino/dev/stanza`; validate from Fred-side and temporary throwaway install locations only.

## Why This Phase Exists

- Capture the next bounded milestone after [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]].

## Scope

- Add the concrete work items for this milestone.
- Create step notes as execution becomes clearer.
- Create a new core-adjacent adapter package, expected package name `@fancyrobot/fred-convex`, under `packages/fred-convex/` unless implementation research proves a different name is necessary.
- Adapter scope is reusable Fred↔Convex glue only: client/runtime initialization, typed wrappers around Convex query/mutation/action calls, and helper(s) for exposing Convex calls as Fred `Tool`s.
- Follow provider-style/library package precedent from `packages/provider-*` and `packages/fred-baml`: public exports in package-local `src/index.ts`, `@fancyrobot/fred` as peer dependency for consumers and `workspace:^` dev dependency for monorepo development.
- Keep app-specific Convex schema, generated API modules, deployment URLs, auth tokens, and function references in the consuming app such as Stanza.

## Non-Goals

- Leave unrelated follow-on ideas in the roadmap or inbox until they become concrete.
- Do not create Stanza Convex schema/functions or modify `/Users/dino/dev/stanza`.
- Do not add Convex as a dependency of `@fancyrobot/fred` core.
- Do not make Convex calls during deterministic tests; use stub clients/functions.
- Do not design a general HTTP server here; HTTP layer work belongs to PHASE-57.

## Dependencies

- Depends on [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]].

## Acceptance Criteria

- [x] Scope is concrete and linked to the right durable notes.
- [x] Step notes exist for the first executable work units.
- [x] Validation and documentation expectations are explicit.
- [x] Package boundary is explicit: `@fancyrobot/fred-convex` is a library adapter, not a CLI plugin and not core code.
- [x] Public API names, inputs, outputs, and error behavior are documented in the step notes before implementation.
- [x] Deterministic unit tests cover query/mutation/action client dispatch and Fred tool registration/execution with a stub Convex client.
- [x] Package manifest supports monorepo development and sibling `file:` consumption: local dev dependency stays `workspace:^`; external-facing peer dependency uses a real semver range.
- [x] Validation includes package build, targeted tests, and a temporary install that uses normal npm package names resolved to local `file:` paths.

## Linear Context

<!-- AGENT-START:phase-linear-context -->
- Previous phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Current phase status: completed
- Next phase: not sequenced; PHASE-57 is independent HTTP-layer work.
<!-- AGENT-END:phase-linear-context -->

## Related Architecture

<!-- AGENT-START:phase-related-architecture -->
- None yet.
<!-- AGENT-END:phase-related-architecture -->
- [[01_Architecture/Code_Map|Code Map]] — package layout and provider-style extension patterns.
- [[01_Architecture/Domain_Model|Domain Model]] — Fred tools/agents/provider abstractions and public facade boundaries.
- [[01_Architecture/Integration_Map|Integration Map]] — integration seams for external systems and adapter packages.

## Related Decisions

<!-- AGENT-START:phase-related-decisions -->
- None yet.
<!-- AGENT-END:phase-related-decisions -->
- [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127 fred-baml uses provider-style library integration instead of CLI plugin runtime wiring]] — relevant precedent: core-adjacent provider-style package API over CLI-plugin-first runtime wiring.

## Related Bugs

<!-- AGENT-START:phase-related-bugs -->
- None yet.
<!-- AGENT-END:phase-related-bugs -->

## Steps

<!-- AGENT-START:phase-steps -->
- [x] [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_01_plan-convex-adapter-package-boundary-and-api|STEP-56-01 Plan Convex adapter package boundary and API]]
- [x] [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_02_scaffold-fred-convex-adapter-package|STEP-56-02 Scaffold Fred Convex adapter package]]
- [x] [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_03_implement-convex-client-and-tool-adapter-helpers|STEP-56-03 Implement Convex client and tool adapter helpers]]
- [x] [[02_Phases/Phase_56_build_fred_convex_adapter_package/Steps/Step_04_validate-convex-adapter-package-for-sibling-file-dependency-consumption|STEP-56-04 Validate Convex adapter package for sibling file-dependency consumption]]
<!-- AGENT-END:phase-steps -->

## Notes

- Add architecture, bug, and decision links as the milestone becomes more concrete.
- Use the `Steps/` directory for the first executable units instead of expanding this note too far.
- Scope boundary clarified by user on 2026-06-02: Convex adapter work is separate from HTTP-layer consumption work. Keep Convex planning/implementation in PHASE-56 only.
