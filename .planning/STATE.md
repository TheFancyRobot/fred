# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** Phase 29 kickoff ready — session sidebar can build on validated Phase 28 TUI foundation
**Milestone:** v0.2.1 CLI/TUI Developer Experience

## Current Position

Phase: 28 of 32 (Streaming Performance & Core TUI)
Plan: 6 of 6 in current phase
Status: PHASE COMPLETE
Last activity: 2026-02-08 — Completed 28-06-PLAN.md (Provider registration fix - gap closure)

Progress: [█████████░] 99% (130/131 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 10 (v0.2.1 milestone)
- Average duration: 7.48 min
- Total execution time: 1.25 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 27 | 4 | 27.55 min | 6.89 min |
| 28 | 6 | 47.65 min | 7.94 min |

**Recent Trend:**
- Last 5 plans: 4.00 min (28-02), 8.00 min (28-03), 19.00 min (28-04 with checkpoint), 5.58 min (28-05), 5.15 min (28-06)
- Trend: Throughput stable; gap closure plans consistently faster than checkpoint-based validation
- Automated plans averaging 7.48 min in current milestone window

**Previous Milestones:**
- v0.2.0: 32 plans, ~4.2 min/plan (2 days)
- v0.2.0: 86 plans, ~3.9 min/plan (13 days)

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Full ANSI rendering loop in TUI app (27-04) — Human checkpoint revealed missing rendering; rewrote app.ts
- Framework-agnostic TUI implementation (27-03) — OpenTUI not yet available; clean abstraction allows future swap-in
- History navigation continuation (27-03) — Allow Up/Down to continue navigating after first selection matches shell UX
- Effect.acquireUseRelease for terminal lifecycle (27-02) — Guarantees cleanup on success/error/interruption
- fred chat as explicit interactive entrypoint (27-02) — Help-first default, chat is opt-in
- Bounded sliding queue for render signals (28-01) — Coalesces update pressure without losing token content
- Streaming lifecycle as pure state transitions (28-01) — Deterministic metrics/error handling for status bar integration
- Shift+Enter multiline composer semantics (28-02) — Enter submits, Shift+Enter inserts newline, whitespace payloads ignored
- Bounded rich input bar rendering (28-02) — Stable placeholder selection and four-line auto-grow with keyboard affordances
- Global Ctrl+K/Cmd+K palette semantics (28-03) — Sidebar-scoped search/actions without disrupting existing focus cycling
- Throttled telemetry status transitions (28-03) — 100ms streaming cadence with immediate refresh at stream start/stop/error
- Total-first token telemetry (28-04) — Status now prioritizes combined token count with in/out as secondary detail
- Minimal composer chrome (28-04) — Removed persistent input shortcut hint to reduce distraction
- Fire-and-forget streaming pattern (28-05) — onSubmit callback streams async without blocking TUI event loop
- Provider priority cascade (28-05) — OpenAI > Anthropic > Google > Groq > OpenRouter based on ecosystem maturity
- Config-first with auto-detection fallback (28-05) — Respects explicit config, convenient env-based setup otherwise
- Telemetry defaults to '--' (28-05) — Avoids misleading users before provider actually connects
- Provider packages as CLI workspace dependencies (28-06) — Enables dynamic import resolution from CLI context
- Dynamic provider import before registration (28-06) — Triggers side-effect self-registration before useProvider call

### Pending Todos

None yet.

### Blockers/Concerns

**Research-flagged phases:**
- Phase 32 (Plugin Architecture): Needs research for plugin API contract (security model, semver policy, compatibility testing, deprecation strategy)

**Technical risks identified in research:**
- ~~Bun TTY compatibility must be validated in Phase 27 before architectural commitment~~ ✓ Validated in 27-02 (detectTerminalMode tests setRawMode capability)
- ~~Effect fiber interruption cleanup pattern critical for Phase 27 (terminal state corruption)~~ ✓ Implemented in 27-02 (Effect.acquireUseRelease guarantees cleanup)
- Stream backpressure handling required in Phase 28 (memory bloat prevention) — Core mitigation validated by 28-04 smoke/performance guards; live upstream-response verification still environment-dependent
- SQLite WAL file locking for multi-instance CLI usage (Phase 29)

**Phase dependencies:**
- Phase 29 depends on Phase 28 (session sidebar requires TUI layout)
- Phase 30 depends on Phase 27 only (CLI commands independent of TUI) — ✓ Phase 27 complete
- Phase 31 depends on Phase 30 (extends CLI commands)
- Phase 32 depends on Phase 28 + Phase 30 (plugins extend both TUI and CLI)

## Session Continuity

Last session: 2026-02-08T16:31:35Z
Stopped at: Completed 28-06-PLAN.md
Resume file: .planning/phases/28-streaming-performance-core-tui/28-06-SUMMARY.md

**Next step:** Phase 28 complete (all UAT blockers resolved) — ready for final UAT validation, then Phase 29 planning/execution (session sidebar and transcript persistence workflows)
