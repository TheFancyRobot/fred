# Execution Brief

## Exact Outcome

Protect existing markdown/frontmatter workflows while adding clear namespace and duplicate-ID behavior for BAML-backed tools and optional BAML agent wrappers.

## Why This Matters

Current users rely on markdown agent loading, ETA templates, hot reload, and duplicate-ID guards. BAML must not silently override or shadow those behaviors.

## Prerequisites

- STEP-55-04 adapter API exists or is specified.
- Read `ConfigInitializer` duplicate-ID behavior and markdown parser/watcher files.

## Starting Files and Directories

- `packages/core/src/config/initializer.ts` - file agents load before config agents and duplicate IDs hard-fail.
- `packages/core/src/agent/file-loader.ts` - YAML frontmatter parser/validator.
- `packages/core/src/agent/file-watcher.ts` - `.md`/partials hot reload behavior.
- `packages/core/src/config/loader.ts` - `validateNoAmbiguousPromptFiles`.
- `tests/unit/core/config/agent-file-integration.test.ts` - duplicate ID and file loading regression tests.
- `packages/fred-baml/src/tools.ts` / `src/agent.ts` - namespace policy implementation.

## Boundary Rules To Implement

- BAML function names become tool IDs by explicit mapping; they do not become Fred agent IDs automatically.
- Markdown/frontmatter agent IDs remain owned by existing core config initialization.
- Optional `BamlAgent` helper must require an explicit agent ID and should fail if caller attempts to register an already-used ID.
- Generated `baml_client/` files must not be placed under `src/agents`, `agents`, or template partial directories.
- Config examples should show markdown agent frontmatter listing BAML tool IDs normally.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Edge Cases and Recovery

- If a user has markdown agent `receipt-agent` and BAML function `ReceiptAgent`, allow it only if the BAML function is a tool ID such as `baml:ReceiptAgent`; do not infer an agent.
- If duplicate BAML functions normalize to the same tool ID, fail during tool creation with both original names in the error.

## Junior Readiness Verdict

Ready: existing core files and exact duplicate behaviors are named; BAML namespace rules are explicit.
