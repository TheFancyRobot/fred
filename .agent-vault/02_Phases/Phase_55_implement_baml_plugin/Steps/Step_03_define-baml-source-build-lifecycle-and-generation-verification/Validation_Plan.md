# Validation Plan

## Commands

- `bunx baml-cli --version` or the chosen Bun-compatible BAML CLI version check.
- Package-local generation command, for example `bun run --filter './packages/fred-baml' baml:generate`.
- Stale check command, for example `bun run --filter './packages/fred-baml' baml:check`.
- `bun test packages/fred-baml` after fixture tests exist.

## Test Cases

- Generated client present and matches fixture source.
- Generated client missing produces typed actionable error.
- Generated client stale produces failure before runtime tool execution.
- Unsupported BAML version produces compatibility diagnostic.

## Pass Criteria

A developer can clone the repo, run documented commands, and know exactly how BAML codegen is produced and verified.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_03_define-baml-source-build-lifecycle-and-generation-verification|03]]
