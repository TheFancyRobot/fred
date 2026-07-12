import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  const response = await fred.messages.process('What is TypeScript in one sentence?');
  console.log('Response:', response?.content);

  await fred.shutdown();
}

main().catch(console.error);
