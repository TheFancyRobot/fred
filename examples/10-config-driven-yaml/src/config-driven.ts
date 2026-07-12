import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  console.log('=== Config-Driven Demo ===\n');
  console.log('Fred initialized from config.yaml with agents auto-discovered from ./agents\n');

  const response = await fred.messages.process('How do I write a TypeScript interface?');
  console.log('Response:', response?.content);

  await fred.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
