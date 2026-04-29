# Validation Plan

## Commands

- `bun test packages/fred-baml` or chosen package test suite.
- `bun test tests/unit/core/config/agent-file-integration.test.ts` if coexistence touches core behavior.
- `bun test tests/unit/examples/examples-guard.test.ts` if examples are added/changed.
- `bunx tsc --noEmit`.
- Optional/live only: documented `baml test` command behind required provider env vars.

## Pass Criteria

- Deterministic tests pass without provider API keys.
- Live/eval tests are opt-in and documented.
- Missing/stale generated client, duplicate IDs, and unsupported streaming fail loudly.
- Example guard stays green if public examples are touched.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_07_add-testing-validation-and-compatibility-checks|07]]
