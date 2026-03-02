# 10 - Config-Driven: YAML Configuration

This example shows two ways to configure the same Fred app:

- Declarative config via `config.yaml`
- Imperative setup via `src/programmatic-equivalent.ts`

## What you'll learn

- How to define providers, agents, intents, and routing in YAML
- How to load that config with `fred.initializeFromConfig('./config.yaml')`
- How YAML declarations map to equivalent Fred API calls
- When to choose static config vs dynamic code

## Run the example

1. Copy environment variables:

```bash
cp .env.example .env
```

2. Set your OpenAI key in `.env`.

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
| `providers[].id: openai` | `await fred.registerProviderPack('openai')` |
| `agents[]` | `await fred.createAgent(...)` |
| `intents[]` | `fred.registerIntent(...)` |
| `routing.defaultAgent` + `routing.rules` | `fred.configureRouting({ defaultAgent, rules })` |
| Entire file load | `await fred.initializeFromConfig('./config.yaml')` |

## Config vs code

- Use config when setup is mostly static and you want easy environment-driven changes.
- Use code when setup is dynamic (runtime conditions, loops, generated agents, or custom branching).

## Pipeline function note

If your YAML config uses pipeline function steps (`functionId`), register them in code before loading config (via the config loader API):

```typescript
registerPipelineFunction('summarize-results', async (ctx) => {
  return { summary: `Done: ${String(ctx.input)}` };
});

await fred.initializeFromConfig('./config.yaml');
```
