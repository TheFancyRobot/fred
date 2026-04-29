# Execution Brief

## Exact Outcome

Create the concrete package scaffold for `packages/fred-baml` and define its publishable public API contract without implementing the full adapter yet.

## Why This Matters

The package shape controls imports, peer dependencies, build scripts, test layout, and whether downstream examples can consume `@fancyrobot/fred-baml` consistently.

## Prerequisites

- STEP-55-01 completed and DEC-0127 accepted.
- Know root workspace pattern from `package.json` (`workspaces: ["packages/*", "examples/*"]`).
- Know provider package pattern from `packages/provider-openai`.

## Starting Files and Directories

- `package.json` - add workspace dependency if needed and understand `ci:publish`.
- `packages/provider-openai/package.json` - copy package metadata style, `exports`, `publishConfig`.
- `packages/provider-openai/src/index.ts` - public export/side-effect pattern reference.
- New planned directory: `packages/fred-baml/`.
- Planned tests: `packages/fred-baml/tests/` or `tests/unit/fred-baml/` (choose one and document).

## Expected Package Skeleton

- `packages/fred-baml/package.json` with name `@fancyrobot/fred-baml`, `type: module`, Bun build script, public publish config.
- `src/index.ts` exports package API.
- `src/tools.ts` for `createBamlTool`.
- `src/agent.ts` for `BamlAgent` or agent factory helpers.
- `src/runtime.ts` for generated client loading/initialization helpers.
- `src/testing.ts` for BAML/Fred eval helpers.
- `src/errors.ts` for typed package errors.

## Dependency Contract

- Peer/dev dependencies: `@fancyrobot/fred`, `effect`.
- BAML dependency policy must be explicit: prefer peer dependency on `@boundaryml/baml` and dev dependency for tests/fixtures; document exact version/range chosen in Step 03 if not known here.
- Do not add hard dependency on CLI package unless a later explicit CLI convenience helper is scoped.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Edge Cases and Recovery

- If Bun cannot resolve package source entrypoints for examples, mirror existing provider package `exports` exactly before inventing a new build shape.
- If `@boundaryml/baml` exports require generated local files, keep those imports in runtime helpers, not top-level package initialization.

## Junior Readiness Verdict

Ready: file paths, dependency expectations, and public module boundaries are explicit.
