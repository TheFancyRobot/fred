# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-21)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** v0.3.0 Imperative-to-Effect Migration
**Last shipped:** v0.2.2 TUI Visual Polish (2026-02-22)

## Current Position

Phase: 42 — Pipeline & MessageProcessor Completion (in progress)
Plan: 3 of 4 complete (42-03)
Status: In progress - PIPE-01, PIPE-02, PIPE-03 complete
Last activity: 2026-02-28 - Completed 42-03-PLAN.md (Stream contracts)

Progress: 4 milestones shipped + v0.3.0 phase 42 in progress (179 total plans)

## Performance Metrics

**Velocity:**

| Milestone | Plans | Avg Duration | Total Time |
|-----------|-------|-------------|------------|
| v0.2.2 TUI Visual Polish | 13 | ~7.5 min | ~90 min |
| v0.2.1 CLI/TUI Dev Experience | 31 | ~5.32 min | — |
| v0.2.0 Observability & Safety | 32 | ~4.2 min | 2 days |
| v0.2.0 Effect Migration + Monorepo | 86 | ~3.9 min | 13 days |

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
- **Fred class (756 lines)** uses imperative classes; Effect runtime barely touched (only `setToolPolicies()`)
- **PipelineService has 3 stubs** returning `Effect.fail("not yet migrated to Effect")` for V2 execution, resume, graph execution
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

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Fix milestone version labels across documentation | 2026-02-08 | 2b09211 | [001](./quick/001-fix-milestone-version-labels-across-docu/) |
| 002 | Remove malformed 31-VERIFICATION.md heredoc | 2026-02-16 | n/a (gitignored) | [002](./quick/002-fix-malformed-bash-permission-entry-in-c/) |

## Session Continuity

Last session: 2026-02-28 21:30:00Z
Stopped at: Completed 42-03-PLAN.md (Stream contracts)
Resume file: .planning/STATE.md

---

*State file tracks current milestone progress*
*Archives in .planning/milestones/ contain historical data*
*Last updated: 2026-02-28 — Phase 42 in progress (3/4 plans complete)*
