import { Fred } from '../../src/index';
import { ServerApp } from '../../src/server/app';

/**
 * Server mode example
 * Run with: bun run examples/server/index.ts
 */
async function main() {
  const fred = new Fred();

  // Register default providers
  fred.registerDefaultProviders();

  // Example: Register a simple tool
  fred.registerTool({
    id: 'echo',
    name: 'echo',
    description: 'Echo back the input message',
    parameters: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          description: 'The message to echo back',
        },
      },
      required: ['message'],
    },
    execute: async (args) => {
      return `Echo: ${args.message}`;
    },
  });

  // Example: Create an agent
  await fred.createAgent({
    id: 'echo-agent',
    systemMessage: 'You are a helpful assistant that echoes messages.',
    platform: 'openai',
    model: 'gpt-3.5-turbo',
    tools: ['echo'],
  });

  // Example: Register an intent
  fred.registerIntent({
    id: 'echo-intent',
    utterances: ['echo', 'repeat', 'say back'],
    action: {
      type: 'agent',
      target: 'echo-agent',
    },
  });

  // Create and start server
  const app = new ServerApp(fred);
  await app.start(3000);

  console.log('Server is running!');
  console.log('Try: curl -X POST http://localhost:3000/message -H "Content-Type: application/json" -d \'{"message":"echo hello world"}\'');
}

// @ts-ignore - Bun global
if (import.meta.main) {
  main().catch(console.error);
}

