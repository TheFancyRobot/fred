import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';
import { setupExample } from './runtime';

interface ScenarioResult {
  label: string;
  toolIds: string[];
  content: string;
}

function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate limit|temporar|timeout|timed out|overloaded|ECONNRESET|network/i.test(message);
}

async function runWithRetry<T>(label: string, task: () => Promise<T>): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;

      if (!isRetryableError(error) || attempt === 3) {
        throw error;
      }

      const delayMs = attempt * 15_000;
      console.log(`[retry] ${label}: attempt ${attempt} failed, waiting ${delayMs / 1000}s`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function runScenario(
  fred: Fred,
  label: string,
  message: string,
  expectedToolId: string,
): Promise<ScenarioResult> {
  const conversationId = fred.generateConversationId();
  const response = await runWithRetry(label, () =>
    fred.processMessage(message, { conversationId }),
  );

  if (!response?.content) {
    throw new Error(`${label}: no response content`);
  }

  const toolIds = response.toolCalls?.map((toolCall) => toolCall.toolId) ?? [];
  if (!toolIds.includes(expectedToolId)) {
    throw new Error(
      `${label}: expected tool ${expectedToolId} but saw ${toolIds.join(', ') || 'no tool calls'}`,
    );
  }

  return {
    label,
    toolIds,
    content: response.content,
  };
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for live E2E testing');
  }

  const fred = await Fred.create();

  try {
    const { notebookPath } = await setupExample(fred);
    const results: ScenarioResult[] = [];

    results.push(
      await runScenario(
        fred,
        'save note',
        'Save a note that I prefer aisle seats and early flights. Use the notebook tool.',
        'save_note',
      ),
    );

    const notebookAfterSave = await readFile(notebookPath, 'utf-8');
    if (!notebookAfterSave.includes('aisle seats and early flights')) {
      throw new Error('save note: notebook file did not contain the saved note');
    }

    results.push(
      await runScenario(
        fred,
        'recall note',
        'What do you know about my travel preferences? Use the notebook tool.',
        'read_notes',
      ),
    );

    results.push(
      await runScenario(
        fred,
        'latest news',
        'What happened in the news in the last 24 hours? Use the news tool.',
        'fetch_latest_news',
      ),
    );

    results.push(
      await runScenario(
        fred,
        'daily brief',
        'Give me a daily brief using my saved notes and the latest news. Use the daily brief tool.',
        'create_daily_brief',
      ),
    );

    results.push(
      await runScenario(
        fred,
        'research swarm',
        'Research whether a carry-on backpack or rolling suitcase is better for a 3-day city trip. Use the research workflow and keep the answer concise.',
        'run_research_swarm',
      ),
    );

    console.log('=== Live E2E Results ===');
    for (const result of results) {
      console.log(`\n[pass] ${result.label}`);
      console.log(`tools: ${result.toolIds.join(', ')}`);
      console.log(result.content.trim());
    }
  } finally {
    await fred.shutdown();
  }
}

main().catch((error) => {
  console.error('Live E2E failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
