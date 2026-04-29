# Execution Brief

## Exact Outcome

Build the package-level and integration validation matrix for `fred-baml`, covering generation lifecycle, adapter behavior, markdown coexistence, streaming, Bun compatibility, and docs/examples claims.

## Why This Matters

`fred-baml` spans codegen, provider credentials, generated types, Fred tool registration, and optional live LLM tests. A clear matrix prevents brittle or secretly-live tests.

## Prerequisites

- STEPs 03, 04, and 06 complete enough to expose generation and adapter APIs.
- Understand examples guard and core tests listed below.

## Starting Files and Directories

- `packages/fred-baml/tests/` or selected test directory.
- `tests/unit/examples/examples-guard.test.ts` - public examples constraints.
- `tests/unit/core/config/agent-file-integration.test.ts` - markdown coexistence guard.
- `packages/core/src/stream/events.ts` - streaming event contract.
- `packages/cli/tests/plugin/phase32-plugin-smoke.test.ts` - CLI plugin smoke only if a CLI convenience layer is later added.
- BAML fixture directory from STEP-55-03.

## Required Test Groups

1. Unit/mocked generated client tests: `createBamlTool`, errors, schema metadata, duplicate tool IDs.
2. Generation fixture tests: missing/stale/generated client detection.
3. Markdown coexistence tests: markdown agent using BAML tool ID, no generated files in watched agent dirs.
4. Streaming tests: supported/unsupported behavior and error mapping.
5. Compatibility smoke: package import, Bun execution, examples guard if examples changed.
6. Optional live BAML tests: separate command/env flag only; never part of deterministic unit suite.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Security and Performance Notes

- Provider API keys must not be required for deterministic unit tests.
- Live tests must use env-gated commands and clear cost warnings.
- Generation checks should be fast and fixture-scoped; do not regenerate large user projects in unit tests.

## Junior Readiness Verdict

Ready: test groups, files, and live-vs-deterministic boundary are explicit.
