---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: milestone
status: unknown
last_updated: "2026-03-01T22:57:09Z"
progress:
  total_phases: 53
  completed_phases: 47
  total_plans: 208
  completed_plans: 208
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** v0.3.0 Imperative-to-Effect Migration
**Last shipped:** v0.2.2 TUI Visual Polish (2026-02-22)

## Current Position

Phase: 45.2 of 46 (Implement ETA for Templating Agent Prompts and Frontmatter)
Plan: 0 of 0 in current phase (NOT PLANNED)
Status: Ready for planning
Last activity: 2026-03-01 - Phase 45.1 verified passed (23/23 must-haves)

Progress: ████████████████████ 100% (208/208 plans)

## Performance Metrics

**Velocity:**

| Milestone | Plans | Avg Duration | Total Time |
|-----------|-------|-------------|------------|
| v0.2.2 TUI Visual Polish | 13 | ~7.5 min | ~90 min |
| v0.2.1 CLI/TUI Dev Experience | 31 | ~5.32 min | — |
| v0.2.0 Observability & Safety | 32 | ~4.2 min | 2 days |
| v0.2.0 Effect Migration + Monorepo | 86 | ~3.9 min | 13 days |
| v0.3.0 Imperative-to-Effect (Phase 43) | 6 | ~5 min | ~28 min |
| Phase 45 P04 | 4min | 1 tasks | 3 files |
| Phase 45 P05 | 4min | 2 tasks | 2 files |

## Accumulated Context

### Architecture State (post v0.2.2)

- **TUI uses `@opentui/core` v0.1.77** — Yoga-based flexbox layout with `BoxRenderable`, `TextRenderable`, `ScrollBoxRenderable`
- **Centralized theme system** — `packages/cli/src/tui/theme.ts` exports `TuiTheme` interface and `DEFAULT_TUI_THEME` with semantic fg/bg/accent/status tokens
- **Borderless contrast layout** — regions separated by backgroundColor contrast (base → surface → elevated) with padding/gap spacing
- **Collapsible sidebar** — `packages/cli/src/tui/sidebar.ts` with Ctrl+B toggle and `/sidebar` command
- **Badge-based status bar** — stateless `buildStatusBadges()` pipeline with priority truncation
- **Help modal + floating overlays** — absolute-positioned with zIndex layering, badge dimming during overlays

### Dual API Architecture (v0.3.0 migration target)

- **8 imperative wrapper classes** delegate from Fred class: ToolRegistry, AgentManager, PipelineManager, ContextManager, HookManager, ProviderRegistry, MessageProcessor, MessageRouter
- **Corresponding Effect services** exist for all 8: ToolRegistryService, AgentService, PipelineService, ContextStorageService, HookManagerService, ProviderRegistryService, MessageProcessorService, MessageRouterService
- **Fred facade** now delegates message/routing/tool/agent/pipeline boundaries through runtime services; compatibility seams remain for next-plan cleanup
- **PipelineService resume methods now implemented** - `resume()` and `resumeWithHumanInput()` are standalone Effect state machines
- **PipelineService graph execution stub remains** - graph methods still return "not yet migrated to Effect fibers"
- **All consumers** (dev-chat, CLI) use 100% imperative API via `fred.processMessage()`, `fred.streamMessage()`, etc.
- **~3,000-4,000 lines of duplication** between imperative classes and Effect services

### Blockers/Concerns

- ~~Phase 45 verification reported two blockers: `exports.ts` is still a mixed barrel (not Effect-service-only) and there is no single type-safe canonical all-services layer~~ (Both resolved: Gap 2 in 45-04, Gap 1 in 45-05)

### Roadmap Evolution

- Phase 46 added: Showcase Examples & Framework Differentiation — replace existing examples with new ones demonstrating Fred's unique capabilities; research competing frameworks for differentiators
- Phase 45.1 inserted after Phase 45: Combine assistant config and prompt into single markdown file with YAML frontmatter (URGENT)
- Phase 45.2 inserted after Phase 45: Implement ETA for templating agent prompts and frontmatter (URGENT)

### Decisions (v0.3.0)

| Phase | Decision | Rationale |
|---|---|---|
| 41-01 | `ToolRegistryService.registerTools` now stages full batch and writes state once | Guarantees atomic behavior with zero partial writes on duplicate/validation failure |
| 41-01 | `ProviderRegistryService.registerDefinition` rejects duplicate IDs and alias collisions | Prevents silent overwrite and enforces conflict-safe mutation contracts |
| 41-01 | Provider conflict paths use typed `ProviderRegistrationError` with readable message text | Keeps Effect-first typed error handling while improving diagnostics |
| 41-02 | Context strict-mode misses now include caller-safe typed `ContextNotFoundError` messages | Keeps explicit not-found contracts while improving downstream diagnostics |
| 41-02 | Context mutation failures map to operation-specific `ContextStorageError` with retained causes | Normalizes failure surface for callers without losing debugging detail |
| 41-02 | Hook handler failures remain non-blocking while service-level failures map to tagged `HookExecutionError` | Preserves runtime parity and removes ad-hoc generic error leakage |
| 41-03 | AgentService syncs a concrete `ToolRegistry` into AgentFactory at create-time | Eliminates service-path runtime escapes while preserving existing factory behavior |
| 41-03 | Agent creation errors use stable default message text and retain original causes | Keeps typed caller-facing contracts concise without losing diagnostic context |
| 41-03 | Agent registration finalizes through atomic `Ref.modify` insertion | Guarantees failed creates do not partially register agent state |
| 41-04 | IntentMatcherService and IntentRouterService now execute standalone Effect logic in service layers | Removes wrapper delegation while preserving public service APIs |
| 41-04 | Intent ambiguity resolution is deterministic first-match-wins with explicit tie-break ordering | Locks ordering-sensitive behavior for stable downstream routing outcomes |
| 41-04 | Routing failures use normalized typed intent errors with preserved causes | Keeps caller-facing contracts explicit while retaining debugging context |
| 41-05 | MessageRouterService now owns rule matching/ranking/fallback in service-layer Effect logic | Closes imperative router delegation seam while preserving deterministic routing contracts |
| 41-05 | Fred base layers stay unchanged while standalone intent/router composition is exposed as opt-in exports | Preserves MessageProcessor optional dependency behavior without forced requirements |
| 41-05 | Standalone router fallback cascade is explicit (`defaultAgent` -> `fallbackAgents` -> first rule agent -> typed failure) | Maintains deterministic fallback outcomes in config-only service composition |
| 42-03 | MessageProcessorService uses `Ref` for mutable state across stream operations | State survives stream transformations without buffering entire stream |
| 42-03 | No `Effect.runPromise` in MessageProcessorService streaming path | Pure Effect composition without runtime boundary escapes |
| 42-03 | No `Stream.runCollect` in live stream paths - events flow without buffering | Preserves strict ordering and partial outputs before terminal failures |
| 42-03 | `RouteExecutionError` carries `agentId` and `routeType` for debugging | Post-routing failures include route context metadata |
| 42-02 | Resume restores checkpoint context as source of truth | Eliminates state recomputation and guarantees deterministic continuation |
| 42-02 | Typed resume errors carry runId/pipelineId/step for diagnostics | Rich error context without string parsing |
| 42-02 | `resumeWithHumanInput` requires paused status (strict gate) | Prevents accidental resumption of non-paused checkpoints |
| 42-02 | Best-effort step resolution via stepName fallback | Graceful handling when pipeline steps change between runs |
| 42-02 | Skip mode at last step returns completed result | Handles edge case where all steps already executed |
| 43-01 | Phase 43 static guards enforce no forbidden Fred imports/new seams by explicit symbol checks | Makes seam regressions immediately visible with clear failure attribution |
| 43-01 | Fred facade boundary tests run against both `Fred.create()` and `new Fred()` paths | Locks constructor/factory parity while migration moves delegation to runtime services |
| 43-02 | Fred runtime composition is option-driven via service-layer helpers (`createFredRuntimeWithOptions`) | Keeps runtime wiring centralized and reusable while supporting optional routing/observability inputs |
| 43-02 | Runtime-sensitive config updates invalidate and rebuild runtime instead of mutating dependencies in place | Prevents stale runtime state and keeps lifecycle semantics deterministic after config changes/shutdown |
| 43-02 | Runtime bootstrap replays class snapshots (tools/default agent/memory/tracer) after runtime creation | Preserves eager/lazy constructor parity while moving lifecycle control to Effect runtime state |
| 43-03 | Fred facade now exposes roadmap aliases (`routeMessage`, `executePipeline`, `registerAgent`) and delegates these through runtime services | Satisfies FRED-04/FRED-05/FRED-06 call-surface requirements without reintroducing manager seams |
| 43-03 | Provider/intent/tool snapshots replay into runtime service state during bootstrap | Preserves pre-runtime registration behavior while keeping runtime execution service-backed |
| 43-03 | Forbidden-symbol scan in `index.ts` is constrained to service-tag references only | Locks static migration compliance for FRED-09 and prevents imperative seam regressions |
| 43-04 | ConfigInitializer `FredLike` now depends on local capability interfaces instead of imperative manager class types | Keeps initialization seam compatible with Effect-backed Fred facade without class coupling |
| 43-04 | Routing and explain integration tests now use only public Fred API setup paths | Removes private field mutation and direct `MessageRouter` construction from migration coverage |
| 43-04 | Final Phase 43 verification suite includes services/routing/static guards plus CLI smoke contracts | Confirms facade migration readiness before starting imperative layer removal |
| 43-05 | ROADMAP criteria were pre-applied during plan creation; contract tests use method-body extraction for precise assertions | Locks lazy runtime init and Runtime.runPromise boundary as explicit contracts |
| 43-06 | getContextManager proxy returns safe pre-runtime stubs that queue state for replay, matching getAgentManager pattern | Closes consumer compatibility gap for lazy-init Fred without breaking Effect service contracts |
| 43-06 | ExternalStorageAdapter wraps Promise-based ContextStorage into Effect interface for replaceStorage | Bridges legacy storage adapters into Effect-backed context service without runtime boundary escapes |
| 43-06 | initializeFromConfig calls ensureRuntime() after invalidateRuntime to guarantee runtime before ConfigInitializer | Prevents "Context manager is available after runtime initialization" error in dev-chat and CLI |
| 43-verify | `setDefaultAgent` updates processor config via Ref instead of invalidating runtime | Prevents registered agents from being lost when changing default agent post-runtime |
| 44-01 | CLI session consumers now use Fred public session APIs with compatibility fallback adapter for injected legacy doubles | Preserves migration direction while keeping existing CLI tests green without immediate test fixture rewrites |
| 44-02 | Dev chat consumers now use structural context capability interfaces instead of `ContextManager` class types | Keeps consumer code aligned with Effect-backed Fred proxy while preparing imperative class deletion |
| 44-03 | MessageProcessor and AgentFactory internals now depend on Effect-first structural contracts instead of legacy Promise wrappers and ToolRegistry class coupling | Unblocks manager file deletion by removing internal class-type and wrapper seams while preserving behavior |
| 44-04 | Pipeline executor/router internals now use structural manager interfaces instead of importing manager class types | Removes compile-time coupling needed for upcoming manager file deletions while preserving runtime behavior |
| 44-05 | Imperative managers/wrappers are deleted in dependency order with a pre-deletion safety tag and immediate export cleanup | Preserves rollback safety while completing the core dead-code removal milestone for Phase 44 |
| 44-06 | Runtime boundary enforcement is codified via guard tests and CLAUDE.md policy, with explicit audited exceptions | Prevents silent `runPromise` boundary regressions while keeping known pre-existing exceptions visible for future cleanup |
| 44-07 | Obsolete deleted-manager test suites are removed while targeted survivors are migrated to Fred public APIs and structural contracts | Closes UAT blocker imports incrementally without reintroducing imperative seams |
| 44-08 | AgentFactory test suites now use shared ToolRegistryLike structural mocks from `tests/unit/helpers` instead of deleted ToolRegistry class imports | Keeps post-deletion tests green while enforcing structural constructor contracts used by production AgentFactory |
| 44-09 | Remaining survivor tests now use structural AgentManagerLike/ToolRegistryLike mocks and Fred-like map fixtures instead of deleted manager classes | Completes Phase 44 test import cleanup and resolves all 19 UAT-diagnosed deleted-manager import breaks |
| 44-10 | Pipeline barrel export no longer re-exports deleted `./manager` module and is validated by targeted plus full-suite tests | Closes final Phase 44 stale import gap that caused handoff/module-resolution failures |
| 44-11 | MessageProcessor dead class file is deleted and migration guard now enforces both file absence and no stale `export { MessageProcessor }` barrel re-export | Fully satisfies RMVL-07 by removing the final Promise-wrapper surface and prevents deleted-module export regressions |
| 44-12 | Fred now exposes direct context/session public methods and CLI chat/session consumers use them without proxy/fallback accessors | Closes CLI consumer migration gap while preserving temporary compatibility shim for final phase cleanup |
| 44-13 | Dev consumers now use direct Fred context methods and Fred/getContextManager proxy was removed entirely | Closes remaining consumer migration gap before Phase 45 API/release cleanup |
| 45-01 | Workflow functionality is exported via `WorkflowService` tags while `Workflow` remains a type-only export from manager.ts | Removes final imperative workflow class surface without breaking workflow config contracts |
| 45-01 | Fred keeps `getWorkflowManager` as a compatibility adapter backed by direct workflow methods and WorkflowService | Supports consumer migration while public workflow APIs now delegate to Effect service runtime |
| 45-01 | Main entrypoint re-exports include missing service tags and runtime composition helpers from `services.ts` | Completes public API surface requirements for Effect-first consumers in Phase 45 |
| 45-02 | package.json `exports` now defines eval/context/tools sub-path entrypoints plus preserved deep-import compatibility (`mcp/types`, `mcp/registry`, `tool/tool`) | Encodes explicit public import boundaries while avoiding regressions for known existing deep imports |
| 45-02 | CLI eval/test/chat consumers use split sub-path imports (`@fancyrobot/fred/eval`, `@fancyrobot/fred/context/sqlite`) with main-path compatibility retained | Establishes organized API usage without breaking current main entrypoint consumers |
| 45-03 | v0.3.0 breaking changes are documented in a dedicated changeset with migration before/after examples and release verification evidence | Gives external consumers a single migration source while closing API-04 and final verification requirements |
| 45-verify | Phase verification scored 4/6 and flagged API-surface and canonical-layer gaps for follow-up planning | Prevents premature phase closeout and drives `/gsd/plan-phase 45 --gaps` loop |
| 45-04 | FredLayers includes all 14 FredServices tags with default no-op MessageRouterService and Layer.merge for config override | Closes Gap 2 (API-03) by providing a single canonical all-services layer without type assertions |
| 45-05 | exports.ts uses explicit named exports organized by domain; all service tags consolidated in index.ts services block | Closes Gap 1 (API-02) by replacing wildcard barrel with curated surface and single service re-export location |
| 45.1-01 | Markdown agent files are parsed only when frontmatter delimiters exist; plain `.md` files without delimiters are skipped | Preserves existing plain prompt-file behavior while enabling explicit standalone agent definitions |
| 45.1-02 | ConfigInitializer now loads markdown-defined agents before config agents and rejects duplicate IDs across sources before registration | Enforces deterministic startup load order and prevents partial registration state on source collisions |
| 45.1-03 | Hot reload watches markdown agent dirs with per-file debounce and applies remove-then-create replacement on change events | Enables fast prompt/config iteration during development while avoiding partial-write races and leaked watcher resources |
### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Fix milestone version labels across documentation | 2026-02-08 | 2b09211 | [001](./quick/001-fix-milestone-version-labels-across-docu/) |
| 002 | Remove malformed 31-VERIFICATION.md heredoc | 2026-02-16 | n/a (gitignored) | [002](./quick/002-fix-malformed-bash-permission-entry-in-c/) |

## Session Continuity

Last session: 2026-03-01T23:30:00Z
Stopped at: Phase 45.1 UAT test 6/10 blocked on @effect/ai-openai Responses API incompatibility with OpenRouter
Resume file: .planning/phases/45.1-combine-assistant-config-prompt-yaml-frontmatter/.continue-here.md

---

*State file tracks current milestone progress*
*Archives in .planning/milestones/ contain historical data*
*Last updated: 2026-03-01 — UAT paused, root cause identified: @effect/ai-openai v0.37.2 Responses API format rejected by OpenRouter (missing type:"message" on assistant items)*
