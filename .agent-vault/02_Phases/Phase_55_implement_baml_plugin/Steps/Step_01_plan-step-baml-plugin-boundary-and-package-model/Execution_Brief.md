# Execution Brief

## Exact Outcome

Produce the implementation boundary record for `fred-baml`: it is a provider-style/core-adjacent library package with explicit helper exports and no dependency on the CLI plugin subsystem for runtime behavior.

## Why This Matters

Every later step depends on this boundary. If this step is ambiguous, implementers may wire BAML through `packages/cli/src/plugin/*`, mutate markdown discovery, or hide generation at runtime.

## Prerequisites

- Read PHASE-55 and [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Confirm provider package pattern in `packages/provider-openai/src/index.ts`.
- Confirm CLI plugin limits by inspecting `packages/cli/src/plugin/*` only as rejected prior art.

## Starting Files and Directories

- `packages/provider-openai/package.json` and `packages/provider-openai/src/index.ts` - package/export/registration model.
- `packages/core/src/index.ts` - public Fred facade and acceptable Promise boundary.
- `packages/core/src/config/initializer.ts` - current config initialization path; note it does not consume CLI plugin runtime options.
- `packages/cli/src/plugin/` - command/plugin subsystem; use only to document why it is not the primary seam.
- `package.json` - workspace package naming/build conventions.

## Execution Checklist

1. Write a short architecture note or step outcome explaining accepted boundary and rejected alternatives.
2. Identify public helpers expected from `fred-baml`: `createBamlTool`, `BamlAgent`, `initFredBamlRuntime`, and test/eval helpers.
3. Define source-system ownership: markdown files create Fred agents; BAML functions create typed callable functions/tools unless an explicit wrapper creates a Fred agent facade.
4. Confirm later steps inherit this boundary.
5. Record any new durable decision instead of leaving it in chat.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Edge Cases and Recovery

- If an implementer finds a core runtime plugin hook already exists, document it and reassess; do not silently switch to CLI plugin loading.
- If BAML requires a runtime server, keep it behind explicit helper APIs and do not make it a default requirement.

## Junior Readiness Verdict

Ready after reading the files above; no coding should happen in this step beyond documentation/decision artifacts.
