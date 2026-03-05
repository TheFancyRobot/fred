# Requirements: Imperative-to-Effect Migration

**Defined:** 2026-02-21
**Core Value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.

## v0.3.0 Requirements

Requirements for the Imperative-to-Effect migration milestone. Eliminate the dual imperative/Effect API surface by making Effect services the primary (and only) implementations, removing ~3,000-4,000 lines of duplicated wrapper code.

### Effect Service Completeness

- [x] **EFCT-01**: ToolRegistryService is a fully functional standalone service that does not delegate to ToolRegistry
- [x] **EFCT-02**: AgentService is a fully functional standalone service that does not delegate to AgentManager
- [x] **EFCT-03**: PipelineService is a fully functional standalone service that does not delegate to PipelineManager
- [x] **EFCT-04**: ContextStorageService is a fully functional standalone service that does not delegate to ContextManager
- [x] **EFCT-05**: HookManagerService is a fully functional standalone service that does not delegate to HookManager
- [x] **EFCT-06**: ProviderRegistryService is a fully functional standalone service that does not delegate to ProviderRegistry
- [x] **EFCT-07**: MessageProcessorService is a fully functional standalone service that does not delegate to MessageProcessor
- [x] **EFCT-08**: MessageRouterService is a fully functional standalone service that does not delegate to MessageRouter
- [x] **EFCT-09**: IntentMatcherService and IntentRouterService are fully functional standalone services

### Pipeline Stub Completion

- [x] **PIPE-01**: PipelineService.executeV2Pipeline returns working Effect (not `Effect.fail("not yet migrated")`)
- [x] **PIPE-02**: PipelineService.resume returns working Effect (not `Effect.fail("not yet migrated")`)
- [x] **PIPE-03**: PipelineService.resumeWithHumanInput returns working Effect (not `Effect.fail("not yet migrated")`)

### Fred Class Migration

- [x] **FRED-01**: Fred class constructs and manages an Effect runtime instead of imperative class instances
- [x] **FRED-02**: Fred.processMessage delegates to Effect MessageProcessorService via runtime
- [x] **FRED-03**: Fred.streamMessage delegates to Effect MessageProcessorService via runtime
- [x] **FRED-04**: Fred.routeMessage delegates to Effect routing services via runtime
- [x] **FRED-05**: Fred.executePipeline delegates to Effect PipelineService via runtime
- [x] **FRED-06**: Fred.registerAgent delegates to Effect AgentService via runtime
- [x] **FRED-07**: Fred.registerTool delegates to Effect ToolRegistryService via runtime
- [x] **FRED-08**: Fred.setToolPolicies delegates to Effect services (already partially done)
- [x] **FRED-09**: Fred class no longer imports or instantiates any imperative manager class

### Imperative Class Removal

- [ ] **RMVL-01**: `tool/registry.ts` (ToolRegistry class) is deleted
- [ ] **RMVL-02**: `agent/manager.ts` (AgentManager class) is deleted
- [ ] **RMVL-03**: `pipeline/manager.ts` (PipelineManager class) is deleted
- [ ] **RMVL-04**: `context/manager.ts` (ContextManager class) is deleted
- [ ] **RMVL-05**: `hooks/manager.ts` (HookManager class) is deleted
- [ ] **RMVL-06**: `platform/registry.ts` (ProviderRegistry class) is deleted
- [ ] **RMVL-07**: `message-processor/processor.ts` imperative wrapper methods removed (processMessage, routeMessage, streamMessage Promise wrappers)
- [ ] **RMVL-08**: No remaining `new ToolRegistry()`, `new AgentManager()`, `new PipelineManager()`, `new ContextManager()`, `new HookManager()`, or `new ProviderRegistry()` calls exist in the codebase

### Consumer Migration

- [ ] **CONS-01**: `packages/dev/src/dev-chat.ts` uses Effect-based API (no imperative Fred class methods or direct manager access)
- [ ] **CONS-02**: `packages/cli/src/commands/chat.ts` uses Effect-based API
- [ ] **CONS-03**: `packages/cli/src/commands/run.ts` uses Effect-based API
- [x] **CONS-04**: All consumers use `Effect.runPromise` or `Effect.runFork` at the boundary only (no Effect.runPromise scattered through business logic)

### Public API Surface

- [x] **API-01**: `exports.ts` no longer exports ToolRegistry, AgentManager, ContextManager, HookManager, or MessageRouter imperative classes
- [x] **API-02**: `exports.ts` exports Effect service tags (ToolRegistryService, AgentService, PipelineService, etc.) for consumer dependency injection
- [x] **API-03**: `services.ts` Layer composition provides all services through a single composable Layer
- [x] **API-04**: Breaking changes documented in CHANGELOG (this is a major version bump)

### Build & Test Integrity

- [x] **TEST-01**: All existing unit tests pass after migration (tests updated to use Effect services where needed)
- [x] **TEST-02**: `bun run build` succeeds with zero TypeScript errors introduced by migration
- [x] **TEST-03**: `bun test` passes with no regressions
- [x] **TEST-04**: Pre-existing LSP errors (Effect yield errors in index.ts, tracing import errors, config/initializer reference) are resolved or documented

### Markdown Agent Definition Format (Phase 45.1)

- [x] **MDAGENT-01**: Parse `.md` files with YAML frontmatter (`id`, `platform`, `model`) into valid `AgentConfig` objects
- [x] **MDAGENT-02**: Discover agent `.md` files recursively from configured `agentDirs`
- [x] **MDAGENT-03**: Load markdown-defined agents during `ConfigInitializer` startup before config-defined agents
- [x] **MDAGENT-04**: Enforce coexistence validation across sources (duplicate IDs and ambiguous frontmatter prompt references)
- [x] **MDAGENT-05**: Provide hot reload for markdown agent files with debounced change handling
- [x] **MDAGENT-06**: Extend `FrameworkConfig` with `agentDirs?: string[]`

## Future Requirements

Deferred beyond v0.3.0. Tracked but not in current roadmap.

### Effect Advanced

- **EFCT-10**: Effect-native streaming with Stream combinators replacing callback-based streaming
- **EFCT-11**: Effect Scope-based resource management for provider connections and MCP clients
- **EFCT-12**: Effect Schedule-based retry policies for transient provider failures
- **EFCT-13**: Full Effect-native test harness replacing Promise-based test mocks

### API Ergonomics

- **ERGO-01**: Convenience `fred()` factory function that builds and provides all Layers
- **ERGO-02**: Effect-native config loader using Effect Config module
- **ERGO-03**: Type-safe pipeline builder API using Effect's pipe/flow combinators

## Out of Scope

Explicitly excluded for this milestone. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Promise-based backward compatibility shim | This is a breaking change milestone; no compatibility layer |
| New features or capabilities | Migration only; feature parity is the goal |
| Provider pack API changes | Provider packs already use Effect; no changes needed |
| Eval framework migration | Eval system is independent; defer to future milestone |
| MCP client refactoring | MCP integration works; defer structural changes |
| Streaming architecture overhaul | Keep existing streaming patterns; defer to EFCT-10 |
| New CLI commands | CLI commands are migrated, not added |
| TUI visual changes | TUI is visual-complete from v0.2.2 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EFCT-01 | Phase 41 | Complete |
| EFCT-02 | Phase 41 | Complete |
| EFCT-03 | Phase 42 | Complete |
| EFCT-04 | Phase 41 | Complete |
| EFCT-05 | Phase 41 | Complete |
| EFCT-06 | Phase 41 | Complete |
| EFCT-07 | Phase 42 | Complete |
| EFCT-08 | Phase 41 | Complete |
| EFCT-09 | Phase 41 | Complete |
| PIPE-01 | Phase 42 | Complete |
| PIPE-02 | Phase 42 | Complete |
| PIPE-03 | Phase 42 | Complete |
| FRED-01 | Phase 43 | Complete |
| FRED-02 | Phase 43 | Complete |
| FRED-03 | Phase 43 | Complete |
| FRED-04 | Phase 43 | Complete |
| FRED-05 | Phase 43 | Complete |
| FRED-06 | Phase 43 | Complete |
| FRED-07 | Phase 43 | Complete |
| FRED-08 | Phase 43 | Complete |
| FRED-09 | Phase 43 | Complete |
| RMVL-01 | Phase 44 | Pending |
| RMVL-02 | Phase 44 | Pending |
| RMVL-03 | Phase 44 | Pending |
| RMVL-04 | Phase 44 | Pending |
| RMVL-05 | Phase 44 | Pending |
| RMVL-06 | Phase 44 | Pending |
| RMVL-07 | Phase 44 | Pending |
| RMVL-08 | Phase 44 | Pending |
| CONS-01 | Phase 44 | Pending |
| CONS-02 | Phase 44 | Pending |
| CONS-03 | Phase 44 | Pending |
| CONS-04 | Phase 48, 49 | Complete |
| API-01 | Phase 45 | Complete |
| API-02 | Phase 45 | Complete |
| API-03 | Phase 45 | Complete |
| API-04 | Phase 45 | Complete |
| TEST-01 | Phase 45 | Complete |
| TEST-02 | Phase 45 | Complete |
| TEST-03 | Phase 45 | Complete |
| TEST-04 | Phase 45 | Complete |
| MDAGENT-01 | Phase 45.1 | Complete |
| MDAGENT-02 | Phase 45.1 | Complete |
| MDAGENT-03 | Phase 45.1 | Complete |
| MDAGENT-04 | Phase 45.1 | Complete |
| MDAGENT-05 | Phase 45.1 | Complete |
| MDAGENT-06 | Phase 45.1 | Complete |

**Coverage:**
- v0.3.0 requirements: 47 total
- Mapped to phases: 47
- Unmapped: 0 ✓

---
*Requirements defined: 2026-02-21*
*Last updated: 2026-03-01 after Phase 45.1 completion and verification*
