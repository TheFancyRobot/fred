# 01 - Quickstart: Single Agent

This example shows the fastest path to getting your first response with Fred.

## What you'll learn

- `Fred.create()` to initialize the runtime
- Provider registration with `registerProviderPack('openai')`
- Agent creation with `createAgent(...)`
- Message processing with `processMessage(...)`

## Prerequisites

- Bun installed
- OpenAI API key

## Setup

```bash
cp .env.example .env
```

Then edit `.env` and set `OPENAI_API_KEY`.

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
