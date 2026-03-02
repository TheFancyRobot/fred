# 03 - Intent Routing: Message-to-Agent Matching

This example demonstrates Fred's signature capability: intent-based routing that maps a user message to the right specialist agent.

## Why this matters

Fred can route requests before generation starts, so your app can stay deterministic and explainable with explicit intent definitions.

## What you'll learn

- Create specialist agents (`billing`, `tech-support`, `general`)
- Register intents with exact and regex-style matching via `utterances`
- Route messages with `fred.routeMessage(...)`
- Print a router transcript that explains *why* each message was routed
- Fall back to a default agent when no intent matches

## Matching modes shown here

- Exact matching (full normalized phrase match)
- Regex matching (utterances interpreted as regex patterns)

Fred also supports semantic matching (when embedding support is configured), but this example focuses on exact and regex for clarity.

## Prerequisites

- `OPENAI_API_KEY` set (see `.env.example`)
- Dependencies installed from repo root (`bun install`)

## Run

```bash
bun run start
```

## Sample output (abridged)

```text
--- Message: "I need a refund for my last invoice" ---
Routed to agent: billing
Route type: agent
Transcript: regex intent match /refund|charge|subscription/i -> billing-intent

--- Message: "The app keeps crashing when I open it" ---
Routed to agent: tech-support
Route type: agent
Transcript: regex intent match /crash/i -> tech-intent

--- Message: "What are your business hours?" ---
Routed to agent: general
Route type: default
Transcript: No exact or regex intent match; default agent selected.
```
