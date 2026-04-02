# 05 - Pipeline: Sequential Orchestration with Checkpointing

This example builds a step-based pipeline with `PipelineBuilder`, mixes agent and function steps, pauses for human input, and resumes from a checkpoint. Agent definitions live in `agents/*.md`, while pipeline runtime logic stays in TypeScript.

## What you'll learn

- Build a V2 step pipeline with `PipelineBuilder`
- Load agent definitions from markdown files via `initializeFromConfig('./config.yaml')`
- Combine agent steps and function steps in one workflow
- Trigger a pause for human input and resume execution
- Enable checkpointing on the pipeline config

## Flow

```text
classify -> process-classification -> planner -> pause-for-human-input -> summarizer
```

## Checkpoint and resume model

Fred's checkpoint/resume is built into pipeline execution primitives. In this demo:

1. A function step returns `{ pause: true, ... }`
2. The pipeline pauses and produces a `runId`
3. We resume with `fred.resume(runId, { humanInput: 'approve' })`

This keeps orchestration state inside Fred instead of requiring external state management glue in your application code.

## Simulated crash/restart note

This sample demonstrates pause -> resume in a single process so it runs out-of-the-box.

To test true crash/restart recovery, wire persistent checkpoint storage (for example SQLite/Postgres), stop the process after pause, then restart and call `fred.resume(runId, ...)` in a new process.

## Prerequisites

- Bun installed
- OpenRouter API key

## Setup

```bash
cp .env.example .env
```

Then edit `.env` and set `OPENROUTER_API_KEY`.

## Run

```bash
bun run start
```

The pipeline is created after config initialization so the `classifier`, `planner`, and `summarizer` agents from `agents/` are already registered.

## Expected output

You should see classification output, a pause notification, resume logs, and final summarized output.
