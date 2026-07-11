# Server Mode Example

Example showing how to run Fred as an HTTP server.

For a complete runnable project—including credential-free auth/CORS/admin/docs
smoke checks plus optional live sessions, SSE, and OpenAI SDK calls—see
[Example 14: Optional HTTP Layer](https://github.com/TheFancyRobot/fred/tree/main/examples/14-http-layer).

For typed workflow JSON/SSE endpoints, scoped API keys, custom paths, and
durable key setup, see
[Example 15: HTTP Workflows](https://github.com/TheFancyRobot/fred/tree/main/examples/15-http-workflows).

## Basic Server

```typescript
import { createFred } from '@fancyrobot/fred';
import { withHttp } from '@fancyrobot/fred-http';

async function main() {
  const core = await createFred();
  await core.providers.use('openai');

  await core.agents.register({
    id: 'agent',
    systemMessage: 'You are helpful.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
  });

  const fred = withHttp(core);
  const server = await fred.server.listen({ port: 3000 });
  console.log(server.url);
}
```

HTTP is opt-in: the core client has no listener until it is passed to
`withHttp()`. Call `fred.server.stop()` to stop only HTTP, or `fred.shutdown()`
to close HTTP and the underlying Fred client together.

## Legacy config launcher

The repository command still accepts config files during the one-release
compatibility window:

```bash
bun run server --config config.json --port 3000
```

`ServerApp` and `createFredHttpApp` are deprecated and will be removed in the
next major release.

## API Endpoints

- `POST /v1/chat/completions` - OpenAI-compatible chat
- `POST /chat` - Simplified chat
- `POST /message` - Process message
- `GET /agents` - List agents
- `GET /intents` - List intents
- `GET /tools` - List tools
- `GET /health` - Health check
- `GET /status` - Live agent runs
- `GET /docs` - Swagger UI
- `GET /docs/openapi.json` - OpenAPI document

When `workflowEndpoints` is enabled through `withHttp()`, the server also adds
typed `POST /workflows/:id` routes (or configured custom paths). Workflow
definitions are snapshotted when the listener starts.
