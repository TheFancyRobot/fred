# 03 - Intent Routing: Message-to-Agent Matching

This example demonstrates Fred's signature capability: intent-based routing that maps a user message to the right specialist agent.

## Why this matters

Fred can route requests before generation starts, so your app can stay deterministic and explainable with explicit intent definitions.

## What you'll learn

- Create specialist agents (`billing`, `tech-support`, `general`)
- Define routing utterances in agent frontmatter (`agents/*.md`)
- Route messages with `fred.routeMessage(...)`
- Print a router transcript that explains *why* each message was routed
- Fall back to a default agent when no intent matches

## Matching modes shown here

- Exact matching (full normalized phrase match)
- Regex matching (utterances interpreted as regex patterns)

Fred also supports semantic matching (when embedding support is configured), but this example focuses on exact and regex for clarity.

## Prerequisites

- `OPENROUTER_API_KEY` set (see `.env.example`)
- Dependencies installed from repo root (`bun install`)

## Declarative routing pattern

- `agents/billing.md` and `agents/tech-support.md` define `utterances:` in YAML frontmatter
- `config.yaml` defines OpenRouter provider + default agent (`general`)
- `src/index.ts` loads config via `initializeFromConfig()` and keeps transcript logic as an educational mirror of the frontmatter utterances

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
