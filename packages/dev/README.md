# @fancyrobot/fred-dev

Development tooling package for the Fred monorepo.

## Scope

`@fancyrobot/fred-dev` is for local development workflows (contributors and maintainers).
It provides helper entrypoints like dev chat and the local server used while building Fred.

This package is not intended as a production runtime dependency for application deployments.

## Prerequisites

- Bun installed
- A configured provider API key when using chat/server flows (for example `OPENAI_API_KEY`)

## Intended Use

Use this package when you are contributing to Fred or running local project tooling.

Avoid using this package as a runtime dependency in shipped applications.

## Usage

From the repository root:

```bash
# Run local development chat
bun run dev

# Run local development server
bun run server
```

You can also run package scripts directly:

```bash
bun run --filter @fancyrobot/fred-dev dev
bun run --filter @fancyrobot/fred-dev server
```

## Server Mode

Start the development server:

```bash
bun run server
# Or with options:
bun run server --config config.yaml --port 3000
```

The server exposes an OpenAI-compatible API:

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | OpenAI-compatible chat (works with Chatbox, etc.) |
| `POST /chat` | Simplified chat endpoint |
| `POST /message` | Process with intent matching options |
| `GET /agents` | List agents |
| `GET /intents` | List intents |
| `GET /tools` | List tools |
| `GET /health` | Health check |

## What It Exports

- `startDevChat` from `src/dev-chat.ts`
- `startServer` / `ServerApp` from `src/server.ts`
- chat default/provider helpers from `src/chat-defaults.ts`

## Stability

This package follows Fred's release process, but its API is primarily optimized
for repository development workflows and may change as contributor tooling evolves.

## Related

- [@fancyrobot/fred core package](../core/README.md)
- [Repository README hub](../../README.md)

## License

MIT
