# 09 - Evaluation Harness: Golden Traces & Assertions

This example showcases one of Fred's strongest differentiators: a built-in golden-trace evaluation system with assertion DSL and formatted test reporting.

No other mainstream agent framework ships this as a first-class local workflow:

- LangChain typically relies on LangSmith (separate SaaS)
- CrewAI offers basic `crewai test` coverage
- AutoGen does not provide a built-in golden-trace assertion harness

## What You'll Learn

- How to load and validate golden trace artifacts
- How to define assertion-driven `TestCase` suites
- How to run test cases and print human-readable pass/fail output
- How to run eval checks in CI with `bun test`
- How YAML suite manifests scale this pattern for larger regression suites

## Assertion Types Available

Fred's eval assertions include:

- `routing`
- `response`
- `tool.calls`
- `checkpoint`
- `schema`

## Prerequisites

- Bun installed
- `OPENAI_API_KEY` (needed when recording traces from live model runs)

```bash
cp .env.example .env
```

## Run the demo

```bash
bun run src/index.ts
```

You should see formatted output showing each test case and whether assertions passed.

## Run CI-style test

```bash
bun test
```

`test/eval.test.ts` demonstrates a minimal automated check that can run in local CI pipelines.

## Golden file used in this example

- `test/golden-traces/sample.golden.json`

The sample trace includes routing metadata, response output, tool call records, and spans so assertions can lock down key behavior over time.

## How to update goldens intentionally

When behavior changes on purpose, re-record or regenerate traces deliberately and review diffs before committing:

1. Re-run the workflow that produces the trace
2. Replace the existing golden file
3. Re-run eval tests
4. Confirm assertion updates reflect intentional changes only

Treat golden updates like API changes: explicit, reviewed, and documented.

## Scaling with YAML suite manifests

For larger eval suites, use `runSuite()` with YAML manifests (`parseSuiteManifest`) from `@fancyrobot/fred/eval` to define many cases declaratively while keeping the same assertion model.
