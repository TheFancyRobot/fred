import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createFred, type FredClient } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';
import { setupExample } from './runtime';

interface ScenarioResult {
  label: string;
  toolIds: string[];
  content: string;
}

interface ScenarioExpectation {
  expectedToolId: string;
  minContentLength?: number;
  requiredPhrases?: readonly string[];
  oneOfPhrases?: readonly string[];
  maxValidationAttempts?: number;
}

const DEFAULT_CONFIG_PATH = fileURLToPath(new URL('../config.yaml', import.meta.url));

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function assertScenarioQuality(
  label: string,
  content: string,
  expectation: ScenarioExpectation,
): void {
  const trimmed = content.trim();
  const minContentLength = expectation.minContentLength ?? 1;
  if (trimmed.length < minContentLength) {
    throw new Error(`${label}: expected at least ${minContentLength} characters of final content but saw ${trimmed.length}`);
  }

  const normalized = normalizeText(trimmed);
  for (const phrase of expectation.requiredPhrases ?? []) {
    if (!normalized.includes(normalizeText(phrase))) {
      throw new Error(`${label}: expected final content to include "${phrase}"`);
    }
  }

  const oneOfPhrases = expectation.oneOfPhrases ?? [];
  if (oneOfPhrases.length > 0 && !oneOfPhrases.some((phrase) => normalized.includes(normalizeText(phrase)))) {
    throw new Error(
      `${label}: expected final content to include one of ${oneOfPhrases.map((phrase) => `"${phrase}"`).join(', ')}`,
    );
  }
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
  fred: FredClient,
  label: string,
  message: string,
  expectation: ScenarioExpectation,
): Promise<ScenarioResult> {
  let lastError: unknown;
  const maxValidationAttempts = expectation.maxValidationAttempts ?? 2;

  for (let attempt = 1; attempt <= maxValidationAttempts; attempt += 1) {
    try {
      const session = await fred.sessions.open();
      const response = await runWithRetry(label, () =>
        fred.messages.process(message, { conversationId: session.id }),
      );

      if (!response?.content) {
        throw new Error(`${label}: no response content`);
      }

      const toolIds = response.toolCalls?.map((toolCall) => toolCall.toolId) ?? [];
      if (!toolIds.includes(expectation.expectedToolId)) {
        throw new Error(
          `${label}: expected tool ${expectation.expectedToolId} but saw ${toolIds.join(', ') || 'no tool calls'}`,
        );
      }

      assertScenarioQuality(label, response.content, expectation);

      return {
        label,
        toolIds,
        content: response.content,
      };
    } catch (error) {
      lastError = error;
      if (attempt === maxValidationAttempts) {
        throw error;
      }

      const delayMs = attempt * 5_000;
      console.log(`[retry] ${label}: validation attempt ${attempt} failed, waiting ${delayMs / 1000}s`);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

async function main() {
  if (!process.env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is required for live E2E testing');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'fred-example-13-e2e-'));
  const notebookPath = join(tempDir, 'notebook.md');
  const fred = await createFred({ configPath: DEFAULT_CONFIG_PATH });

  try {
    const { notebookPath: activeNotebookPath } = await setupExample(fred, {
      notebookPath,
    });
    const results: ScenarioResult[] = [];

    results.push(
      await runScenario(
        fred,
        'save note',
        'Save a note that I prefer aisle seats and early flights. Use the notebook tool.',
        {
          expectedToolId: 'save_note',
          minContentLength: 24,
          oneOfPhrases: ['saved', 'noted', 'remembered', 'aisle', 'early flight'],
        },
      ),
    );

    const notebookAfterSave = await readFile(activeNotebookPath, 'utf-8');
    const normalizedNotebookAfterSave = normalizeText(notebookAfterSave);
    if (!normalizedNotebookAfterSave.includes('aisle') || !normalizedNotebookAfterSave.includes('early')) {
      throw new Error('save note: notebook file did not retain the key travel preferences');
    }

    results.push(
      await runScenario(
        fred,
        'recall note',
        'What exact travel preferences do you have saved about me? Mention the specific seat and flight timing details. Use the notebook tool.',
        {
          expectedToolId: 'read_notes',
          minContentLength: 24,
          requiredPhrases: ['aisle', 'early'],
        },
      ),
    );

    results.push(
      await runScenario(
        fred,
        'latest news',
        'What happened in the news in the last 24 hours? Use the news tool.',
        {
          expectedToolId: 'fetch_latest_news',
          minContentLength: 40,
          oneOfPhrases: ['news', 'headline', 'development', 'watch next', 'summary', 'no items'],
        },
      ),
    );

    results.push(
      await runScenario(
        fred,
        'daily brief',
        'Give me a daily brief using my saved notes and the latest news. Use the daily brief tool.',
        {
          expectedToolId: 'create_daily_brief',
          minContentLength: 80,
          oneOfPhrases: ['daily brief', 'personal notes', 'top headlines', 'what matters most', 'next action', 'travel'],
        },
      ),
    );

    results.push(
      await runScenario(
        fred,
        'research swarm',
        'Research whether a carry-on backpack or rolling suitcase is better for a 3-day city trip. Use the research workflow and keep the answer concise.',
        {
          expectedToolId: 'run_research_swarm',
          minContentLength: 120,
          oneOfPhrases: ['backpack', 'suitcase', 'carry-on', 'roller'],
          maxValidationAttempts: 1,
        },
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
    await rm(tempDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('Live E2E failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
