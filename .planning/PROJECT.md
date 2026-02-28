# Fred

## What This Is

Fred is an OSS framework for building intent-based, multi-agent AI workflows with a single entrypoint that routes messages to specialized agents. Built on Effect (@effect/ai), it provides global shared context, in-memory conversation persistence with optional SQL-backed storage (Postgres/SQLite), and pipeline execution that chains agents or custom functions while preserving full context. The framework supports both Promise-based and Effect-based APIs, with pluggable provider packs for OpenAI, Anthropic, Google, Groq, and OpenRouter.

## Core Value

Route any message to the right agent and execute multi-step pipelines with shared context, without developers stitching orchestration together themselves.

## Requirements

### Validated

- ✓ **ROUT-01**: Hybrid intent routing (rules/regex first, LLM fallback classifier) — v0.2.0
- ✓ **ROUT-02**: Unmatched messages route to default agent — v0.2.0
- ✓ **ROUT-03**: Multiple root agents for entry routing — v0.2.0
- ✓ **AGNT-01**: Agent registration with system prompt, model, and tool bindings — v0.2.0
- ✓ **ORCH-01**: Sequential pipeline execution with shared context — v0.2.0
- ✓ **ORCH-02**: Graph/DAG workflows for branching execution — v0.2.0
- ✓ **ORCH-03**: Pipeline hooks at before/after stages — v0.2.0
- ✓ **ORCH-04**: Agent handoff during workflow runs — v0.2.0
- ✓ **TOOL-01**: Schema-validated tool definitions — v0.2.0
- ✓ **PROV-01**: Effect provider abstraction (@effect/ai) — v0.2.0
- ✓ **PROV-02**: Pluggable provider packs — v0.2.0
- ✓ **PROV-03**: Streaming responses (tokens/steps) — v0.2.0
- ✓ **MEM-01**: In-memory conversation context with thread IDs — v0.2.0
- ✓ **PERS-01**: SQL persistence adapters (Postgres/SQLite) — v0.2.0
- ✓ **PERS-02**: Pipeline checkpoint and resume — v0.2.0
- ✓ **PERS-03**: Human-in-the-loop pauses and resume — v0.2.0
- ✓ **DX-01**: Interactive dev chat via `bun run dev` — v0.2.0
- ✓ **OBS-01**: Structured observability hooks for agent runs — v0.2.0
- ✓ **OBS-02**: Evaluation and replay tooling for historical runs — v0.2.0
- ✓ **SAFE-01**: Intent-aware tool gating policies — v0.2.0
- ✓ **INTG-01**: MCP server integration for external tool discovery — v0.2.0
- ✓ **ROUT-04**: Routing explainability metadata (match scores, rationale) — v0.2.0

- ✓ **DX-02**: CLI/TUI-first developer workflow for Fred projects — v0.2.1
- ✓ **DX-03**: Project auto-detection and config validation in CLI startup — v0.2.1
- ✓ **DX-04**: Command parity between TUI and non-interactive CLI mode — v0.2.1
- ✓ **DX-05**: Extensible CLI plugin architecture for project-specific tooling — v0.2.1

- ✓ **VISUAL-01**: Centralized theme/palette system — v0.2.2
- ✓ **VISUAL-02**: Semantic color tokens — v0.2.2
- ✓ **VISUAL-03**: All TUI components use theme system — v0.2.2
- ✓ **VISUAL-04**: Contrast-based region separation (no box-drawing borders) — v0.2.2
- ✓ **VISUAL-05**: Background shade differentiation for sidebar/transcript/input — v0.2.2
- ✓ **VISUAL-06**: Borderless aesthetic with padding-based spacing — v0.2.2

### Active (v0.3.0)

- [ ] **EFCT-01**: Effect services are the primary implementations for all core subsystems
- [ ] **EFCT-02**: Fred class delegates to Effect services instead of imperative wrapper classes
- [ ] **EFCT-03**: Imperative wrapper classes removed (ToolRegistry, AgentManager, PipelineManager, ContextManager, HookManager, ProviderRegistry)
- [ ] **EFCT-04**: PipelineService stubs completed (V2 execution, resume, graph execution)
- [ ] **EFCT-05**: Consumers (dev-chat, CLI) updated to use Effect-based API
- [ ] **EFCT-06**: Public exports updated to remove imperative class exports

### Out of Scope

| Feature | Reason |
|---------|--------|
| Autonomous agents without guardrails | Unbounded cost and safety risk; prefer intent gating + HITL |
| Hidden tool calls by default | Reduces trust and debuggability; require explicit tool policies |
| Single mega-agent for all intents | Avoids specialization and undermines routing strategy |
| Always-on long-term memory | Privacy/cost risks; require explicit persistence adapter |
| AI SDK compatibility layer | Full migration to Effect complete; no backward compatibility needed |
| Mobile SDKs | Focus on framework core and server/library modes first |
| Non-TypeScript runtimes | Bun-compatible TypeScript is the target |

## Current State

**Shipped:** v0.2.2 (2026-02-22)
- 17/17 v0.2.2 requirements complete (VISUAL-01 through VISUAL-17)
- 4 phases delivered (37-40), 13 plans executed
- Centralized theme system, borderless contrast layout, collapsible sidebar
- TUI bug fixes: cursor blink, transcript flicker, /exit command

**Architecture:**
- Monorepo with Bun workspaces
- Effect-based internals with dual Promise/Effect APIs (v0.3.0 target: Effect-only)
- 5 built-in provider packs (OpenAI, Anthropic, Google, Groq, OpenRouter)
- SQL persistence (Postgres/SQLite)
- Checkpoint/resume with human-in-the-loop
- OTel-compatible observability
- Production-grade CLI (`fred run`, `fred init`, `fred list`, `fred config validate`)
- OpenTUI-based TUI with streaming, session management, and plugin architecture

**Next Milestone Goals (v0.3.0):**
- Eliminate dual imperative/Effect API surface (~3,000-4,000 lines of duplicated code)
- Make Effect services the primary and only implementations
- Rework Fred class to delegate to Effect services
- Complete PipelineService stubs
- Update all consumers (dev-chat, CLI) to Effect-based API

## Context

- Effect-based architecture with @effect/ai providers
- Monorepo: 8 packages with independent versioning via Changesets
- ~50,000 LOC TypeScript across packages
- Bun runtime with TypeScript project references
- CI/CD with automatic npm publishing via GitHub Actions
- v0.2.1 adds production-grade CLI/TUI with session management, plugin architecture, and comprehensive test hardening

## Constraints

- **Runtime**: Bun-compatible — project runs on Bun and Node
- **Language**: TypeScript-only — core library is TS-first
- **AI SDK**: Full Effect replacement — no Vercel AI SDK dependencies
- **Persistence**: In-memory by default; SQL optional — no persistence without explicit adapter

## Current Milestone: v0.3.0 Imperative-to-Effect Migration

**Goal:** Eliminate the dual imperative/Effect API surface by making Effect services the primary (and only) implementations, removing ~3,000-4,000 lines of duplicated wrapper code.

**Target features:**
- Effect services as sole implementations for all core subsystems
- Fred class reworked to delegate to Effect services via runtime
- Imperative wrapper classes removed (ToolRegistry, AgentManager, PipelineManager, etc.)
- PipelineService stubs completed with full working implementations
- All consumers (dev-chat, CLI) migrated to Effect-based API
- Clean public API surface with Effect-only exports

## Previous Milestone: v0.2.2 TUI Visual Polish

**Status:** Shipped 2026-02-22
**Archive:** `.planning/milestones/v0.2.2-ROADMAP.md`, `.planning/milestones/v0.2.2-REQUIREMENTS.md`

**Delivered:**
- Centralized theme/palette system with semantic color tokens
- Borderless contrast-based region separation
- Information-dense collapsible sidebar with hotkey/slash command toggle
- Muted assistant styling with inline expandable tool blocks
- Minimal input chrome and compact status bar badges
- Help modal, slash overlay, and badge dimming

<details>
<summary>Previous: v0.2.1 CLI/TUI Developer Experience</summary>

**Status:** Shipped 2026-02-16
**Archive:** `.planning/milestones/v0.2.1-ROADMAP.md`, `.planning/milestones/v0.2.1-REQUIREMENTS.md`

**Delivered:**
- Terminal foundation with Effect-based lifecycle management, TTY detection, graceful degradation
- High-performance streaming TUI with multi-pane layout, command palette, real-time telemetry
- Persistent session management with sidebar navigation, CLI list/show/export/delete, startup chooser
- Full CLI command suite: headless `fred run`, entity listing, config validation, init scaffolding
- Debugging commands for intent testing, route analysis, MCP server management
- Extensible plugin architecture with typed contract, CLI commands, TUI slash commands
- Runtime hardening: JSON channel consistency, terminal lifecycle wiring, Bun mock isolation

</details>

<details>
<summary>Previous: v0.2.0 Observability & Safety</summary>

**Status:** ✅ Shipped 2026-02-07
**Archive:** `.planning/milestones/v0.2.0-ROADMAP.md`, `.planning/milestones/v0.2.0-REQUIREMENTS.md`

**Delivered:**
- Structured observability with correlation context, token/cost metrics, and trace export
- Deterministic record/replay/compare/suite evaluation framework
- Intent-aware tool gating with audit hooks and HITL approvals
- MCP server lifecycle + tool/resource integration under safety policies
- Routing explainability with confidence alternatives and `fred.routing.explain()`

</details>

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Hybrid routing (rules + model fallback) | Explicit routing first, LLM fallback for flexibility | ✓ Good — Predictable with flexibility |
| Hybrid DX (config + programmatic API) | Support quick start and advanced overrides | ✓ Good — Both patterns well-used |
| Provider packs via Effect | Align provider integrations with Effect ecosystem | ✓ Good — 5 packs, clean abstractions |
| SQL support (Postgres + SQLite) | Cover production and local/dev needs | ✓ Good — Both adapters working |
| Effect Schema for tool validation | Better type safety and runtime validation | ✓ Good — All tools validated |
| Dual API (Promise + Effect) | Maintain Promise ease, offer Effect power | ⚠️ Revisit — v0.3.0 removes imperative layer |
| Independent versioning | Separate package evolution | ✓ Good — Flexible releases |
| Monorepo with Changesets | Version management and changelogs | ✓ Good — Automated publishing |
| OpenTUI for TUI framework | User preference; TypeScript-native terminal UI | ✓ Good — Full TUI shipped with @opentui/core |
| fred chat as primary interactive entry | Cleaner semantics; `fred` and `fred tui` as aliases | ✓ Good — Consistent launch contract |
| Plugin typed contract via entry point | Stable API surface for third-party extensions | ✓ Good — npm-compatible plugin loading |

| Effect-only API (removing Promise wrappers) | Dual API adds ~4k lines of duplication; Effect is proven stable | — Pending |

---
*Last updated: 2026-02-21 after v0.3.0 milestone start*
