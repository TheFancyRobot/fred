# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-07)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** v0.2.1 gap-closure execution in progress — Phase 33 launch contract alignment underway
**Milestone:** v0.2.1 CLI/TUI Developer Experience

## Current Position

Phase: 33 of 36 (Default Launch Contract Alignment)
Plan: 2 of 3 in current phase
Status: In progress
Last activity: 2026-02-14 - Completed 33-02-PLAN.md

Progress: [█████████░] 99% (147/148 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 27 (v0.2.1 milestone)
- Average duration: 5.60 min
- Total execution time: ~2.43 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 27 | 4 | 27.55 min | 6.89 min |
| 28 | 6 | 47.65 min | 7.94 min |
| 29 | 4 | ~28 min | ~7.00 min |
| 30 | 3 | 8.45 min | 2.82 min |
| 31 | 4 | 15.27 min | 3.82 min |
| 32 | 5 | 19.00 min | 3.80 min |

**Recent Trend:**
- Last 5 plans: 3.00 min (32-01), 3.00 min (32-02), 4.00 min (32-03), 5.00 min (32-04), 4.00 min (32-05)
- Trend: Phase 32 completed cleanly with stable 3-5 min plan execution cadence
- Automated plans averaging 5.60 min in current milestone window

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
- Milestone label normalization mapping (quick-001-01) — Standardized planning references to v0.1.0/v0.2.0/v0.2.1 without renaming archive files
- Storage-level session summaries (29-01) — Session lists computed via SQL for counts and preview payloads
- Default session exports to markdown (29-02) — Export filenames derived from title + date
- Sidebar action row selection (29-03) — allow new-session action to be focusable without switching sessions
- Duplicated initializeFred helper in list.ts (30-01) — defer shared extraction to 30-03 wiring plan
- Raw config entity counting in config validate (30-02) — avoids heavyweight Fred instantiation for validation summary
- Non-streaming processMessage for headless run (30-03) — predictable complete output for CI/scripting pipelines
- DI-based stdin bypass in run command (30-03) — deps.stdin overrides TTY check for testability
- Fred internal intentMatcher access in CLI (31-01) — access via (fred as any).intentMatcher instead of creating new instance
- Minimal MCPServerRegistry extensions (31-02) — added only getAllConfiguredServers() and getServerConfig() methods
- Tool count display limitation in MCP list (31-02) — show "-" for tool count in table view; status command provides detailed info
- Graceful error handling in MCP batch operations (31-02) — continue processing all servers even if some fail in --all mode
- Exclusive output channels for --json mode (31-04) — JSON to stdout OR plain text to stderr, never both simultaneously
- Source-derived plugin identity in normalization (32-01) — plugin source is canonical id for duplicate detection and deterministic ordering
- Two-phase plugin startup validation gate (32-02) — discover/load/validate all plugins before registering contributions
- Structured plugin diagnostics in config validation (32-02) — pluginId and declarationSource included for machine-readable JSON output
- Unknown-command plugin dispatch boundary (32-03) — plugin runtime is invoked only after built-in command switch so core CLI commands always win conflicts
- Unavailable plugin command stubs in help (32-03) — conflicted top-level plugin commands remain visible with explicit reason while namespaced form stays executable
- Startup-time plugin slash availability filtering (32-04) — unavailable plugin slash commands are hidden consistently in palette and typed slash search
- Shared plugin slash execution registry in TUI (32-04) — typed `/plugin:command` and palette selection dispatch through identical runtime behavior
- Dedicated plugin startup failure exit code (32-05) — aggregated plugin validation failures now terminate CLI startup with deterministic exit code `12`
- Startup plugin diagnostics channel safety (32-05) — text diagnostics emit to stderr while JSON diagnostics emit to stdout-only payloads
- No-args launch dispatch parity at CLI entry (33-01) — bare `fred` now routes to the same interactive path as `fred chat`/`fred tui`
- Shared non-interactive launch payload contract (33-01) — launch entrypoints use one JSON fallback shape and exit behavior in non-TTY mode
- Startup chooser defaults to start-new with Enter confirmation (33-02) — existing-session startup is now explicit and deterministic instead of implicit auto-resume
- Interactive config init fallback shown in TUI startup (33-02) — config load failures remain in guided flow via concise startup warning

### Pending Todos

- [ ] Update dev chat (`bun run dev`) to detect `@fancyrobot/fred-cli` and launch the TUI when installed.

### Blockers/Concerns

**Research-flagged phases:**
- ~~Phase 32 (Plugin Architecture): Needs research for plugin API contract (security model, semver policy, compatibility testing, deprecation strategy)~~ ✓ Completed and verified

**Technical risks identified in research:**
- ~~Bun TTY compatibility must be validated in Phase 27 before architectural commitment~~ ✓ Validated in 27-02 (detectTerminalMode tests setRawMode capability)
- ~~Effect fiber interruption cleanup pattern critical for Phase 27 (terminal state corruption)~~ ✓ Implemented in 27-02 (Effect.acquireUseRelease guarantees cleanup)
- Stream backpressure handling required in Phase 28 (memory bloat prevention) — Core mitigation validated by 28-04 smoke/performance guards; live upstream-response verification still environment-dependent
- SQLite WAL file locking for multi-instance CLI usage (Phase 29)

**Phase dependencies:**
- Phase 29 depends on Phase 28 (session sidebar requires TUI layout)
- Phase 30 depends on Phase 27 only (CLI commands independent of TUI) — ✓ Phase 30 complete
- Phase 31 depends on Phase 30 (extends CLI commands) — ✓ Phase 30 complete
- Phase 32 depends on Phase 28 + Phase 30 (plugins extend both TUI and CLI) — ✓ Phase 30 complete

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Fix milestone version labels across documentation (v0.2.5->v0.1.0, v0.3.0->v0.2.0, v0.3.1->v0.2.1) | 2026-02-08 | 2b09211 | [001-fix-milestone-version-labels-across-docu](./quick/001-fix-milestone-version-labels-across-docu/) |

## Session Continuity

Last session: 2026-02-14T22:38:30Z
Stopped at: Completed 33-02-PLAN.md
Resume file: None
