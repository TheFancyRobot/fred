import { Fred } from '@fancyrobot/fred';

async function main() {
  // 1. Create Fred instance (initializes Effect runtime)
  const fred = await Fred.create();

  // 2. Register an AI provider
  await fred.registerProviderPack('openai');

  // 3. Create a single agent
  await fred.createAgent({
    id: 'assistant',
    systemMessage: 'You are a helpful assistant. Be concise and friendly.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  // 4. Set it as the default agent
  fred.setDefaultAgent('assistant');

  // 5. Send a message and get a response
  const response = await fred.processMessage('What is TypeScript in one sentence?');
  console.log('Response:', response?.content);

  // 6. Clean up
  await fred.shutdown();
}

main().catch(console.error);
