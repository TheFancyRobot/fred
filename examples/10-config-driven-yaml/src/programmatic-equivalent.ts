import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  console.log('=== Programmatic Equivalent ===\n');
  console.log('Rosetta Stone mapping (config + markdown -> API concepts):');
  console.log('- providers[].id: openrouter -> provider pack registration');
  console.log('- agents/*.md -> createAgent(...) for each parsed file');
  console.log('- frontmatter utterances -> registerIntent(...) targeting the agent');
  console.log('- routing.defaultAgent/rules -> configureRouting(...)');
  console.log('');
  console.log('This run still loads from config.yaml + ./agents to share one source of truth.\n');

  const response = await fred.messages.process('How do I write a TypeScript interface?');
  console.log('Response:', response?.content);

  await fred.shutdown();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
