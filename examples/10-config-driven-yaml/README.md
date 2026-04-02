# 10 - Config-Driven: YAML Configuration

This example shows two ways to configure the same Fred app:

- Declarative runtime via `config.yaml` + `agents/*.md`
- A Rosetta Stone explanation in `src/programmatic-equivalent.ts`

## What you'll learn

- How to define providers and routing in YAML while defining agents in markdown files
- How `initializeFromConfig('./config.yaml')` auto-discovers `./agents`
- How config + markdown maps to equivalent Fred API concepts
- When to choose static config vs dynamic code

## Run the example

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Set your OpenRouter key in `.env`.

3. Run either variant:

```bash
bun run start:config
```

or

```bash
bun run start:programmatic
```

## Side-by-side mapping

| YAML (`config.yaml`) | Programmatic (`src/programmatic-equivalent.ts`) |
| --- | --- |
| `providers[].id: openrouter` | provider pack registration via side-effect import |
| `agents/*.md` | parsed files passed to `createAgent(...)` conceptually |
| `utterances` in frontmatter | `registerIntent(...)` conceptually |
| `routing.defaultAgent` + `routing.rules` | `fred.configureRouting({ defaultAgent, rules })` |
| Entire file load | `await fred.initializeFromConfig('./config.yaml')` |

## Config vs code

- Use config when setup is mostly static and you want easy environment-driven changes.
- Use code when setup is dynamic (runtime conditions, generated behavior, or custom branching).

## Pipeline function note

If your YAML config uses pipeline function steps (`functionId`), register them in code before loading config (via the config loader API):

```typescript
registerPipelineFunction('summarize-results', async (ctx) => {
  return { summary: `Done: ${String(ctx.input)}` };
});

await fred.initializeFromConfig('./config.yaml');
```
