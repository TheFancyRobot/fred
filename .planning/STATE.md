# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-02-16)

**Core value:** Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.
**Current focus:** v0.2.2 milestone — TUI Visual Polish
**Milestone:** v0.2.2 TUI Visual Polish
**Last shipped:** v0.2.1 CLI/TUI Developer Experience (2026-02-16)

## Current Position

Phase: 40 of 40 (Input & Status Bar Polish)
Plan: 1 of 3 in current phase
Status: In progress
Last activity: 2026-02-21 - Completed 40-01 (minimal composer chrome and queue-safe submit)

Progress: [██████████] 100% (171/171 plans complete)

## Performance Metrics

**Velocity:**
- Total plans completed: 9 (v0.2.2 milestone)
- Average duration: ~7.5 min
- Total execution time: ~68 min

**Previous Milestones:**
- v0.2.1: 31 plans, ~5.32 min/plan
- v0.2.0: 32 plans, ~4.2 min/plan (2 days)
- v0.2.0: 86 plans, ~3.9 min/plan (13 days)

*Updated after each plan completion*

## Accumulated Context

### Discoveries (from TUI exploration)

- **Current TUI uses `@opentui/core` v0.1.77** — Yoga-based flexbox layout with `BoxRenderable`, `TextRenderable`, `ScrollBoxRenderable`
- **Centralized theme system established in Phase 37** — `packages/cli/src/tui/theme.ts` exports `TuiTheme` interface and `DEFAULT_TUI_THEME` with semantic fg/bg/accent/status tokens
- **Borderless contrast layout active** — regions separated by backgroundColor contrast (base → surface → elevated) with padding/gap spacing, no box-drawing borders
- **Selected items use accent color** — `▸` marked sidebar items and `>` command palette selections render with `accent.primary` + bold

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- (Phase 37) Muted cool palette with 3-step background contrast: base → surface → elevated
- (Phase 37) Teal primary accent (#5ec2c7) for selected items, focused titles, role labels
- (Phase 37) All color values consumed from centralized theme tokens — zero inline hex in app.ts
- (Phase 38) Focus cycle skips hidden sidebar via focus helpers with includeSidebar option
- (Phase 38) Preserve sidebar header ordering when rebuilding text renderables
- (Phase 38) Prefer CLI TUI launch in dev-chat when @fancyrobot/fred-cli is installed
- (Phase 38) Anchor sidebar metadata in a footer renderable to keep it bottom-aligned
- (Phase 38) Render metadata in footer region for bottom alignment regardless of session list length
- (Phase 39) User messages: teal left border on base bg, assistant messages: surface bg with MarkdownRenderable
- (Phase 39) Streaming content uses warm amber accent with block cursor, instant transition on completion
- (Phase 39) SyntaxStyle created once in constructor, destroyed in stop() (FFI resource lifecycle)
- (Phase 39) Incremental MarkdownRenderable content updates during streaming (no tree rebuild)
- (Phase 39) Legacy renderTranscriptContent preserved for startup chooser and empty state
- (Carried from v0.2.1) Full ANSI rendering loop in TUI app (27-04)
- (Carried from v0.2.1) Framework-agnostic TUI implementation (27-03)
- (Carried from v0.2.1) Bounded rich input bar rendering (28-02)
- (Carried from v0.2.1) Minimal composer chrome (28-04)
- (Phase 39) Tool blocks indexed by group position, correlated with assistant message index in transcript
- (Phase 39) Braille spinner 80ms interval auto-stops when no in-progress blocks remain
- (Phase 39) Parallel completed tools collapse to 'N tools' summary for reduced visual noise
- (Phase 39) Timer-based streaming flush replacing Effect Queue/Stream for incremental display
- (Phase 39) Dual SyntaxStyle instances for normal vs streaming amber color schemes
- (Phase 39) getMarkdownSyntaxTheme() centralized markdown scope definitions in theme.ts
- (Phase 39) Broadened XML regex to match any lowercase tag for future-proof tool name filtering
- (Phase 39) Buffer-based partial tag detection in TUI token path for XML tags split across deltas
- (Phase 39) Removed explicit tool name mention from system prompt to reduce XML hallucination
- [Phase 39]: Timer-based streaming flush replacing Effect Queue/Stream for incremental display
- [Phase 39]: Ctrl+Y for per-message copy, keyboard-driven copy as alternative to native text selection
- (Phase 39) Bold uses bright white (#ffffff), italic uses blue-gray (#c2c6cc) for color-based markdown visibility
- (Phase 39) Headings use background band + UPPERCASE + teal color for structural distinction without font size
- (Phase 39) renderNode callback pattern for custom token rendering in MarkdownRenderable
- (Phase 40) Subtle left accent glyph (▎) replaces > prompt for minimal composer chrome
- (Phase 40) 5-line max visible input with 7-line maxHeight cap for upward growth
- (Phase 40) Zero regionGap for flush transcript/input boundary
- (Phase 40) Pending submissions projected as dimmed renderables, not added to transcript
- (Phase 40) Queue state in TuiState.input.pendingSubmissions for streaming-safe submits
- (Phase 40) FIFO queue drain from complete/fail stream handlers

### Blockers/Concerns

None currently.

### Pending Todos

- [ ] None

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 001 | Fix milestone version labels across documentation (v0.2.5->v0.1.0, v0.3.0->v0.2.0, v0.3.1->v0.2.1) | 2026-02-08 | 2b09211 | [001-fix-milestone-version-labels-across-docu](./quick/001-fix-milestone-version-labels-across-docu/) |
| 002 | Remove malformed 31-VERIFICATION.md heredoc accidentally added as Bash permission entry in .claude/settings.local.json | 2026-02-16 | n/a (gitignored) | [002-fix-malformed-bash-permission-entry-in-c](./quick/002-fix-malformed-bash-permission-entry-in-c/) |

---
| Phase 40 P01 | 18min | 3 tasks | 5 files |
| Phase 39 P03 | 5min | 2 tasks | 5 files |
| Phase 39 P04 | 6 | 2 tasks | 3 files |
| Phase 39 P06 | 1min | 1 task | 1 file |
| Phase 39 P07 | 3min | 2 tasks | 2 files |

## Session Continuity

Last session: 2026-02-21
Stopped at: Completed 40-01-PLAN.md (minimal composer chrome and queue-safe submit)
Resume file: .planning/phases/40-input-and-status-bar-polish/40-01-SUMMARY.md

---

*State file tracks current milestone progress*
*Archives in .planning/milestones/ contain historical data*
*Last updated: 2026-02-21 — Phase 40 plan 01 complete*
