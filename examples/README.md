# Fred Examples

A progressive learning path for Fred's v0.3 API, from a one-agent quickstart to production-oriented workflows.

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

## Learning Path

| # | Example | What You'll Learn |
| --- | --- | --- |
| 01 | [Quickstart: Single Agent](./01-quickstart-single-agent/) | Initialize `Fred`, register a provider, create one agent, and process your first message |
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

## Fred's Unique Capabilities Highlighted

- **Intent-based routing (Example 03):** Deterministic, explainable message routing before generation, with explicit matching behavior.
- **Pipeline checkpoint/resume (Example 05):** Built-in pause/resume orchestration for human-in-the-loop workflows.
- **22-hook middleware lifecycle (Example 07):** Fine-grained interception points across routing, tool calls, context, and pipelines.
- **Golden-trace evaluation (Example 09):** First-class local assertions against recorded traces without requiring external SaaS.

## Prerequisites

- [Bun](https://bun.sh)
- At least one model provider API key (examples commonly use `OPENAI_API_KEY`)
