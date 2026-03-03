# 01 - Quickstart: Single Agent

This example shows the fastest path to getting your first response with Fred using declarative agent files.

## What you'll learn

- `Fred.create()` to initialize the runtime
- Config-driven startup with `initializeFromConfig('./config.yaml')`
- Agent definition in `agents/assistant.md` with YAML frontmatter
- Message processing with `processMessage(...)`

## Prerequisites

- Bun installed
- OpenRouter API key

## Setup

```bash
cp .env.example .env
```

Then edit `.env` and set `OPENROUTER_API_KEY`.

## File layout

- `agents/assistant.md` defines the agent (content + frontmatter)
- `config.yaml` defines provider defaults and routing
- `src/index.ts` keeps runtime glue minimal

This is the recommended pattern: agents as markdown, config as YAML, tools/runtime behavior in TypeScript.

## Run

```bash
bun run start
```

## Expected output

A one-sentence explanation of TypeScript, for example:

```text
Response: TypeScript is a typed superset of JavaScript that adds static type checking for safer, more maintainable code.
```

## What to try next

See `02-tools-basics` for adding tool capabilities.
