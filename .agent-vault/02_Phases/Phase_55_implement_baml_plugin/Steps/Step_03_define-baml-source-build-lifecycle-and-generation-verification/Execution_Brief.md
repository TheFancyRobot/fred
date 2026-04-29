# Execution Brief

## Exact Outcome

Define and implement deterministic lifecycle support for user-authored `baml_src/` and generated `baml_client/` artifacts, including commands that fail loudly when generated output is missing or stale.

## Why This Matters

BAML is codegen-driven. Without explicit generation policy, `fred-baml` can fail at startup, drift from source schemas, or produce non-reproducible CI behavior.

## Prerequisites

- STEP-55-02 package scaffold exists.
- Read BAML TypeScript docs for `baml_src/`, `generators.baml`, `baml_client/`, `b.func.*`, and `b.stream.*`.

## Starting Files and Directories

- `packages/fred-baml/package.json` - add scripts such as `baml:generate`, `baml:check`, or package-specific fixture generation.
- `packages/fred-baml/src/runtime.ts` - helper for locating/importing generated clients.
- Planned fixture path: `packages/fred-baml/tests/fixtures/basic-baml/` with `baml_src/` and controlled generated output.
- Root `package.json` - avoid global scripts until package-local behavior is proven.

## Default Policy To Implement Unless Superseded

- Do not generate inside `node_modules`.
- Do not auto-run `baml generate` during every Fred message or tool call.
- For package tests, use a small fixture and either check in generated fixture output or regenerate during a dedicated test setup command with deterministic verification.
- For user projects, expose commands/docs so users run generation in their project before runtime import.
- Missing/stale generated client should throw a typed `BamlClientNotGeneratedError` or equivalent with the exact command to run.

## Execution Checklist

1. Verify exact BAML CLI command under Bun (`bunx baml-cli generate`, `bun x baml-cli generate`, or documented equivalent).
2. Define path config for `baml_src` and generated client root.
3. Add a stale-check strategy: manifest/hash file, generated timestamp/hash comparison, or command that regenerates and checks clean diff.
4. Document whether sync client support is included or async-only initially.
5. Document server mode as deferred unless direct client mode cannot satisfy runtime needs.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Edge Cases and Recovery

- If BAML CLI is unavailable in CI, mark tests that require it separately and keep adapter unit tests using mocked generated clients.
- If generated client paths differ by BAML version, pin/guard the supported version range and produce actionable errors.

## Junior Readiness Verdict

Ready: the default policy avoids hidden runtime generation and names concrete files/scripts to implement.
