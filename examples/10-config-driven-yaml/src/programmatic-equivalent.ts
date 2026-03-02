import { Fred } from '@fancyrobot/fred';

async function main() {
  const fred = await Fred.create();
  await fred.registerProviderPack('openai');

  await fred.createAgent({
    id: 'assistant',
    systemMessage: 'You are a helpful assistant.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  await fred.createAgent({
    id: 'coder',
    systemMessage: 'You are a coding assistant. Help with code questions.',
    platform: 'openai',
    model: 'gpt-4o-mini',
  });

  fred.registerIntent({
    id: 'code-intent',
    utterances: ['code', 'programming', 'function', 'bug'],
    action: { type: 'agent', target: 'coder' },
  });

  fred.configureRouting({
    defaultAgent: 'assistant',
    rules: [],
  });

  console.log('=== Programmatic Equivalent ===\n');
  const response = await fred.processMessage('How do I write a TypeScript interface?');
  console.log('Response:', response?.content);

  await fred.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
