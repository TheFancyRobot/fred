# Roadmap: Fred

## Overview

Roadmap is milestone-scoped; shipped milestones are archived under `.planning/milestones/`.

**Current Milestone:** v0.3.0 Imperative-to-Effect Migration
**Last Shipped:** v0.2.2 TUI Visual Polish (2026-02-22)

---

## Milestones

- ✅ **v0.2.0 Effect Migration + Monorepo** — Phases 1-21.1 (shipped 2026-02-01, archive: `.planning/milestones/v0.2.0-ROADMAP.md`)
- ✅ **v0.2.0 Observability & Safety** — Phases 22-26 (shipped 2026-02-07, archive: `.planning/milestones/v0.2.0-ROADMAP.md`)
- ✅ **v0.2.1 CLI/TUI Developer Experience** — Phases 27-36 (shipped 2026-02-16, archive: `.planning/milestones/v0.2.1-ROADMAP.md`)
- ✅ **v0.2.2 TUI Visual Polish** — Phases 37-40 (shipped 2026-02-22, archive: `.planning/milestones/v0.2.2-ROADMAP.md`)
- 🔄 **v0.3.0 Imperative-to-Effect Migration** — Phases 41-45

---

## Active Milestone: v0.3.0 Imperative-to-Effect Migration

**Milestone Goal:** Eliminate the dual imperative/Effect API surface by making Effect services the primary (and only) implementations, removing ~3,000-4,000 lines of duplicated wrapper code. This is a BREAKING CHANGE milestone — no backward-compatible shims.

**Strategy:** Bottom-up migration. Start with leaf services that have no cross-service dependencies, then complete pipeline stubs, rewire the Fred class facade, delete imperative classes, and finally migrate consumers and publish the clean API surface.

### Phase 41: Leaf Service Independence
**Goal**: Six Effect services with simple dependency graphs become fully standalone implementations that no longer delegate to their imperative counterparts
**Depends on**: Nothing (first phase of v0.3.0)
**Requirements**: EFCT-01, EFCT-02, EFCT-04, EFCT-05, EFCT-06, EFCT-08, EFCT-09
**Plans**: 5 plans
**Success Criteria** (what must be TRUE):
  1. ToolRegistryService manages its own tool map internally — no `ToolRegistry` import or delegation
  2. AgentService manages agent registration, lookup, and creation without importing `AgentManager`
  3. ContextStorageService, HookManagerService, and ProviderRegistryService each operate with zero references to their imperative counterparts
  4. MessageRouterService and IntentMatcherService/IntentRouterService route messages using their own Effect-native logic
  5. All existing tests that exercise these services still pass (services are drop-in replacements functionally)

Plans:
- [x] 41-01-PLAN.md — Harden ToolRegistryService and ProviderRegistryService standalone contracts
- [x] 41-02-PLAN.md — Normalize ContextStorageService and HookManagerService typed behavior
- [x] 41-03-PLAN.md — Remove AgentService runtime/delegation seams and lock lifecycle contracts
- [x] 41-04-PLAN.md — Rewrite IntentMatcherService and IntentRouterService as standalone Effect services
- [x] 41-05-PLAN.md — Implement standalone MessageRouterService and finalize layer wiring/integration checks

### Phase 42: Pipeline & MessageProcessor Completion
**Goal**: The two most complex services — PipelineService and MessageProcessorService — become fully standalone with all stub methods replaced by working implementations
**Depends on**: Phase 41 (pipeline and processor depend on leaf services)
**Requirements**: EFCT-03, EFCT-07, PIPE-01, PIPE-02, PIPE-03
**Success Criteria** (what must be TRUE):
  1. `PipelineService.executeV2Pipeline` executes V2 pipelines to completion through Effect (no `Effect.fail("not yet migrated")` stub)
  2. `PipelineService.resume` and `PipelineService.resumeWithHumanInput` restore checkpoint state and continue execution through Effect
  3. PipelineService has zero imports from `pipeline/manager.ts` — all 1,062 lines of PipelineManager orchestration logic are ported
  4. MessageProcessorService processes and streams messages without delegating to imperative `MessageProcessor` methods
  5. Pipeline and message processing tests pass against the standalone services

### Phase 43: Fred Class Migration
**Goal**: The Fred class facade constructs and delegates to the Effect runtime instead of imperative manager instances, becoming a thin Effect-backed API surface
**Depends on**: Phase 42 (Fred delegates to all services; they must be standalone first)
**Requirements**: FRED-01, FRED-02, FRED-03, FRED-04, FRED-05, FRED-06, FRED-07, FRED-08, FRED-09
**Success Criteria** (what must be TRUE):
  1. Fred constructor builds an Effect runtime with composed service Layers instead of instantiating imperative classes
  2. `fred.processMessage()` and `fred.streamMessage()` delegate to MessageProcessorService via `Effect.runPromise` at the boundary
  3. `fred.routeMessage()`, `fred.executePipeline()`, `fred.registerAgent()`, `fred.registerTool()`, and `fred.setToolPolicies()` all delegate to their respective Effect services
  4. Fred class source has zero imports of ToolRegistry, AgentManager, PipelineManager, ContextManager, HookManager, ProviderRegistry, or MessageRouter
  5. All existing integration and smoke tests that use the Fred class continue to pass

### Phase 44: Imperative Layer Removal & Consumer Migration
**Goal**: All imperative manager classes are deleted from the codebase and all consumers (dev-chat, CLI) are migrated to the Effect-based API
**Depends on**: Phase 43 (Fred and all services must be Effect-only before deletion is safe)
**Requirements**: RMVL-01, RMVL-02, RMVL-03, RMVL-04, RMVL-05, RMVL-06, RMVL-07, RMVL-08, CONS-01, CONS-02, CONS-03, CONS-04
**Success Criteria** (what must be TRUE):
  1. Files `tool/registry.ts`, `agent/manager.ts`, `pipeline/manager.ts`, `context/manager.ts`, `hooks/manager.ts`, and `platform/registry.ts` are deleted from the repository
  2. `message-processor/processor.ts` has no remaining Promise-wrapper methods (`processMessage`, `routeMessage`, `streamMessage` imperative variants removed)
  3. `grep -r "new ToolRegistry\|new AgentManager\|new PipelineManager\|new ContextManager\|new HookManager\|new ProviderRegistry" packages/` returns zero matches
  4. `dev-chat.ts`, `chat.ts`, and `run.ts` interact with Fred via Effect-based API — no direct imperative manager access
  5. `Effect.runPromise` / `Effect.runFork` calls appear only at application boundaries (entry points), not scattered through business logic

### Phase 45: Public API Surface & Verification
**Goal**: The public API exports only Effect services, the Layer composition is complete, breaking changes are documented, and the full test suite passes cleanly
**Depends on**: Phase 44 (all imperative code removed; consumers migrated)
**Requirements**: API-01, API-02, API-03, API-04, TEST-01, TEST-02, TEST-03, TEST-04
**Success Criteria** (what must be TRUE):
  1. `exports.ts` no longer exports ToolRegistry, AgentManager, ContextManager, HookManager, or MessageRouter — only Effect service tags
  2. `services.ts` provides a single composable Layer that wires all services for consumer dependency injection
  3. `bun run build` succeeds with zero TypeScript errors introduced by the migration
  4. `bun test` passes with no regressions — all unit tests updated to use Effect services where needed
  5. CHANGELOG documents the breaking changes: removed imperative classes, new Effect-only API surface, migration guidance
  6. Pre-existing LSP errors (Effect yield errors in index.ts, tracing import errors, config/initializer reference) are resolved or explicitly documented

---

## Phase Dependencies

```
Phase 41 (Leaf Services)
    ↓
Phase 42 (Pipeline & MessageProcessor)
    ↓
Phase 43 (Fred Class)
    ↓
Phase 44 (Deletion & Consumers)
    ↓
Phase 45 (API & Verification)
```

All phases are sequential. Each phase leaves the codebase in a buildable, testable state because the imperative classes remain available as fallbacks until Phase 44 removes them.

---

## Requirement Coverage

| Requirement | Phase | Notes |
|-------------|-------|-------|
| EFCT-01 | 41 | ToolRegistryService standalone |
| EFCT-02 | 41 | AgentService standalone |
| EFCT-03 | 42 | PipelineService standalone (complex, depends on leaf services) |
| EFCT-04 | 41 | ContextStorageService standalone |
| EFCT-05 | 41 | HookManagerService standalone |
| EFCT-06 | 41 | ProviderRegistryService standalone |
| EFCT-07 | 42 | MessageProcessorService standalone (depends on routing + agents) |
| EFCT-08 | 41 | MessageRouterService standalone |
| EFCT-09 | 41 | IntentMatcherService + IntentRouterService standalone |
| PIPE-01 | 42 | executeV2Pipeline stub → working implementation |
| PIPE-02 | 42 | resume stub → working implementation |
| PIPE-03 | 42 | resumeWithHumanInput stub → working implementation |
| FRED-01 | 43 | Fred constructs Effect runtime |
| FRED-02 | 43 | processMessage → Effect |
| FRED-03 | 43 | streamMessage → Effect |
| FRED-04 | 43 | routeMessage → Effect |
| FRED-05 | 43 | executePipeline → Effect |
| FRED-06 | 43 | registerAgent → Effect |
| FRED-07 | 43 | registerTool → Effect |
| FRED-08 | 43 | setToolPolicies → Effect (complete partial work) |
| FRED-09 | 43 | Fred imports no imperative managers |
| RMVL-01 | 44 | Delete tool/registry.ts |
| RMVL-02 | 44 | Delete agent/manager.ts |
| RMVL-03 | 44 | Delete pipeline/manager.ts |
| RMVL-04 | 44 | Delete context/manager.ts |
| RMVL-05 | 44 | Delete hooks/manager.ts |
| RMVL-06 | 44 | Delete platform/registry.ts |
| RMVL-07 | 44 | Remove Promise wrappers from processor.ts |
| RMVL-08 | 44 | No `new XxxManager()` calls remain |
| CONS-01 | 44 | dev-chat.ts uses Effect API |
| CONS-02 | 44 | CLI chat.ts uses Effect API |
| CONS-03 | 44 | CLI run.ts uses Effect API |
| CONS-04 | 44 | Effect.runPromise at boundaries only |
| API-01 | 45 | exports.ts removes imperative exports |
| API-02 | 45 | exports.ts exports Effect service tags |
| API-03 | 45 | services.ts Layer provides all services |
| API-04 | 45 | Breaking changes in CHANGELOG |
| TEST-01 | 45 | All unit tests pass |
| TEST-02 | 45 | Build succeeds, zero new TS errors |
| TEST-03 | 45 | bun test passes, no regressions |
| TEST-04 | 45 | Pre-existing LSP errors resolved or documented |

**Coverage:**
- Total requirements: 41
- Mapped: 41
- Unmapped: 0 ✓

---

## Progress

**Execution Order:** 41 → 42 → 43 → 44 → 45

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 41. Leaf Service Independence | 5/5 | Complete | 2026-02-28 |
| 42. Pipeline & MessageProcessor Completion | 0/? | Not started | — |
| 43. Fred Class Migration | 0/? | Not started | — |
| 44. Imperative Layer Removal & Consumer Migration | 0/? | Not started | — |
| 45. Public API Surface & Verification | 0/? | Not started | — |

---

## Previous Milestones

<details>
<summary>v0.2.2 TUI Visual Polish (Phases 37-40) - SHIPPED 2026-02-22</summary>

See `.planning/milestones/v0.2.2-ROADMAP.md` for complete details.

</details>

<details>
<summary>v0.2.1 CLI/TUI Developer Experience (Phases 27-36) - SHIPPED 2026-02-16</summary>

See `.planning/milestones/v0.2.1-ROADMAP.md` for complete details.

</details>

<details>
<summary>v0.2.0 Observability & Safety (Phases 22-26) - SHIPPED 2026-02-07</summary>

See `.planning/milestones/v0.2.0-ROADMAP.md` for complete details.

</details>

<details>
<summary>v0.2.0 Effect Migration + Monorepo (Phases 1-21.1) - SHIPPED 2026-02-01</summary>

See `.planning/milestones/v0.2.0-ROADMAP.md` for complete details.

</details>

---

*Last updated: 2026-02-28 — Phase 41 completed and verified (15/15 must-haves)*
