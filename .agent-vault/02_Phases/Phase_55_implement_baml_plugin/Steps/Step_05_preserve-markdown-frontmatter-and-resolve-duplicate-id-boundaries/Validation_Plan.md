# Validation Plan

## Commands

- `bun test tests/unit/core/config/agent-file-integration.test.ts` if core config behavior is touched.
- `bun test packages/fred-baml` for namespace/duplicate tests.
- `bun test tests/unit/core/agent/file-loader.test.ts` if markdown parsing is touched.

## Test Cases

- Existing duplicate `.md` vs config agent test still passes unchanged.
- BAML tool ID conflicts fail before registration or through ToolRegistryService.
- Markdown agent with BAML tool ID remains parseable and loadable.
- Generated client in a non-agent directory is ignored by agent file discovery.

## Pass Criteria

No existing markdown/frontmatter behavior changes unless a test and decision explicitly justify it.

## Related Notes

- Phase: [[02_Phases/Phase_55_implement_baml_plugin/Phase|PHASE-55 Implement BAML plugin]]
- Step: [[02_Phases/Phase_55_implement_baml_plugin/Steps/Step_05_preserve-markdown-frontmatter-and-resolve-duplicate-id-boundaries|05]]
