# 02 - Tools: Registration & Invocation

This example shows how to define and register tools in Fred, then let an agent invoke them during normal prompt handling.

## What you'll learn

- Define a custom tool with the Effect Schema format (`schema.input`, `schema.success`, `schema.metadata`)
- Register tools with `await fred.tools.register(...)`
- Use the built-in `calculator` tool plus a custom `get-weather` tool
- Keep agents declarative in `agents/tool-user.md` and load with `initializeFromConfig()`

## Why Effect Schema format

Fred supports two tool schema styles:

- Recommended: Effect Schema (`schema`) for better type safety and runtime validation
- Legacy: JSON Schema-only parameters format (still supported for backward compatibility)

This example uses the recommended Effect Schema style.

## Prerequisites

- `OPENROUTER_API_KEY` set (see `.env.example`)
- Dependencies installed from repo root (`bun install`)

## Pattern used

- Tools stay in `src/index.ts` because schema + handlers are executable code
- Agent behavior/config lives in `agents/tool-user.md` frontmatter (`tools: [calculator, get-weather]`)
- `config.yaml` provides OpenRouter defaults and default routing

## Run

```bash
bun run start
```

## Expected output (example)

```text
Calculator tool available: true
--- Weather Query ---
Response: Weather in Tokyo: Cloudy, 19C

--- Calculator Query ---
Response: 717
```

The exact weather response will vary because the weather tool is mocked.
