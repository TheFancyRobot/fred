# Roadmap: Fred

## Overview

Roadmap is milestone-scoped; shipped milestones are archived under `.planning/milestones/`.

**Current Milestone:** v0.2.1 CLI/TUI Developer Experience
**Last Shipped:** v0.2.0 Observability & Safety (2026-02-07)

---

## Milestones

- ✅ **v0.2.0 Effect Migration + Monorepo** — Phases 1-21.1 (shipped 2026-02-01, archive: `.planning/milestones/v0.2.0-ROADMAP.md`)
- ✅ **v0.2.0 Observability & Safety** — Phases 22-26 (shipped 2026-02-07, archive: `.planning/milestones/v0.2.0-ROADMAP.md`)
- 🚧 **v0.2.1 CLI/TUI Developer Experience** — Phases 27-32 (in progress)

---

## Phases

### 🚧 v0.2.1 CLI/TUI Developer Experience (In Progress)

**Milestone Goal:** Transform `@fancyrobot/fred-cli` into a production-grade CLI + TUI that any Fred project can install and instantly use.

- [x] **Phase 27: Terminal Foundation & Project Detection** - Terminal lifecycle management and project auto-detection (completed 2026-02-08)
- [x] **Phase 28: Streaming Performance & Core TUI** - High-performance streaming token rendering and TUI layout (completed 2026-02-08)
- [x] **Phase 29: Session Management** - Persistent sessions with export capabilities (completed 2026-02-09)
- [x] **Phase 30: CLI Commands** - Headless operation and config validation (completed 2026-02-11)
- [x] **Phase 31: CLI Testing & Debugging** - Advanced debugging and evaluation commands (completed 2026-02-13)
- [ ] **Phase 32: Plugin Architecture** - Extensible plugin system for custom commands and panels

## Phase Details

### Phase 27: Terminal Foundation & Project Detection
**Goal**: Establish robust terminal lifecycle management and project auto-detection with Effect-based resource cleanup
**Depends on**: Nothing (first phase of v0.2.1)
**Requirements**: TUI-01, TUI-02, TUI-03, TUI-04, TUI-09, TUI-10, PROJ-01, PROJ-02, PROJ-03, PROJ-04
**Success Criteria** (what must be TRUE):
  1. User can launch TUI with `fred` or `fred tui` and see multi-pane layout with sidebar, transcript, and status bar
  2. User can navigate between panes using Tab and arrow keys, scroll through content with keyboard
  3. CLI auto-detects project root by walking up directory tree and loads fred.config.ts or fred.config.json with high-quality validation errors
  4. TUI gracefully degrades to non-interactive mode in non-TTY environments and correctly restores terminal state on exit
  5. CLI works correctly in monorepo environments with workspace-specific configs
**Plans**: 4 plans

Plans:
- [x] 27-01-PLAN.md — Build project/config detection and actionable validation diagnostics (completed 2026-02-07, 4.25 min)
- [x] 27-02-PLAN.md — Add terminal lifecycle safety, help-first default, and `fred chat` command routing (completed 2026-02-07, 4.50 min)
- [x] 27-03-PLAN.md — Implement multi-pane TUI shell with keyboard focus and scroll navigation (completed 2026-02-08, 6.80 min)
- [x] 27-04-PLAN.md — Add phase smoke coverage and run blocking human verification checkpoint (completed 2026-02-08, ~12 min)

### Phase 28: Streaming Performance & Core TUI
**Goal**: Deliver high-performance streaming token rendering with optimized Effect Stream integration and complete TUI interaction model
**Depends on**: Phase 27
**Requirements**: TUI-05, TUI-06, TUI-07, TUI-08
**Success Criteria** (what must be TRUE):
  1. User can type and submit messages via bottom input bar and open command palette with Ctrl+K to access all actions
  2. TUI streams agent responses token-by-token in real-time without flickering or CPU spikes at 50-100+ tokens/second
  3. TUI status bar shows active model, accumulated cost, token count, and streaming indicator updated in real-time
  4. Effect Stream integration uses throttle/buffer operators with backpressure handling to prevent memory bloat during high-volume streaming
**Plans**: 6 plans

Plans:
- [x] 28-01-PLAN.md — Build throttled streaming pipeline with bounded backpressure and token metrics (completed 2026-02-08, 5.92 min)
- [x] 28-02-PLAN.md — Implement multiline input composer and submit-to-stream wiring (completed 2026-02-08, 4.00 min)
- [x] 28-03-PLAN.md — Add command palette interactions and real-time telemetry status bar (completed 2026-02-08, 8.00 min)
- [x] 28-04-PLAN.md — Validate via phase smoke/performance tests and blocking human verification (completed 2026-02-08, 19.00 min)
- [x] 28-05-PLAN.md — Wire Fred core AI backend to TUI chat command and fix model telemetry (completed 2026-02-08, 5.58 min, gap closure)
- [x] 28-06-PLAN.md — Fix provider registration blocker: add provider dependencies, shared defaults bootstrap, and final TUI UAT polish (completed 2026-02-08, ~34 min)

### Phase 29: Session Management
**Goal**: Enable persistent sessions with sidebar navigation, CLI access, and export capabilities
**Depends on**: Phase 28
**Requirements**: SESS-01, SESS-02, SESS-03, SESS-04, SESS-05, SESS-06, SESS-07
**Success Criteria** (what must be TRUE):
  1. User can view list of sessions in TUI sidebar with metadata, switch between sessions, and create new sessions from TUI
  2. User can list sessions via `fred session list` with tabular and --json output
  3. User can view session transcript via `fred session show <id>` and export via `fred session export <id>` in JSON and markdown formats
  4. User can delete sessions via `fred session rm <id>` with confirmation prompt
**Plans**: 4 plans

Plans:
- [x] 29-01-PLAN.md — Add session storage list/query and export helpers in core (completed 2026-02-08)
- [x] 29-02-PLAN.md — Implement CLI session commands for list/show/export/rm (completed 2026-02-08)
- [x] 29-03-PLAN.md — Wire TUI session sidebar navigation, switching, and creation (completed 2026-02-08)
- [x] 29-04-PLAN.md — Add TUI session deletion with confirmation prompt (completed 2026-02-09)

### Phase 30: CLI Commands
**Goal**: Deliver full CLI command parity for headless operation, project scaffolding, and config validation
**Depends on**: Phase 27
**Requirements**: CLI-01, CLI-02, CLI-03, CLI-04, CLI-05, CLI-06, CLI-07, CLI-08
**Success Criteria** (what must be TRUE):
  1. User can run agents or workflows headlessly via `fred run <agent|workflow> --input "message"` with text and --json output
  2. User can list registered agents, tools, intents, providers, and workflows via `fred list <type>` commands
  3. User can validate config via `fred config validate` with clear error messages showing file path, line number, and fix suggestions
  4. User can scaffold new Fred project via `fred init` with starter config and example agent
**Plans**: 3 plans

Plans:
- [x] 30-01-PLAN.md — Entity listing commands (agents, tools, intents, providers, workflows) (completed 2026-02-11, 3.00 min)
- [x] 30-02-PLAN.md — Config validate and init scaffolding commands (completed 2026-02-11, 2.63 min)
- [x] 30-03-PLAN.md — Headless run command and CLI entrypoint wiring (completed 2026-02-11, 2.82 min)

### Phase 31: CLI Testing & Debugging
**Goal**: Provide debugging and evaluation commands for intent testing, routing analysis, and MCP server management
**Depends on**: Phase 30
**Requirements**: TEST-01, TEST-02, TEST-03, TEST-04, TEST-05
**Success Criteria** (what must be TRUE):
  1. User can test intent matching via `fred intent test "message"` showing matched intent, confidence, and alternatives
  2. User can test routing via `fred route test "message"` showing full routing decision with explanation
  3. All eval commands support --json output for CI integration
  4. User can manage MCP servers via `fred mcp list/start/stop <id>` showing configured servers and connection status
**Plans**: 4 plans

Plans:
- [x] 31-01-PLAN.md — Intent test and route test commands with TTY-aware color output (completed 2026-02-12, 4.56 min)
- [x] 31-02-PLAN.md — MCP server management commands and CLI entrypoint wiring (completed 2026-02-12, 4.47 min)
- [x] 31-03-PLAN.md — Add visible exit codes to CLI error messages (completed 2026-02-12, 2.12 min, gap closure)
- [x] 31-04-PLAN.md — Fix --json flag handling on error paths in intent, route, and mcp commands (completed 2026-02-13, 4.12 min, gap closure)

### Phase 32: Plugin Architecture
**Goal**: Enable extensible plugin system with custom CLI commands, TUI slash commands, and stable typed contract
**Depends on**: Phase 28, Phase 30
**Requirements**: PLUG-01, PLUG-02, PLUG-03, PLUG-04, PLUG-05
**Success Criteria** (what must be TRUE):
  1. User can declare plugins in fred.config via npm packages or local paths
  2. CLI discovers and loads plugins from config on startup with validation errors for incompatible versions
  3. Plugins can register custom CLI commands that appear in `fred help` and are executable
  4. Plugins can register custom slash commands accessible in TUI command palette
  5. Plugin API exposes stable typed contract via `@fancyrobot/fred-cli/plugin` entry point with semantic versioning
**Plans**: 5 plans

Plans:
- [x] 32-01-PLAN.md — Create stable plugin contract and declaration normalization foundation (completed 2026-02-14, 3 min)
- [x] 32-02-PLAN.md — Build plugin discovery/loading manager with aggregated validation diagnostics (completed 2026-02-14, 3 min)
- [x] 32-03-PLAN.md — Wire plugin CLI commands into dispatch and help with conflict-safe registration (completed 2026-02-14)
- [x] 32-04-PLAN.md — Integrate plugin slash commands into TUI palette and typed slash flow (completed 2026-02-14, 5 min)
- [ ] 32-05-PLAN.md — Add integrated plugin smoke coverage and deterministic startup failure exit codes

## Progress

**Execution Order:**
Phases execute in numeric order: 27 → 28 → 29 → 30 → 31 → 32

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 27. Terminal Foundation & Project Detection | 4/4 | Complete | 2026-02-08 |
| 28. Streaming Performance & Core TUI | 6/6 | Complete | 2026-02-08 |
| 29. Session Management | 4/4 | Complete | 2026-02-09 |
| 30. CLI Commands | 3/3 | Complete | 2026-02-11 |
| 31. CLI Testing & Debugging | 4/4 | Complete | 2026-02-13 |
| 32. Plugin Architecture | 4/5 | In progress | - |

---

## Previous Milestones

<details>
<summary>✅ v0.2.0 Observability & Safety (Phases 22-26) - SHIPPED 2026-02-07</summary>

See `.planning/milestones/v0.2.0-ROADMAP.md` for complete details.

</details>

<details>
<summary>✅ v0.2.0 Effect Migration + Monorepo (Phases 1-21.1) - SHIPPED 2026-02-01</summary>

See `.planning/milestones/v0.2.0-ROADMAP.md` for complete details.

</details>

---

*Last updated: 2026-02-14 - Completed 32-04 plan (plugin slash commands in TUI palette and typed flow)*
