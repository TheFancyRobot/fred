import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Fred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';
import { extractDuckDuckGoResults } from '../../../examples/13-multi-agent-workflows/src/browser-research';
import { appendNotebookEntry, queryNotebook } from '../../../examples/13-multi-agent-workflows/src/notes';
import {
  normalizeOptionalLimit,
  normalizeReadTopResults,
  runDeterministicSmokeChecks,
  setupExample,
} from '../../../examples/13-multi-agent-workflows/src/runtime';

async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'fred-example-13-test-'));

  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe('example 13 helpers', () => {
  test('appendNotebookEntry and queryNotebook round-trip notes', async () => {
    await withTempDir(async (dir) => {
      const notebookPath = path.join(dir, 'notebook.md');

      await appendNotebookEntry(notebookPath, {
        title: 'Travel preference',
        content: 'Prefer aisle seats and morning flights.',
        tags: ['travel'],
        timestamp: new Date('2026-03-06T12:00:00.000Z'),
      });

      const result = await queryNotebook(notebookPath, { query: 'aisle', limit: 1 });

      expect(result).toContain('Travel preference');
      expect(result).toContain('Prefer aisle seats and morning flights.');
    });
  });

  test('runDeterministicSmokeChecks returns notebook and news previews', async () => {
    await withTempDir(async (dir) => {
      const notebookPath = path.join(dir, 'notebook.md');
      const result = await runDeterministicSmokeChecks(notebookPath);

      expect(result.notebookPreview).toContain('Smoke test note');
      expect(result.newsDigest).toContain('Transit workers reach agreement');
      expect(result.newsDigest).not.toContain('Older article');
    });
  });

  test('normalizeOptionalLimit accepts numeric strings', () => {
    expect(normalizeOptionalLimit('20')).toBe(20);
    expect(normalizeOptionalLimit(' 3 ')).toBe(3);
    expect(normalizeOptionalLimit(7)).toBe(7);
    expect(normalizeOptionalLimit(null)).toBeUndefined();
    expect(normalizeOptionalLimit('abc')).toBeUndefined();
  });

  test('normalizeReadTopResults accepts booleans and numeric strings', () => {
    expect(normalizeReadTopResults(true)).toBe(3);
    expect(normalizeReadTopResults(false)).toBe(0);
    expect(normalizeReadTopResults('2')).toBe(2);
  });

  test('extractDuckDuckGoResults parses titles, urls, and snippets', () => {
    const html = `
      <div class="result results_links web-result">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fmarket-wrap">January 2026 Market Wrap</a>
          </h2>
          <a class="result__snippet">Stocks climbed as earnings improved.</a>
        </div>
      </div>
    `;

    expect(extractDuckDuckGoResults(html)).toEqual([
      {
        title: 'January 2026 Market Wrap',
        url: 'https://example.com/market-wrap',
        snippet: 'Stocks climbed as earnings improved.',
      },
    ]);
  });

  test('setupExample loads all example agents without live model calls', async () => {
    await withTempDir(async (dir) => {
      const fred = await Fred.create();

      try {
        const notebookPath = path.join(dir, 'notebook.md');
        const configPath = path.resolve(process.cwd(), 'examples/13-multi-agent-workflows/config.yaml');
        const result = await setupExample(fred, { notebookPath, configPath });

        expect(result.workflows).toEqual(['research-swarm', 'daily-brief']);
        expect(fred.getAgent('concierge')).toBeDefined();
        expect(fred.getAgent('research-orchestrator')).toBeDefined();
        expect(fred.getAgent('note-taker')).toBeDefined();
        expect(fred.getAgent('news-briefer')).toBeDefined();
        expect(fred.getAgent('daily-brief-agent')).toBeDefined();
        expect(await fred.getGlobalVariable('current_date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(fred.getAgent('official-researcher')?.config.tools).toContain('agent_browser_research');
        expect(fred.getAgent('market-researcher')?.config.tools).toContain('agent_browser_research');
        expect(fred.getAgent('risk-analyst')?.config.tools).toContain('agent_browser_research');
      } finally {
        await fred.shutdown();
      }
    });
  });

  test('routes broad comparison prompts directly to research-orchestrator', async () => {
    await withTempDir(async (dir) => {
      const fred = await Fred.create();

      try {
        const notebookPath = path.join(dir, 'notebook.md');
        const configPath = path.resolve(process.cwd(), 'examples/13-multi-agent-workflows/config.yaml');
        await setupExample(fred, { notebookPath, configPath });

        const route = await fred.routeMessage(
          'What dog breeds are good for apartment living and first-time owners?'
        );

        expect(route.type).toBe('agent');
        if (route.type === 'agent') {
          expect(route.agentId).toBe('research-orchestrator');
        }
      } finally {
        await fred.shutdown();
      }
    });
  });
});
