---
gsd_state_version: 1.0
milestone: v0.3
milestone_name: milestone
status: in_progress
last_updated: "2026-03-01T17:17:09Z"
progress:
  total_phases: 48
  completed_phases: 44
  total_plans: 193
  completed_plans: 190
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** v0.3.0 Imperative-to-Effect Migration
**Last shipped:** v0.2.2 TUI Visual Polish (2026-02-22)

## Current Position

Phase: 44 of 45 (Imperative Layer Removal & Consumer Migration)
Plan: 3 of 6 in current phase
Status: In progress
Last activity: 2026-03-01 - Completed 44-04-PLAN.md

Progress: ████████████████████ 98% (190/193 plans)

## Performance Metrics

**Velocity:**

| Milestone | Plans | Avg Duration | Total Time |
|-----------|-------|-------------|------------|
| v0.2.2 TUI Visual Polish | 13 | ~7.5 min | ~90 min |
| v0.2.1 CLI/TUI Dev Experience | 31 | ~5.32 min | — |
| v0.2.0 Observability & Safety | 32 | ~4.2 min | 2 days |
| v0.2.0 Effect Migration + Monorepo | 86 | ~3.9 min | 13 days |
| v0.3.0 Imperative-to-Effect (Phase 43) | 6 | ~5 min | ~28 min |

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

None currently.

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

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Fix milestone version labels across documentation | 2026-02-08 | 2b09211 | [001](./quick/001-fix-milestone-version-labels-across-docu/) |
| 002 | Remove malformed 31-VERIFICATION.md heredoc | 2026-02-16 | n/a (gitignored) | [002](./quick/002-fix-malformed-bash-permission-entry-in-c/) |

## Session Continuity

Last session: 2026-03-01T17:17:09Z
Stopped at: Completed 44-04-PLAN.md
Resume file: None

---

*State file tracks current milestone progress*
*Archives in .planning/milestones/ contain historical data*
*Last updated: 2026-03-01 — Completed 44-04 internal manager-type decoupling plan*
