# Chat Tool Integration Example

Fred exposes an OpenAI-compatible endpoint for chat tools while keeping HTTP
outside the core client.

```typescript
import { createCalculatorTool, createFred } from '@fancyrobot/fred';
import { withHttp } from '@fancyrobot/fred-http';

async function main() {
  const core = await createFred({
    routing: { defaultAgent: 'assistant', rules: [] },
  });
  await core.providers.use('openai');
  await core.tools.register(createCalculatorTool());
  await core.agents.register({
    id: 'assistant',
    systemMessage: 'You are a helpful assistant. Use the calculator for arithmetic.',
    platform: 'openai',
    model: 'gpt-4o-mini',
    tools: ['calculator'],
  });
  const fred = withHttp(core);
  const server = await fred.server.listen({ port: 3000 });
  console.log(`OpenAI-compatible endpoint: ${server.url}/v1/chat/completions`);
}

await main();
```

Configure Misty, Chatbox, or another OpenAI-compatible client with
`http://localhost:3000/v1/chat/completions` and model `fred-agent`. Authentication
is required by default; configure an explicit bearer token or use a durable API
key in production.

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer $FRED_DEV_SERVER_TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Session-Id: chat-tool-session" \
  -d '{
    "messages": [
      { "role": "user", "content": "What is (100 + 50) * 2?" }
    ]
  }'
```
