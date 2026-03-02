# 04 - Dynamic Handoff: Agent-to-Agent Transfer

This example shows tool-based handoff between specialists: intake triages requests, hands off to a specialist, and specialists can hand back when clarification is needed.

## What you'll learn

- `createHandoffTool(...)` for agent-to-agent transfer
- Bidirectional handoff (intake -> specialist -> intake)
- Conversation continuity with a shared `conversationId`

## Handoff patterns in Fred

This example uses **tool-based handoff**.

- Tool-based handoff: an agent explicitly calls `handoff_to_agent` when it decides another agent should take over.
- Intent re-routing (see Example 03): the router selects an agent based on message matching before agent execution.

Use tool-based handoff when an active agent needs to escalate mid-conversation. Use intent re-routing when message-to-agent mapping is mostly deterministic at the router level.

## Architecture

```text
User -> intake
          |
          +-> billing-specialist
          |       |
          |       +-> intake (clarification hand-back)
          |
          +-> tech-specialist
                  |
                  +-> intake (re-route if needed)
```

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

You should see:

- The intake agent route a billing question to the billing specialist
- A specialist response with potential hand-back behavior on follow-up

Because routing/handoff is model-driven, exact wording varies by run.
