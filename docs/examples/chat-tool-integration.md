# Chat Tool Integration Example

Example showing how to use Fred with AI chat tools like Misty, Chatbox, etc.

## Complete Example

```typescript
import { Fred } from 'fred';
import { ServerApp } from 'fred/server';

async function main() {
  const fred = new Fred();

  // Register providers
  fred.registerDefaultProviders();

  // Create a default agent
  await fred.createAgent({
    id: 'default-agent',
    systemMessage: 'You are a helpful assistant.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
  });
  fred.setDefaultAgent('default-agent');

  // Create specialized agents
  await fred.createAgent({
    id: 'math-agent',
    systemMessage: 'You are a math expert.',
    platform: 'openai',
    model: 'gpt-4',
  });

  // Register intents
  fred.registerIntent({
    id: 'math',
    utterances: ['calculate', 'math', 'solve'],
    action: { type: 'agent', target: 'math-agent' },
  });

  // Start server
  const app = new ServerApp(fred);
  await app.start(3000);

  console.log('Server running on http://localhost:3000');
  console.log('OpenAI-compatible endpoint: POST /v1/chat/completions');
}
```

## Using with Chat Tools

### Misty

Configure Misty to use:
- API Endpoint: `http://localhost:3000/v1/chat/completions`
- Model: `fred-agent`

### Chatbox

In Chatbox settings:
- Custom API: `http://localhost:3000/v1/chat/completions`
- Model: `fred-agent`

### curl Example

```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      { "role": "user", "content": "Hello!" }
    ]
  }'
```

