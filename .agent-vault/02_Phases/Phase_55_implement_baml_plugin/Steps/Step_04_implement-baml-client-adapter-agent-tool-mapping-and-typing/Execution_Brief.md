# Execution Brief

## Exact Outcome

Implement the initial runtime adapter that converts generated BAML functions into Fred `Tool` objects and exposes agent helper APIs without changing core markdown discovery.

## Why This Matters

This is the main integration layer. It determines type-safety, error semantics, naming, and how markdown-authored agents can call BAML-backed functions as tools.

## Prerequisites

- STEP-55-03 generation policy and fixture shape exist.
- Understand `Tool` in `packages/core/src/tool/tool.ts` and registration conflict behavior in `packages/core/src/tool/service.ts`.

## Starting Files and Directories

- `packages/fred-baml/src/tools.ts` - implement `createBamlTool`.
- `packages/fred-baml/src/agent.ts` - implement `BamlAgent`/agent factory helper if in scope.
- `packages/fred-baml/src/runtime.ts` - generated client boundary/loading types.
- `packages/fred-baml/src/errors.ts` - typed errors for missing function/client/schema mismatch.
- `packages/core/src/tool/tool.ts` - target Tool interface.
- `packages/core/src/agent/agent.ts` - target AgentConfig/AgentInstance patterns.

## Implementation Constraints

- `createBamlTool` should accept an explicit generated function reference and metadata; do not depend on fragile introspection unless BAML exposes stable metadata.
- Use deterministic tool IDs, preferably caller-provided or `baml.<functionName>` via the adapter helper; reject duplicates through existing Fred tool registration.
- Prefer Effect Schema for `schema.input`/`schema.success`; if automatic schema conversion is not possible, require explicit schemas from the caller in the first slice.
- Wrap Promise-returning generated client calls in Effect at adapter boundaries or return Promise from `Tool.execute` only where Fred already accepts it.
- Preserve structured outputs; do not stringify JSON unless the selected Fred API requires string output.

## Execution Checklist

1. Define exported TypeScript types for BAML function references.
2. Implement `createBamlTool({ id, name, description, inputSchema, outputSchema, invoke })` or equivalent named options.
3. Add typed errors for missing function, invalid schema, invocation failure, and unsupported streaming.
4. Add unit tests using mocked BAML function references before using live/generated clients.
5. Document how a markdown agent references the registered BAML tool by ID.

## Phase-Wide Constraints

- Treat `fred-baml` as a core-adjacent extension/library package, not a CLI-plugin-first integration. See [[04_Decisions/DEC-0127_fred-baml-uses-provider-style-library-integration-instead-of-cli-plugin-runtime-wiring|DEC-0127]].
- Keep markdown/frontmatter agent discovery unchanged: `src/agents/*.md` remains the default teaching path and `agents/` remains a compatibility fallback.
- Do not place generated BAML client files under watched agent directories.
- Prefer Effect Schema for Fred tool schemas and keep Effect logic inside services/helpers rather than adding unapproved `Effect.runPromise` boundaries.
- Make failures explicit: missing BAML client, stale generated output, duplicate tool IDs, unsupported streaming, and missing provider secrets must produce actionable diagnostics.

## Edge Cases and Recovery

- If BAML generated types cannot be converted to Effect Schema automatically, keep explicit schema input mandatory and document follow-up automation.
- If function names contain characters invalid for Fred tool IDs, normalize names and preserve original BAML function name in metadata.

## Junior Readiness Verdict

Ready with one important constraint: do not attempt automatic BAML schema introspection unless official APIs prove stable.
