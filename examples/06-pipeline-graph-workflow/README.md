# 06 - Graph Workflow: Branching Execution

This example shows how to build a graph workflow that classifies a question, routes it down different paths, and merges into a final synthesis. Agent prompts are loaded from `agents/*.md`; graph topology and runtime branching stay in TypeScript.

## What You'll Learn

- How to build DAG-style flows with `GraphWorkflowBuilder`
- How to use conditional branching with `BranchCondition` and default edges
- How merge nodes work naturally when multiple paths connect to one target node
- Why `initializeFromConfig('./config.yaml')` runs before graph registration

## Graph Topology

```text
            +----------------+
            |   classifier   |
            +--------+-------+
                     |
                     v
            +----------------+
            |  routeByIntent |
            +---+--------+---+
                |        |
 factual=true   |        | default (creative)
                v        v
         +-----------+ +---------+
         | researcher| | ideator |
         +-----+-----+ +----+----+
               \         /
                \       /
                 v     v
               +---------+
               |synthesizer|
               +-----------+
```

## Run

1. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`
2. Run `bun install` from the repo root
3. Run the example:

```bash
bun run examples/06-pipeline-graph-workflow/src/index.ts
```

You should see two runs:
- A factual prompt taking the `researcher` path
- A creative prompt taking the `ideator` path

Because agents are loaded from markdown files, workflow registration happens only after `initializeFromConfig()` completes.

## Why This Matters

Compared with LangGraph-style imperative wiring, Fred's `GraphWorkflowBuilder` keeps topology and branch conditions declarative and compact in one fluent definition.
