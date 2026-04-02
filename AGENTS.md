# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Fred is a TypeScript framework for building AI agents with intent-based routing, multi-platform support, and pipeline orchestration. Built on Bun runtime using the Effect library for functional programming patterns and @effect/ai for AI provider integration.

This is a monorepo using Bun workspaces with packages in the `packages/` directory.

## Build & Test Commands

```bash
# Install dependencies
bun install

# Run development chat interface
bun run dev

# Run tests
bun test                              # All tests
bun test:unit                         # Unit tests only
bun test tests/unit/core/tool         # Tests matching pattern
bun test tests/unit/core/tool/registry.test.ts  # Single file

# Build
bun run build

# Run server
bun run server

# Documentation
bun run docs:dev   # Local server at localhost:8000
bun run docs:build
```

## Monorepo Structure

```
packages/
├── core/               # Core framework (@fred/core)
│   └── src/
│       ├── agent/          # Agent creation and management
│       ├── config/         # YAML/JSON config loading
│       ├── context/        # Conversation history storage (sqlite/postgres)
│       ├── effect/         # Effect services and layers
│       ├── eval/           # Evaluation and testing framework
│       ├── hooks/          # Pipeline lifecycle hooks
│       ├── intent/         # Intent matching and routing
│       ├── mcp/            # Model Context Protocol client
│       ├── message-processor/  # Message processing pipeline
│       ├── observability/  # Metrics and monitoring
│       ├── pipeline/       # Pipeline execution, checkpoints, graph workflows
│       ├── platform/       # AI provider registry and packs
│       ├── provider/       # Provider service
│       ├── routing/        # Rule-based message routing
│       ├── stream/         # Streaming event types
│       ├── tool/           # Tool registry and validation
│       ├── tool-gate/      # Tool execution gating
│       ├── tracing/        # OpenTelemetry integration
│       ├── utils/          # Validation, utilities
│       ├── variables/      # Variable substitution and tools
│       └── workflow/       # Multi-workflow management
├── cli/                # CLI and TUI (@fred/cli)
├── dev/                # Development server and chat UI
├── provider-openai/    # OpenAI provider
├── provider-anthropic/ # Anthropic provider
├── provider-google/    # Google provider
├── provider-groq/      # Groq provider
└── provider-openrouter/ # OpenRouter provider
```

## Core Architecture

### Core Concepts

- **Fred**: Main orchestrator class (`packages/core/src/index.ts`) - manages agents, pipelines, routing, and context
- **Agents**: AI-powered entities with system prompts and tools (`packages/core/src/agent/`)
- **Pipelines**: Sequential/graph-based agent orchestration with checkpointing (`packages/core/src/pipeline/`)
- **Intents**: Message routing based on exact/regex/semantic matching (`packages/core/src/intent/`)
- **Tools**: Reusable functions agents can call (`packages/core/src/tool/`). Includes built-in tools (calculator) and support for custom tools
- **Built-in Tools**: Production-ready tools available out-of-the-box:
  - Calculator tool (`createCalculatorTool()` from `packages/core/src/tool/calculator.ts`) - Safe arithmetic evaluation
- **Providers**: AI platform integrations via Effect provider packs (`packages/core/src/platform/`)

### Key Patterns

**Effect-based AI Providers**: All AI operations use Effect for error handling and dependency injection:
```typescript
// Providers return Effect-wrapped models
const modelEffect = provider.getModel(config.model, { temperature: 0.7 });
const model = await Effect.runPromise(modelEffect);
```

**Effect Runtime Boundary Pattern**: A runtime boundary is where Effect programs are converted to Promises via `Effect.runPromise` or `Runtime.runPromise`.
- Acceptable boundaries:
  - Application entry points (CLI command handlers, server startup)
  - Fred public API methods in `packages/core/src/index.ts` (single consumer boundary)
  - Infrastructure/runtime factories such as `packages/core/src/services.ts`
- Not acceptable:
  - Core business logic services calling `Effect.runPromise` internally
  - Helper functions that contain domain logic and should stay pure Effect
  - Error recovery built around `try/catch` at runPromise call sites instead of Effect error composition (`Effect.catchTag`, `Effect.catchAll`)
- Known pre-existing exceptions are tracked in `tests/unit/core/migration/phase-44-boundary-guard.test.ts` and are explicitly audited for future cleanup.
- Enforcement is automated: the boundary guard test fails if new `Effect.runPromise`/`Runtime.runPromise` usage appears outside approved boundary/exception files.

**Message Normalization**: Messages use `@effect/ai` Prompt encoding (`Prompt.MessageEncoded`). Normalize via `packages/core/src/messages.ts`:
```typescript
import { normalizeMessage, normalizeMessages } from '@fred/core/messages';
```

**Provider Registry**: Providers register via packs in `packages/core/src/platform/packs/`. Each pack exports an `EffectProviderFactory`:
```typescript
// Built-in packs: openai, anthropic, google, groq, openrouter
import { BUILTIN_PACKS } from '@fred/core/platform/packs';
```

**Pipeline Context**: Pipelines share state through `PipelineContext` with checkpoint support for pause/resume.

**Tool Schema Formats**: Tools support two schema formats:
- **Effect Schema format (recommended)**: Uses `schema` property with Effect Schema definitions for better type safety
- **Legacy parameters format**: Uses `parameters` property with JSON Schema
```typescript
// Effect Schema format (used by built-in tools)
import { Schema } from 'effect';
const tool: Tool = {
  schema: {
    input: Schema.Struct({ expression: Schema.String }),
    success: Schema.String,
    metadata: { /* JSON Schema for AI */ }
  },
  // ...
};

// Legacy format (still supported)
const tool: Tool = {
  parameters: {
    type: 'object',
    properties: { /* ... */ }
  },
  // ...
};
```

## Development Guidelines

### Adding a New AI Provider

1. Create pack in `packages/core/src/platform/packs/yourprovider.ts`
2. Export `EffectProviderFactory` with `id`, `aliases`, `createDefinition`
3. Register in `packages/core/src/platform/packs/index.ts`

### Testing

- Tests are in `tests/unit/` and mirror the packages structure
- Use mocks from `tests/unit/helpers/` for agents, providers, storage
- Only test deterministic behavior - mock AI calls
- Package tests can also be co-located in `packages/<name>/tests/`

### Examples Must Stay Green

The `examples/` directory contains 12 progressive, self-contained examples that form a learning path. These are tested by a guard test (`tests/unit/examples/examples-guard.test.ts`) that runs in CI via `bun test`.

**Policy:** Any phase that changes Fred's public API, types, or package exports must verify examples still typecheck. The guard test enforces:
- All example `src/` files typecheck
- Every example has required structure (`package.json`, `README.md`, `src/`, `.env.example`)
- All examples import from `@fancyrobot/fred` (not relative paths)

If your change breaks an example, fix the example in the same commit/phase — do not leave broken examples for a future phase.

### Config Files

Fred supports YAML/JSON config (`loadConfig` from `packages/core/src/config/loader.ts`):
- Agents, intents, pipelines, tools, routing rules
- Provider declarations with model defaults
- Persistence (sqlite/postgres) and observability settings

### Environment Variables

Key provider API keys (auto-detected in dev-chat):
- `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`
- `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY`
- `FRED_POSTGRES_URL` or `FRED_SQLITE_PATH` for persistence

## Skill Usage

This repository uses specialized skills. When working here, always prefer using a relevant skill before ad-hoc implementation.

### Skill Usage Rule

- Before starting work, quickly classify the task (TUI, Effect, docs lookup, architecture, etc.).
- If a matching skill exists, use it first.
- If multiple skills apply, use the most specific one first, then supporting skills.
- Document in your response which skill(s) you used and why.

**Mandatory for all code changes:** This project is built entirely on Effect. Always use the `effect-ts` and `effect-best-practices` skills when making any code changes — not just Effect-specific tasks. These skills ensure correct service/layer patterns, proper error modeling, idiomatic Effect usage, and prevent anti-patterns from being introduced.

### Primary Skills For This Project

#### `opentui`

Use for terminal UI work in CLI/TUI features, including:
- Layout and pane composition
- Keyboard handling and focus management
- Streaming UI updates and rendering behavior
- TUI component patterns and testing

#### `effect-ts`

Use for Effect-based TypeScript implementation, including:
- Services, Layers, and dependency wiring
- Effect runtime usage and structured error handling
- Stream and concurrency primitives
- Correct API usage for current Effect versions

#### `effect-best-practices`

Use as a guardrail whenever writing or reviewing Effect code, especially:
- Service/tag design
- Error modeling and typed failures
- Layer composition and modular boundaries
- Avoiding anti-patterns in Effect-based code

### Supporting Skills Also Relevant Here

#### `context7`

Use for up-to-date documentation checks when integrating or validating:
- Effect ecosystem packages
- Bun/platform APIs
- TUI libraries and related dependencies

#### `prompt-engineering-patterns`

Use when editing system prompts, agent instructions, or routing prompt templates to improve:
- Reliability
- Controllability
- Output consistency

#### `architecture-patterns`

Use for larger refactors or new subsystems that benefit from:
- Clean architecture boundaries
- Domain modeling clarity
- Maintainable service decomposition

#### `sql-optimization-patterns`

Use when working on persistence/query performance areas (SQLite/Postgres), including:
- Slow query analysis
- Index strategy
- Schema/query optimization

#### `resolve-conflicts`

Use immediately when merge conflicts appear. Do not resolve conflicts ad-hoc first.

### Practical Selection Cheatsheet

- TUI or keyboard UX change -> `opentui`
- Effect service/layer/stream change -> `effect-ts` + `effect-best-practices`
- Library/API uncertainty -> `context7`
- Prompt/routing behavior tuning -> `prompt-engineering-patterns`
- Cross-module design/refactor -> `architecture-patterns`
- DB perf issue -> `sql-optimization-patterns`
- Merge conflict work -> `resolve-conflicts`

### Default Workflow Expectation

1. Identify applicable skill(s)
2. Load and apply skill guidance
3. Implement change
4. Validate with tests/typecheck
5. Report what skill(s) were applied

<!-- agent-vault:start -->

## Agent Vault

This project uses [Agent Vault](https://github.com/fancyrobot/agent-vault) for durable project memory. The vault lives at `.agent-vault/` and is managed through MCP tools — do not edit vault files directly unless you understand the mutation rules.

### Quick Start

1. Read `.agent-vault/00_Home/Active_Context.md` to understand current focus, blockers, and critical bugs.
2. Follow links outward to the relevant step, phase, and architecture notes.
3. Use the MCP tools below to create and update notes safely.

### MCP Tools

The following tools are available when the `agent-vault` MCP server is running:

| Tool | Purpose |
|------|---------|
| `vault_init` | Initialize the vault (already done for this project) |
| `vault_scan` | Scan project and return structured metadata |
| `vault_create` | Create notes: phase, step, session, bug, decision |
| `vault_traverse` | Load connected notes via graph traversal (use for context) |
| `vault_mutate` | Update frontmatter or append to heading sections |
| `vault_refresh` | Rebuild index tables and active context |
| `vault_validate` | Check vault integrity (frontmatter, structure, links, orphans) |
| `vault_help` | Show detailed help for any vault command |

### Workflow

- **Before work**: Read Active Context, identify the relevant step, create a session note.
- **During work**: Append to session logs, create bug/decision notes as needed, keep links current.
- **After work**: Update step snapshots, refresh indexes, leave the vault coherent.

### Rules

- Use bounded mutations only (frontmatter updates, section appends, generated block replacements).
- Do not rewrite entire notes or delete human-authored content.
- Do not load the entire vault into context — use `vault_traverse` for targeted graph loading.
- See `.agent-vault/AGENTS.md` for the full operating contract.

<!-- agent-vault:end -->
