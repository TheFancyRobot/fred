import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';
import { DEFAULT_NOTEBOOK_PATH, runDeterministicSmokeChecks, setupExample } from './runtime';

function hasFlag(flag: string): boolean {
  return Bun.argv.includes(flag);
}

async function runSmokeMode() {
  const tempDir = await mkdtemp(join(tmpdir(), 'fred-example-13-'));
  const notebookPath = join(tempDir, 'notebook.md');
  const fred = await createFred({ configPath: './config.yaml' });

  try {
    const setup = await setupExample(fred, { notebookPath });
    const smoke = await runDeterministicSmokeChecks(notebookPath);

    console.log('=== Multi-Agent Workflows Smoke Test ===');
    console.log(`Loaded agents: ${(await fred.agents.list()).map((agent) => agent.id).join(', ')}`);
    console.log(`Registered workflows: ${setup.workflows.join(', ')}`);
    console.log('');
    console.log('Notebook preview:');
    console.log(smoke.notebookPreview.trim());
    console.log('');
    console.log('News digest preview:');
    console.log(smoke.newsDigest.trim());
  } finally {
    await fred.shutdown();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function runInfoMode() {
  const fred = await createFred({ configPath: './config.yaml' });

  try {
    const setup = await setupExample(fred);

    console.log('=== Multi-Agent Workflows Demo ===');
    console.log(`Notebook path: ${setup.notebookPath}`);
    console.log(`Registered workflows: ${setup.workflows.join(', ')}`);
    console.log(`Loaded agents: ${(await fred.agents.list()).map((agent) => agent.id).join(', ')}`);
    console.log('');
    console.log('Suggested prompts:');
    console.log('- Research the best beginner road bike under $1,500 and save the takeaways.');
    console.log('- Save a note that I prefer aisle seats and early flights.');
    console.log('- What happened in the news in the last 24 hours?');
    console.log('- Give me a daily brief using my saved notes and the latest news.');
    console.log('');
    console.log(`Run \`bun run smoke\` for deterministic validation or use the live notebook at ${DEFAULT_NOTEBOOK_PATH}.`);
  } finally {
    await fred.shutdown();
  }
}

async function main() {
  if (hasFlag('--smoke')) {
    await runSmokeMode();
    return;
  }

  await runInfoMode();
}

main().catch((error) => {
  console.error('Multi-agent example failed:', error);
  process.exitCode = 1;
});
