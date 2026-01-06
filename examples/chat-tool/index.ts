import { Fred } from '../../src/index';
import { ServerApp } from '../../src/server/app';

/**
 * Example: Chat Tool Integration
 * Demonstrates how to use Fred with AI chat tools like Misty, Chatbox, etc.
 * via the OpenAI-compatible /v1/chat/completions endpoint
 */
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

  await fred.createAgent({
    id: 'code-agent',
    systemMessage: 'You are a coding assistant.',
    platform: 'openai',
    model: 'gpt-4',
  });

  // Register intents
  fred.registerIntent({
    id: 'math',
    utterances: ['calculate', 'math', 'solve'],
    action: { type: 'agent', target: 'math-agent' },
  });

  fred.registerIntent({
    id: 'code',
    utterances: ['code', 'programming', 'function'],
    action: { type: 'agent', target: 'code-agent' },
  });

  // Start server with chat API
  const app = new ServerApp(fred);
  await app.start(3000);

  console.log('Server running on http://localhost:3000');
  console.log('\nOpenAI-compatible endpoints:');
  console.log('  POST /v1/chat/completions');
  console.log('  POST /chat');
  console.log('\nExample curl command:');
  console.log(`curl -X POST http://localhost:3000/v1/chat/completions \\`);
  console.log(`  -H "Content-Type: application/json" \\`);
  console.log(`  -d '{"messages":[{"role":"user","content":"Hello!"}]}'`);
  console.log('\nWorks with: Misty, Chatbox, and other OpenAI-compatible tools!');
}

// @ts-ignore - Bun global
if (import.meta.main) {
  main().catch(console.error);
}

