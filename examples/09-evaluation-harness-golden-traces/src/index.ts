import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await Fred.create();
  await fred.initializeFromConfig('./config.yaml');

  const response = await fred.processMessage('I need a refund for my subscription');
  console.log('Response:', response?.content);

  await fred.shutdown();
}

main().catch(console.error);
