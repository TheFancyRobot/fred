# Validation Plan

## Commands

- `bun test packages/fred-baml` or chosen unit test path.
- `bunx tsc --noEmit` for exported type checks.
- `bun test tests/unit/core/tool/service.test.ts` if core tool semantics are touched.

## Test Cases

- `createBamlTool` happy path calls mocked `b.func.Example` and returns structured output.
- Missing/throwing BAML function maps to typed Fred/BAML error.
- Duplicate tool IDs are rejected by existing ToolRegistryService.
- Explicit Effect Schema metadata validates through Fred tool validation.
- Markdown agent can list the BAML tool ID without changing markdown parser behavior.

## Pass Criteria

A BAML function can be registered as a Fred tool and executed deterministically in tests without live provider calls.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_04_implement-baml-client-adapter-agent-tool-mapping-and-typing|04]]
