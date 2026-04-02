## 44-05 Verification Snapshot

- Safety tag: `pre-phase-44-deletion` created before first deletion
- Deleted files check: all 8 targeted imperative files are absent
- RMVL-08 exact grep in `packages/**/*.ts`: `0` matches for `new (ToolRegistry|AgentManager|PipelineManager|ContextManager|HookManager|ProviderRegistry)(`
- RMVL-08 production-only grep (excluding `*.test.ts`): `0` matches

## Test Files Referencing Deleted Imperative Files

- `tests/unit/core/hooks/manager.test.ts`
- `tests/unit/core/tool/registry.test.ts`
- `tests/unit/core/tool-gate/mcp-gating.test.ts`
- `tests/unit/core/context/session.test.ts`
- `tests/unit/core/agent/factory.test.ts`
- `tests/unit/core/context/manager.test.ts`
- `tests/unit/core/agent/mcp-factory.test.ts`
- `tests/unit/core/routing/hooks.test.ts`
- `tests/unit/core/pipeline/manager-graph.test.ts`
- `tests/unit/core/agent/retry.test.ts`
- `tests/unit/core/pipeline/executor.test.ts`
- `tests/unit/core/routing/router.test.ts`
- `tests/unit/core/agent/manager.test.ts`
- `tests/unit/core/pipeline/manager.test.ts`
- `tests/unit/core/workflow/manager.test.ts`
- `tests/unit/core/agent/factory-streaming.test.ts`
- `tests/unit/cli/session-commands.test.ts`
- `tests/unit/core/observability/pipeline-tracing.test.ts`
- `packages/core/src/pipeline/graph-executor.test.ts`

These files are expected follow-up cleanup targets after manager deletion.
