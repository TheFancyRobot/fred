# Fred Examples

A progressive learning path for Fred's `createFred()` API, from a one-agent
quickstart to production-oriented workflows. For legacy facade migrations, see
the [Phase 68 migration guide](../MIGRATION.md).

## Getting Started

1. Install dependencies from the repository root:

   ```bash
   bun install
   ```

2. Pick an example and set its environment variables:

   ```bash
   cd examples/01-quickstart-single-agent
   cp .env.example .env
   ```

3. Add your API key(s) to `.env` and run the example:

    ```bash
    bun run start
    ```

## Agent File Pattern (.md + YAML Frontmatter)

Examples 01-13 define agents in `src/agents/*.md` files with YAML frontmatter
and a markdown prompt body. Example 14 uses the scoped `createFred()` client and
loads its markdown prompt explicitly; Example 15 keeps its deterministic
workflow transport independent of agent initialization. Both keep the optional
HTTP boundary explicit.

- Agent config lives in frontmatter (`id`, `platform`, `model`, `tools`, `utterances`, etc.)
- Agent behavior/prompt content lives in the markdown body
- Runtime logic stays in TypeScript (`src/*.ts`) for tools, hooks, pipelines, and orchestration
- Declarative wiring lives in `config.yaml` and is loaded with `initializeFromConfig()`
- Every example uses OpenRouter with the free default model `openrouter/free` (`OPENROUTER_API_KEY`)

This keeps examples consistent with Fred's declarative-by-default pattern: agents as content, config as declaration, tools/runtime behavior as code.

## Learning Path

| # | Example | What You'll Learn |
| --- | --- | --- |
| 01 | [Quickstart: Single Agent](./01-quickstart-single-agent/) | Initialize a `FredClient`, load one markdown-defined agent from config, and process your first message |
| 02 | [Tools: Registration & Invocation](./02-tools-basics/) | Register built-in and custom tools (Effect Schema format) and let agents invoke them |
| 03 | [Intent Routing](./03-intent-routing-basics/) | Route messages to specialist agents with explicit intent matching and transcript-style routing output |
| 04 | [Dynamic Handoff](./04-dynamic-handoff/) | Perform tool-based intake -> specialist handoff with bidirectional transfer and shared conversation context |
| 05 | [Pipeline: Sequential](./05-pipeline-sequential/) | Build V2 step pipelines with mixed step types, pause for human input, and resume from checkpoints |
| 06 | [Pipeline: Graph Workflow](./06-pipeline-graph-workflow/) | Model branching DAG workflows with conditional/default edges and merge synthesis nodes |
| 07 | [Hooks & Middleware](./07-hooks-and-middleware/) | Intercept and mutate lifecycle data with redaction, policy injection, and structured middleware logs |
| 08 | [Observability & Tracing](./08-observability-tracing/) | Start with hook-based tracing and optionally wire OpenTelemetry export layers |
| 09 | [Evaluation Harness](./09-evaluation-harness-golden-traces/) | Run golden-trace assertions for routing, responses, tool calls, checkpoints, and schema behavior |
| 10 | [Config-Driven YAML](./10-config-driven-yaml/) | Compare declarative `config.yaml` setup with equivalent programmatic Fred API wiring |
| 11 | [MCP Integration](./11-mcp-integration/) | Connect MCP servers, auto-discover MCP tools, and handle disconnected server states safely |
| 12 | [CLI & TUI](./12-cli-and-tui/) | Use `fred chat` and `fred run` for interactive and headless config-driven workflows |
| 13 | [Multi-Agent Workflows](./13-multi-agent-workflows/) | Combine a concierge, research swarm, notebook memory, and daily brief workflows for everyday tasks |
| 14 | [Optional HTTP Layer](./14-http-layer/) | Add an opt-in HTTP server with auth, CORS, admin/docs routes, sessions, SSE, and OpenAI SDK compatibility |
| 15 | [HTTP Workflows](./15-http-workflows/) | Expose typed JSON and SSE workflows with default/custom paths, scoped API keys, OpenAPI, CORS, and limits |

## Fred's Unique Capabilities Highlighted

- **Intent-based routing (Example 03):** Deterministic, explainable message routing before generation, with explicit matching behavior.
- **Pipeline checkpoint/resume (Example 05):** Built-in pause/resume orchestration for human-in-the-loop workflows.
- **22-hook middleware lifecycle (Example 07):** Fine-grained interception points across routing, tool calls, context, and pipelines.
- **Golden-trace evaluation (Example 09):** First-class local assertions against recorded traces without requiring external SaaS.
- **Coordinator + worker orchestration (Example 13):** Parallel sub-agent research, notebook memory, and reusable daily brief flows in one workspace.
- **Optional HTTP boundary (Example 14):** Keep `createFred()` core-only while adding a secured, observable HTTP API explicitly with `withHttp()`.
- **Declarative workflow HTTP (Example 15):** Snapshot typed workflows into JSON/SSE endpoints with explicit exposure and scoped authorization.

## ETA Template Coverage

ETA templating is demonstrated across the learning path where it fits naturally:

- **Loops + expressions:** Example 04 (`<% for %>`, `<%= %>`) with runtime data from `addTemplateContext('departments', ...)` consumed as `it.departments.available`
- **Conditionals + partials + per-message vars:** Example 07 (`<% if %>`, `<%~ include %>`, `session.*` via `addTemplateContext`)
- **Expressions + env access:** Example 08 (`<%= %>`, `env.*`)

Together these examples cover all six ETA features used by Fred agent templates: expressions, conditionals, loops, partials, environment variables, and per-message variables.

## Prerequisites

- [Bun](https://bun.sh)
- OpenRouter API key (`OPENROUTER_API_KEY`)
