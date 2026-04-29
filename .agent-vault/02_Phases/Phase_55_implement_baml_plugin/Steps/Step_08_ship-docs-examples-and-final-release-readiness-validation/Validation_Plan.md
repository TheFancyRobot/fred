# Validation Plan

## Commands

- `bun run build`.
- `bun test`.
- `bunx tsc --noEmit`.
- `bun test tests/unit/examples/examples-guard.test.ts` if examples changed.
- Package-specific BAML generation/check command documented by STEP-55-03.

## Manual Checks

- README commands work from a clean checkout.
- `.env.example` contains provider/BAML env names but no secrets.
- Docs do not imply BAML replaces markdown/frontmatter.
- Release checklist mentions rollback/recovery for broken generation or unsupported BAML versions.

## Pass Criteria

A new Fred user can copy the example, generate the BAML client, register a BAML-backed tool, and run deterministic validation without reading implementation source.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_08_ship-docs-examples-and-final-release-readiness-validation|08]]
