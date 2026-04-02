import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await Fred.create();

  await fred.initializeFromConfig('./config.yaml');

  console.log('=== Config-Driven Demo ===\n');
  console.log('Fred initialized from config.yaml with agents auto-discovered from ./agents\n');

  const response = await fred.processMessage('How do I write a TypeScript interface?');
  console.log('Response:', response?.content);

  await fred.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
