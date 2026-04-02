# 09 - Evaluation Harness: App + Golden Trace Assertions

This example now has two complementary entry points:

- `src/index.ts`: a standalone app that runs a billing agent loaded from `agents/billing.md`
- `test/eval.test.ts`: an eval harness test that validates golden trace assertions

## Architecture

### App runtime (`src/index.ts`)

- Uses `Fred.create()` + `initializeFromConfig('./config.yaml')`
- Loads the billing agent from `agents/billing.md`
- Sends a sample billing/refund message and prints the response

### Eval runtime (`test/eval.test.ts`)

- Runs assertion checks against `test/golden-traces/sample.golden.json`
- Uses `@fancyrobot/fred/eval`
- Does not depend on live inference for test execution

## Why this structure matters

You can iterate on agent behavior and app wiring in `src/index.ts`, while keeping deterministic regression checks in `test/eval.test.ts`.

## Prerequisites

- Bun installed
- `OPENROUTER_API_KEY` in `.env`

```bash
cp .env.example .env
```

## Run the app demo

```bash
bun run src/index.ts
```

## Run eval assertions

```bash
bun test
```

## Files

- `agents/billing.md` - Billing agent definition with YAML frontmatter
- `config.yaml` - OpenRouter provider and routing config
- `src/index.ts` - Standalone app entry point
- `test/eval.test.ts` - Golden trace assertion runner
- `test/golden-traces/sample.golden.json` - Trace fixture used by eval tests
