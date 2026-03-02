# 11 - MCP Integration: Model Context Protocol

Connect Fred to an MCP server, let an agent auto-discover server tools, and handle server-down scenarios safely.

## What you'll learn

- How to connect a global MCP server with `configureMCPServers`
- How MCP tools become available to an agent via `mcpServers: ['server-id']`
- How to detect and handle server-down or disconnected states

## Prerequisites

- Bun installed
- `npx` available in your shell
- Writable `/tmp` directory (this example uses `/tmp/mcp-demo`)
- `OPENAI_API_KEY` set in `.env`

## Run the example

```bash
bun install
cp .env.example .env
# edit .env and set OPENAI_API_KEY
bun run start
```

## What happens when the server is down?

This example uses two layers of safety:

1. It checks `getServerStatus('filesystem')` after configuration.
2. It wraps message processing in `try/catch` and prints recovery guidance.

Typical failure symptoms include:

- MCP status is not `connected`
- Request error with messages such as "server disconnected" or process startup failures

Recovery pattern:

1. Ensure `npx` works.
2. Verify the MCP command and args are correct.
3. Restart the example to reconnect and re-discover tools.

## Files

- `src/index.ts` - End-to-end MCP setup + agent usage
- `.env.example` - Required environment variable
- `tsconfig.json` - Local typecheck config
