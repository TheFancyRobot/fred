import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  try {
    console.log('Fred configured with markdown-defined agents from ./agents and intent routing.');
    console.log('');
    console.log('Try the interactive TUI:');
    console.log('  fred chat --config ./config.yaml');
    console.log('');
    console.log('Or run headlessly:');
    console.log('  fred run --config ./config.yaml --message "Write a hello world in Python"');
  } finally {
    await fred.shutdown();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
