# Fred Project Milestones

## v0.2.1 CLI/TUI Developer Experience (Shipped: 2026-02-16)

**Delivered:** Production-grade CLI and TUI for Fred projects with terminal lifecycle management, streaming token rendering, session persistence, headless commands, plugin architecture, and comprehensive test hardening.

**Phases completed:** 27-36 (31 plans total)

**Key accomplishments:**

1. Built terminal foundation with Effect-based lifecycle management, TTY detection, and graceful degradation.
2. Delivered high-performance streaming TUI with multi-pane layout, command palette, and real-time telemetry.
3. Implemented persistent session management with sidebar navigation, CLI list/show/export/delete, and startup chooser.
4. Created full CLI command suite: headless `fred run`, entity listing, config validation, init scaffolding.
5. Added debugging commands for intent testing, route analysis, and MCP server management.
6. Shipped extensible plugin architecture with typed contract, CLI commands, and TUI slash commands.
7. Hardened runtime with JSON channel consistency, terminal lifecycle wiring, and Bun mock isolation.

**Stats:**

- 10 phases, 31 plans, ~5.32 min/plan average
- ~2.75 hours total execution time
- Key files: `packages/cli/src/tui/app.ts` (1197 lines), `packages/cli/src/tui/state.ts` (1703 lines)

**Git range:** Phase 27 → Phase 36

**What's next:** v0.2.2 TUI Visual Polish (`/gsd/new-milestone`)

---

## v0.2.0 Observability & Safety (Shipped: 2026-02-07)

**Delivered:** Production-grade observability, deterministic evaluation/replay, tool safety policies, MCP integration, and routing explainability across Fred core and CLI surfaces.

**Phases completed:** 22-26 (34 plans total)

**Key accomplishments:**

1. Built full observability foundation with correlation context, structured telemetry, and token/cost metrics.
2. Delivered deterministic record/replay/compare/suite framework with config-less replay support.
3. Added intent-aware ToolGate policies with audit hooks and HITL approval flows.
4. Integrated MCP multi-server lifecycle, namespaced tools/resources, and policy-aware discovery.
5. Shipped routing explainability with alternatives, calibrated confidence metadata, and `fred.routing.explain()`.

**Stats:**

- 111 files changed
- 19,456 insertions and 664 deletions in milestone commit range
- 5 phases, 34 plans, ~71 tracked tasks from summary metadata
- ~16h 19m from first v0.2.0 feat commit to final v0.2.0 feat commit

**Git range:** `feat(22-01)` -> `feat(26-03)`

**What's next:** v0.2.1 CLI/TUI Developer Experience (`/gsd/new-milestone`)

---

## v0.2.0 Effect Migration + Monorepo (Shipped: 2026-02-01)

**Delivered:** Complete Effect-based AI framework with monorepo architecture, dual Promise/Effect APIs, SQL persistence, checkpoint/resume, and 8 published packages.

**Phases completed:** 1-21.1 (86 plans total)

**Key accomplishments:**

1. Migrated from AI SDK to Effect-based providers (@effect/ai) with full streaming support
2. Built intent-based routing with hybrid rules/regex + LLM fallback
3. Implemented sequential pipelines and graph/DAG workflows with agent handoffs
4. Added SQL persistence adapters for Postgres and SQLite
5. Delivered checkpoint/resume with human-in-the-loop pause capabilities
6. Created OTel-compatible observability with Effect spans and OTLP export
7. Built provider ecosystem with 5 built-in packs (OpenAI, Anthropic, Google, Groq, OpenRouter)
8. Converted to monorepo with Bun workspaces, Changesets, and automatic npm publishing

**Stats:**

- 50,726 lines of TypeScript across 8 packages
- 22 phases, 86 plans, 1,072 tests
- 137 commits (Jan 20 - Feb 1, 2026)
- 13 days from first commit to ship

**Git range:** Initial roadmap commit → v0.2.0 milestone completion

**What's next:** v0.2.0 Observability & Safety — structured hooks, evaluation tooling, tool gating, MCP integration

---

*Milestones tracked in reverse chronological order*
*Full phase details in .planning/milestones/v{X.Y}-ROADMAP.md*
