# 13 - Multi-Agent Workflows: Research, Notes, and News

This example packages several everyday-useful agent patterns into one workspace:

- a `concierge` agent that routes requests to the right specialist
- a `research-orchestrator` that launches a parallel research swarm
- a `note-taker` that saves to a local markdown notebook
- a `news-briefer` that fetches and summarizes the latest 24 hours of news
- a `daily-brief` workflow that combines notes + news into one digest

## Why this split

The design follows a few reliable multi-agent patterns:

- `router -> specialist` for normal user requests
- `coordinator -> workers -> synthesis` for research
- `parallel fan-out -> join -> critique` when breadth matters
- `shared notebook memory` for personal continuity
- `daily brief` as a practical end-user workflow that merges personal notes with current events

For the research swarm, the work is intentionally split into:

1. `research-planner` - turns the request into focused sub-questions
2. `official-researcher` - looks for source-of-record style evidence
3. `market-researcher` - looks for practical comparisons and user-facing tradeoffs
4. `risk-analyst` - looks for caveats, failure modes, and blind spots
5. `research-synthesizer` - merges the findings into one report
6. `research-critic` - checks for gaps before the final answer is returned

That split keeps retrieval parallel, but keeps judgment and the final answer sequential.

## Workflows included

- `Research swarm` - best for compare/investigate/explain tasks
- `Notebook` - save and retrieve markdown notes locally
- `News brief` - fetch and summarize news from the last 24 hours
- `Daily brief` - combine notebook context and fresh news into one update

## Files

- `src/agents/*.md` - specialist agent prompts and routing hints
- `src/index.ts` - demo entrypoint and deterministic smoke mode
- `src/runtime.ts` - tool registration plus research and daily-brief orchestration
- `src/notes.ts` - markdown notebook helpers
- `src/news.ts` - RSS parsing and 24-hour news digest helpers
- `data/notebook.md` - local markdown notebook used by the note-taking tools
- `config.yaml` - runtime config used by the example entrypoint
- `fred.config.yaml` - duplicate config for Fred CLI discovery commands

## Run

1. Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`
   - Optional: set `FRED_EXAMPLE_MODEL` to override `openrouter/free` for live tests if the free alias is slow or incompatible
2. Run `bun install` from the repository root
3. Run the deterministic smoke test:

```bash
bun run smoke
```

4. Run the live end-to-end check (uses your `.env` API key and may take a while on the free model):

```bash
bun run e2e
```

5. Run the example entrypoint:

```bash
bun run start
```

6. Validate the config and markdown templates from this example directory:

```bash
bun run ../../packages/cli/src/index.ts config validate
bun run ../../packages/cli/src/index.ts validate
```

## Suggested live prompts

- `Research the best beginner road bike under $1,500 and save the key takeaways.`
- `Save a note that I prefer aisle seats and early flights.`
- `What happened in the news in the last 24 hours?`
- `Give me a daily brief using my saved notes and the latest news.`
