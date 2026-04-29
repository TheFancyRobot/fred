# Validation Plan

## Commands

- `bun test packages/fred-baml` for streaming adapter tests.
- `bun test tests/unit/cli/phase28-streaming-smoke.test.ts` if shared stream behavior changes.
- `bun test tests/unit/cli/tui-streaming.test.ts` if TUI stream event assumptions are touched.

## Test Cases

- Unsupported BAML streaming fails with typed error.
- Final streamed output becomes a single correct tool result when partial fidelity is unavailable.
- Error during stream emits failure metadata and does not report success.
- Abort/timeout behavior is documented and tested according to actual BAML API support.

## Pass Criteria

The README and tests agree on exactly what streaming mode supports and what it does not support.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_06_add-streaming-and-runtime-contracts-for-baml-tools|06]]
