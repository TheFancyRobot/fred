# Execution Brief

## Exact Outcome

Ship copy-pasteable documentation, at least one minimal example or example update, and a final release-readiness checklist for `@fancyrobot/fred-baml`.

## Why This Matters

The integration is only useful if users can set up BAML generation, register BAML-backed tools, keep markdown agents, and run validation without hidden knowledge.

## Prerequisites

- STEPs 02-07 complete and validated.
- Public API names and generation policy finalized.

## Starting Files and Directories

- `packages/fred-baml/README.md` - package-specific setup and API docs.
- `examples/README.md` - add learning-path entry only if creating a new example.
- New possible example: `examples/14-baml-integration/` following examples guard structure (`package.json`, `README.md`, `.env.example`, `tsconfig.json`, `src/`).
- `tests/unit/examples/examples-guard.test.ts` - update `EXPECTED_EXAMPLES` if adding a new numbered example.
- `packages/core/README.md` or root docs only if cross-linking is needed.

## Documentation Must Include

- Install commands for `@fancyrobot/fred-baml` and BAML dependencies.
- Project layout showing `baml_src/`, generated `baml_client/`, and markdown `src/agents/*.md` coexisting.
- Generation/check commands and stale-client recovery steps.
- Minimal code using `createBamlTool` and a markdown agent listing the resulting tool ID.
- Streaming support matrix and limitations.
- Testing guidance: deterministic Fred tests vs opt-in `baml test`/live provider checks.
- Version compatibility caveats for `@boundaryml/baml`.

## Final Release Checklist

- Package builds/imports.
- Unit and integration tests pass.
- Example guard passes if examples changed.
- No generated BAML files committed outside approved fixture/example paths.
- README states markdown/frontmatter remains first-class.
- Changeset/release notes mention new package and setup requirements.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Edge Cases and Recovery

- If a new example would expand examples guard significantly, document minimal package README examples first and add full example only when tests can remain deterministic.
- If generated client artifacts are committed in examples, explain why and how to refresh them.

## Junior Readiness Verdict

Ready after previous steps complete; all docs/examples outputs and release checks are listed.
