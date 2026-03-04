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
- 🔄 **v0.3.0 Imperative-to-Effect Migration** — Phases 41-49 (incl. 45.1, 45.2, 46.1, 46.2)

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
**Plans**: 4 plans
**Success Criteria** (what must be TRUE):
  1. `PipelineService.executeV2Pipeline` executes V2 pipelines to completion through Effect (no `Effect.fail("not yet migrated")` stub)
  2. `PipelineService.resume` and `PipelineService.resumeWithHumanInput` restore checkpoint state and continue execution through Effect
  3. PipelineService has zero imports from `pipeline/manager.ts` — all 1,062 lines of PipelineManager orchestration logic are ported
  4. MessageProcessorService processes and streams messages without delegating to imperative `MessageProcessor` methods
  5. Pipeline and message processing tests pass against the standalone services

Plans:
- [x] 42-01-PLAN.md — Cut over PipelineService executePipelineV2 and remove manager type coupling
- [x] 42-02-PLAN.md — Implement standalone resume and resumeWithHumanInput state machine semantics
- [x] 42-03-PLAN.md — Harden MessageProcessorService streaming and route failure contracts
- [x] 42-04-PLAN.md — Add migration guard/integration checks and finalize Phase 42 verification suite

### Phase 43: Fred Class Migration
**Goal**: The Fred class facade constructs and delegates to the Effect runtime instead of imperative manager instances, becoming a thin Effect-backed API surface
**Depends on**: Phase 42 (Fred delegates to all services; they must be standalone first)
**Requirements**: FRED-01, FRED-02, FRED-03, FRED-04, FRED-05, FRED-06, FRED-07, FRED-08, FRED-09
**Plans**: 6 plans
**Success Criteria** (what must be TRUE):
  1. Fred manages an Effect runtime lifecycle with composed service Layers (constructor prepares state, `ensureRuntime()` builds runtime from layers, `Fred.create()` eagerly initializes) instead of instantiating imperative classes
  2. `fred.processMessage()` and `fred.streamMessage()` delegate to MessageProcessorService via `Runtime.runPromise` at the boundary (runtime-scoped execution)
  3. `fred.routeMessage()`, `fred.executePipeline()`, `fred.registerAgent()`, `fred.registerTool()`, and `fred.setToolPolicies()` all delegate to their respective Effect services
  4. Fred class source has zero imports of ToolRegistry, AgentManager, PipelineManager, ContextManager, HookManager, ProviderRegistry, or MessageRouter
  5. All existing integration and smoke tests that use the Fred class continue to pass

Plans:
- [x] 43-01-PLAN.md — Add migration guardrails and Fred facade delegation tests
- [x] 43-02-PLAN.md — Cut over Fred constructor/runtime lifecycle to Effect-first composition
- [x] 43-03-PLAN.md — Migrate required Fred method delegation to Effect services and remove forbidden imports
- [x] 43-04-PLAN.md — Adapt initializer/routing compatibility seams and run final Phase 43 verification suite
- [x] 43-05-PLAN.md — Close verification gaps: align success criteria with intentional design and add contract tests
- [x] 43-06-PLAN.md — Close UAT gap: fix pre-runtime getContextManager and setStorage for consumer compatibility

### Phase 44: Imperative Layer Removal & Consumer Migration
**Goal**: All imperative manager classes are deleted from the codebase and all consumers (dev-chat, CLI) are migrated to the Effect-based API
**Depends on**: Phase 43 (Fred and all services must be Effect-only before deletion is safe)
**Requirements**: RMVL-01, RMVL-02, RMVL-03, RMVL-04, RMVL-05, RMVL-06, RMVL-07, RMVL-08, CONS-01, CONS-02, CONS-03, CONS-04
**Plans**: 13 plans
**Success Criteria** (what must be TRUE):
  1. Files `tool/registry.ts`, `agent/manager.ts`, `pipeline/manager.ts`, `context/manager.ts`, `hooks/manager.ts`, and `platform/registry.ts` are deleted from the repository
  2. `message-processor/processor.ts` has no remaining Promise-wrapper methods (`processMessage`, `routeMessage`, `streamMessage` imperative variants removed)
  3. `grep -r "new ToolRegistry\|new AgentManager\|new PipelineManager\|new ContextManager\|new HookManager\|new ProviderRegistry" packages/` returns zero matches
  4. `dev-chat.ts`, `chat.ts`, and `run.ts` interact with Fred via Effect-based API — no direct imperative manager access
  5. `Effect.runPromise` / `Effect.runFork` calls appear only at application boundaries (entry points), not scattered through business logic

Plans:
- [x] 44-01-PLAN.md — Migrate CLI consumers (chat.ts, session.ts, eval.ts, tui/session.ts) to Fred public API
- [x] 44-02-PLAN.md — Migrate dev-chat consumers (dev-chat.ts, server/app.ts, handlers.ts) to structural interfaces
- [x] 44-03-PLAN.md — Remove MessageProcessor Promise wrappers and decouple AgentFactory from ToolRegistry class
- [x] 44-04-PLAN.md — Clean internal references (executor, graph-executor, router, pipeline/service) from manager types
- [x] 44-05-PLAN.md — Create safety tag, delete 8 imperative files, clean exports.ts
- [x] 44-06-PLAN.md — Create boundary guard tests and run Phase 44 verification suite
- [x] 44-07-PLAN.md — Delete 8 obsolete test files, fix 3 targeted tests, remove git tag, fix server display
- [x] 44-08-PLAN.md — Migrate 4 agent factory tests from ToolRegistry to ToolRegistryLike mocks
- [x] 44-09-PLAN.md — Migrate 4 remaining tests (executor, tracing, workflow, gating) to structural mocks
- [x] 44-10-PLAN.md — Remove stale pipeline/manager re-export from barrel file
- [x] 44-11-PLAN.md — Delete dead MessageProcessor class and clean barrel re-export
- [ ] 44-12-PLAN.md — Add Fred public context methods and migrate CLI consumers off getContextManager
- [ ] 44-13-PLAN.md — Migrate dev consumers off getContextManager and remove proxy from Fred

### Phase 45: Public API Surface & Verification
**Goal**: The public API exports only Effect services, the Layer composition is complete, breaking changes are documented, and the full test suite passes cleanly
**Depends on**: Phase 44 (all imperative code removed; consumers migrated)
**Requirements**: API-01, API-02, API-03, API-04, TEST-01, TEST-02, TEST-03, TEST-04
**Plans**: 3 plans
**Success Criteria** (what must be TRUE):
  1. `exports.ts` no longer exports ToolRegistry, AgentManager, ContextManager, HookManager, or MessageRouter — only Effect service tags
  2. `services.ts` provides a single composable Layer that wires all services for consumer dependency injection
  3. `bun run build` succeeds with zero TypeScript errors introduced by the migration
  4. `bun test` passes with no regressions — all unit tests updated to use Effect services where needed
  5. CHANGELOG documents the breaking changes: removed imperative classes, new Effect-only API surface, migration guidance
  6. Pre-existing LSP errors (Effect yield errors in index.ts, tracing import errors, config/initializer reference) are resolved or explicitly documented

Plans:
- [x] 45-01-PLAN.md — Create WorkflowService, clean imperative exports, add missing service tag re-exports
- [x] 45-02-PLAN.md — Add sub-path exports (eval, context, tools), update package.json, migrate consumer imports
- [x] 45-03-PLAN.md — Create v0.3.0 changeset, fix type errors, run full verification sweep

### Phase 45.1: Combine Assistant Config and Prompt into Single Markdown File with YAML Frontmatter (INSERTED)

**Goal:** Introduce a new agent definition format where a single `.md` file per agent contains YAML frontmatter (configuration) and a markdown body (system prompt), with file discovery, validation, coexistence with existing agent sources, and hot reload support
**Depends on:** Phase 45
**Requirements**: MDAGENT-01, MDAGENT-02, MDAGENT-03, MDAGENT-04, MDAGENT-05, MDAGENT-06
**Plans**: 3 plans
**Success Criteria** (what must be TRUE):
  1. `.md` files with YAML frontmatter (id, platform, model) are parsed into valid AgentConfig objects
  2. Agent directories are scanned recursively, with `./agents/` as the default convention
  3. `.md` agents are loaded before config-defined agents during startup, with duplicate ID detection across all sources
  4. Config-referenced `.md` files with frontmatter are detected as ambiguous and rejected
  5. File watcher provides hot reload during development with debounced change detection
  6. All tests pass and build succeeds

Plans:
- [x] 45.1-01-PLAN.md — Core agent file loader: parsing, validation, discovery, and unit tests
- [x] 45.1-02-PLAN.md — Config integration: extend FrameworkConfig, wire into ConfigInitializer, coexistence validation
- [x] 45.1-03-PLAN.md — Hot reload file watcher with debounced agent replacement

### Phase 45.2: Implement ETA for Templating Agent Prompts and Frontmatter (INSERTED)

**Goal:** Replace the simple `{{ var }}` template substitution system with ETA (a lightweight JavaScript templating engine) for processing agent prompts and frontmatter values, with two-phase resolution (frontmatter at load-time, body per-message), security restrictions, partials support, hot-reload integration, a CLI validate command, and exported test utilities
**Depends on:** Phase 45.1
**Plans:** 3 plans
**Success Criteria** (what must be TRUE):
  1. ETA templates with conditionals, loops, expressions, and partials work in agent `.md` files, config agents, and programmatic agents
  2. Frontmatter ETA expressions resolve at load time; body ETA expressions resolve per-message with current variable values
  3. Security restrictions prevent template access to dangerous globals; env vars filtered through configurable allowlist
  4. Hot reload of partial files invalidates template cache for all agents
  5. `fred validate` CLI command compiles all agent templates without starting Fred
  6. Old `{{ var }}` template system (`resolveTemplate`) is completely removed
  7. All tests pass with no regressions

Plans:
- [x] 45.2-01-PLAN.md — Core template engine module: ETA wrapper, typed errors, security, context builders, unit tests
- [x] 45.2-02-PLAN.md — Integration: wire into file-loader and factory, remove old template system, extend config, Fred class API
- [x] 45.2-03-PLAN.md — Hot reload partial watching, CLI validate command, exported test utilities, full verification

### Phase 46: Showcase Examples & Framework Differentiation
**Goal**: Delete existing examples and replace with 12 progressive examples that form a learning path — from quickstart to evaluation harness. Each example demonstrates a distinct Fred capability (intent routing, pipelines, hooks, MCP, config-driven agents, etc.) using the v0.3.0 Effect-based public API. Research competing frameworks to ensure examples highlight differentiators.
**Depends on**: Phase 45.2 (examples must use the final public API surface)
**Plans**: 11 plans

Plans:
- [x] 46-01-PLAN.md — Delete old examples, configure workspace, create guard test scaffold
- [x] 46-02-PLAN.md — API prerequisites: Fred pipeline V2, graph workflow methods, hook queuing, re-exports
- [x] 46-03-PLAN.md — Examples 01-03: quickstart, tools, intent routing
- [x] 46-03b-PLAN.md — Examples 02-03: tools and intent routing (split from 46-03)
- [x] 46-04-PLAN.md — Examples 04-05: dynamic handoff, pipeline sequential
- [x] 46-05-PLAN.md — Examples 06-07: graph workflow, hooks and middleware
- [x] 46-06-PLAN.md — Examples 08-09: observability tracing, evaluation harness
- [x] 46-07-PLAN.md — Examples 10-12: config-driven YAML, MCP integration, CLI and TUI
- [x] 46-07b-PLAN.md — Examples 11-12: MCP integration, CLI and TUI (split from 46-07)
- [x] 46-08-PLAN.md — Top-level README, guard test finalization, full verification
- [x] 46-09-PLAN.md — Gap closure: enforce per-example TypeScript compile checks in examples guard

### Phase 46.1: Refactor Examples to Use .md Agent Definitions & ETA Templates (INSERTED)

**Goal:** Refactor all 12 examples to use the new `.md` file agent definitions (from Phase 45.1) and ETA templating (from Phase 45.2). Every example should define agents via `.md` files with YAML frontmatter instead of inline programmatic definitions. All relevant ETA features (conditionals, loops, expressions, partials, env vars, per-message variables) should be demonstrated at least once across the full example set.
**Depends on:** Phase 46 (examples must exist before refactoring them)
**Plans**: 5 plans
**Success Criteria** (what must be TRUE):
  1. All 12 examples define their agents using `.md` files with YAML frontmatter and markdown body system prompts
  2. No example uses inline string system prompts for agent definitions — all agent prompts live in `.md` files
  3. ETA template features are demonstrated across the examples: conditionals (`<% if %>`), loops (`<% for %>`), expressions (`<%= %>`), partials, env var access, and per-message variable resolution
  4. Each ETA feature is exercised by at least one example, with the full feature set covered across all 12
  5. Examples still pass the guard test (`examples-guard.test.ts`) including structure, import-policy, and compile checks
  6. `bun test` and `bun run build` pass with no regressions

Plans:
- [x] 46.1-01-PLAN.md — Migrate Examples 01-04: quickstart, tools, intent routing, dynamic handoff
- [x] 46.1-02-PLAN.md — Migrate Examples 05-08: pipeline, graph workflow, hooks (ETA conditionals+partials), observability (ETA expressions+env vars)
- [x] 46.1-03-PLAN.md — Migrate Examples 09-12: eval harness, config-driven, MCP, CLI/TUI
- [x] 46.1-04-PLAN.md — Final verification: guard test, full test suite, build, ETA coverage check, README update
- [x] 46.1-05-PLAN.md — Gap closure: add per-message variable injection demo to Example 07

### Phase 46.2: Gap Closure — Agents Convention & Anti-Pattern Fix (INSERTED)

**Goal:** Fix Example 04 anti-pattern (hardcoded inline array in ETA loop) and migrate all examples from root-level `agents/` to `src/agents/` to match TypeScript developer expectations.
**Depends on:** Phase 46.1
**Plans:** 4 plans
**Success Criteria** (what must be TRUE):
  1. Example 04 uses `addTemplateContext('departments', ...)` instead of hardcoded inline array
  2. Default convention in initializer.ts checks `./src/agents` before `./agents`
  3. All 12 examples have agents in `src/agents/` directory
  4. No root-level `agents/` directories remain in examples
  5. All tests pass, build succeeds

Plans:
- [x] 46.2-01-PLAN.md — Fix Example 04 anti-pattern, update default convention, remove README justification
- [x] 46.2-02-PLAN.md — Migrate examples 01-04 from agents/ to src/agents/
- [x] 46.2-03-PLAN.md — Migrate examples 05-08 from agents/ to src/agents/
- [x] 46.2-04-PLAN.md — Migrate examples 09-12 and run full verification

### Phase 48: Effect Boundary Migration — Eliminate Non-Boundary runPromise/runFork (GAP CLOSURE)

**Goal:** Remove all non-boundary `Effect.runPromise`/`Effect.runFork` calls from core business logic, satisfying CONS-04 fully. Compose observability annotations, agent calls, and storage access into Effect pipelines instead of fire-and-forget side-effects. Update boundary guard test to enforce zero exceptions.
**Depends on:** Phase 47
**Requirements:** CONS-04
**Gap Closure:** Closes gap from v0.3.0 audit
**Plans:** 4 plans

Plans:
- [x] 48-01-PLAN.md — Rename and extend boundary guard test (runFork detection, comment fix)
- [x] 48-02-PLAN.md — Convert checkpoint/pause trace() to Effect combinators
- [x] 48-03-PLAN.md — Convert executor.ts to ExecutorService (full Effect)
- [x] 48-04-PLAN.md — Convert graph-executor.ts to GraphExecutorService, wire PipelineService

### Phase 47: Update Package READMEs

**Goal:** Extract package-specific documentation from the root README and move it into dedicated README files at the root of each package (core, cli, dev, provider-openai, provider-anthropic, provider-google, provider-groq, provider-openrouter). The root README should link to package READMEs for details. No implementation changes — documentation only.
**Depends on:** Phase 46.2
**Plans:** 2 plans

Plans:
- [x] 47-01-PLAN.md — Create provider and core package READMEs
- [x] 47-02-PLAN.md — Slim root README and update dev README

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
    ↓
Phase 45.1 (Config+Prompt Markdown) ← INSERTED
    ↓
Phase 45.2 (ETA for Templating Prompts) ← INSERTED
    ↓
Phase 46 (Showcase Examples)
    ↓
Phase 46.1 (Refactor Examples: .md Agents + ETA) ← INSERTED
    ↓
Phase 46.2 (Gap Closure: Agents Convention) ← INSERTED
    ↓
Phase 47 (Update Package READMEs)
    ↓
Phase 48 (Effect Boundary Migration — Gap Closure) ← GAP CLOSURE
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
| FRED-01 | 43 | 6/6 | Complete   | 2026-03-01 | 43 | processMessage → Effect |
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
| CONS-04 | 48 | Effect.runPromise/runFork at boundaries only (gap closure) |
| API-01 | 45 | 5/5 | Complete    | 2026-03-01 | 45 | exports.ts exports Effect service tags |
| API-03 | 45 | services.ts Layer provides all services |
| API-04 | 45 | Breaking changes in CHANGELOG |
| TEST-01 | 45 | All unit tests pass |
| TEST-02 | 45 | Build succeeds, zero new TS errors |
| TEST-03 | 45 | bun test passes, no regressions |
| TEST-04 | 45 | Pre-existing LSP errors resolved or documented |
| MDAGENT-01 | 45.1 | Parse .md files with YAML frontmatter into AgentConfig |
| MDAGENT-02 | 45.1 | Discover agent .md files from agentDirs recursively |
| MDAGENT-03 | 45.1 | Integrate agent file loading into ConfigInitializer startup |
| MDAGENT-04 | 45.1 | Coexistence validation (duplicate IDs, ambiguous .md files) |
| MDAGENT-05 | 45.1 | Hot reload via file watcher with debounce |
| MDAGENT-06 | 45.1 | Extend FrameworkConfig with agentDirs field |

**Coverage:**
- Total requirements: 47
- Mapped: 47
- Unmapped: 0

---

## Progress

**Execution Order:** 41 → 42 → 43 → 44 → 45 → 45.1 → 45.2 → 46 → 46.1 → 46.2 → 47 → 48

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 41. Leaf Service Independence | 5/5 | Complete | 2026-02-28 |
| 42. Pipeline & MessageProcessor Completion | 4/4 | Complete | 2026-02-28 |
| 43. Fred Class Migration | 6/6 | Complete | 2026-03-01 |
| 44. Imperative Layer Removal & Consumer Migration | 13/13 | Complete | 2026-03-01 |
| 45. Public API Surface & Verification | 3/3 | Gaps found | — |
| 45.1. Config+Prompt Markdown (INSERTED) | 3/3 | Complete | 2026-03-01 |
| 45.2. ETA for Templating Prompts (INSERTED) | 3/3 | Complete | 2026-03-02 |
| 46. Showcase Examples & Framework Differentiation | 11/11 | Complete | 2026-03-03 |
| 46.1. Refactor Examples: .md Agents + ETA (INSERTED) | 5/5 | Complete | 2026-03-03 |
| 46.2. Gap Closure: Agents Convention (INSERTED) | 4/4 | Complete | 2026-03-04 |
| 47. Update Package READMEs | 2/2 | Complete | 2026-03-04 |
| 48. Effect Boundary Migration (Gap Closure) | 4/4 | Complete | 2026-03-04 |

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

### Phase 49: Peripheral Boundary Migration (GAP CLOSURE)

**Goal:** Eliminate remaining non-boundary `runPromise`/`runFork` calls from peripheral modules (eval, hooks, MCP). Clean up doc-only false positives in observability and effect modules. Add CLI boundary guard. Finalize boundary guard test to zero known exceptions.
**Depends on:** Phase 48
**Requirements:** CONS-04
**Gap Closure:** Completes CONS-04 boundary cleanup started in Phase 48
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd:plan-phase 49 to break down)

---

*Last updated: 2026-03-04 — Phase 48 verified complete (4/4 plans, 6/6 must-haves); Phase 49 queued for peripheral boundary migration.*
