# Server Mode Example

Example showing how to run Fred as an HTTP server.

## Basic Server

```typescript
import { Fred } from '@fancyrobot/fred';
import { ServerApp } from '@fancyrobot/fred-http';

async function main() {
  const fred = new Fred();
  fred.registerDefaultProviders();

  await fred.createAgent({
    id: 'agent',
    systemMessage: 'You are helpful.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
  });
  fred.setDefaultAgent('agent');

  const app = new ServerApp(fred);
  await app.start(3000);
}
```

## Server with Config

```typescript
import { Fred } from '@fancyrobot/fred';
import { ServerApp } from '@fancyrobot/fred-http';

async function main() {
  const fred = new Fred();
  await fred.initializeFromConfig('config.json');

  const app = new ServerApp(fred);
  await app.start(3000);
}
```

## API Endpoints

- `POST /v1/chat/completions` - OpenAI-compatible chat
- `POST /chat` - Simplified chat
- `POST /message` - Process message
- `GET /agents` - List agents
- `GET /intents` - List intents
- `GET /tools` - List tools
- `GET /health` - Health check
