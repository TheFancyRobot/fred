import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFred, Fred, MessageRouterService } from '@fancyrobot/fred';
import { Effect } from 'effect';
import '@fancyrobot/fred-openrouter';
import { extractDuckDuckGoResults } from '../../../examples/13-multi-agent-workflows/src/browser-research';
import { appendNotebookEntry, queryNotebook } from '../../../examples/13-multi-agent-workflows/src/notes';
import {
  extractResearchAngles,
  normalizeOptionalLimit,
  normalizeReadTopResults,
  planResearchExecution,
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

  test('queryNotebook matches multi-word queries by token overlap', async () => {
    await withTempDir(async (dir) => {
      const notebookPath = path.join(dir, 'notebook.md');

      await appendNotebookEntry(notebookPath, {
        title: 'Travel preference',
        content: 'Prefer aisle seats and morning flights.',
        tags: ['travel'],
        timestamp: new Date('2026-03-06T12:00:00.000Z'),
      });

      const result = await queryNotebook(notebookPath, {
        query: 'travel preferences seat flight timing',
        limit: 1,
      });

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

  test('extractResearchAngles parses compact bullet lists for parallel track fan-out', () => {
    expect(extractResearchAngles([
      '- map the cartel timeline from the 1970s onward',
      '- identify the state and federal power vacuums that enabled expansion',
      '- trace how trafficking routes shifted after major crackdowns',
      '- map the cartel timeline from the 1970s onward',
    ].join('\n'), 10)).toEqual([
      'map the cartel timeline from the 1970s onward',
      'identify the state and federal power vacuums that enabled expansion',
      'trace how trafficking routes shifted after major crackdowns',
    ]);
  });

  test('planResearchExecution trims background requests to the essential track', () => {
    expect(
      planResearchExecution('research the fall of rome and wrote a 500 word essay on your findings')
    ).toEqual({
      mode: 'background',
      includeMarketTrack: false,
      includeRiskTrack: false,
      browserReadTopResults: 1,
    });
  });

  test('planResearchExecution keeps decision tracks for comparisons', () => {
    expect(
      planResearchExecution('Research whether a carry-on backpack or rolling suitcase is better for a 3-day city trip')
    ).toEqual({
      mode: 'decision',
      includeMarketTrack: true,
      includeRiskTrack: true,
      browserReadTopResults: 2,
    });
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
      const configPath = path.resolve(process.cwd(), 'examples/13-multi-agent-workflows/config.yaml');
      const fred = await createFred({ configPath });

      try {
        const notebookPath = path.join(dir, 'notebook.md');
        const result = await setupExample(fred, { notebookPath });

        expect(result.workflows).toEqual(['research-swarm', 'daily-brief']);
        expect(await fred.agents.get('concierge')).toBeDefined();
        expect(await fred.agents.get('research-orchestrator')).toBeDefined();
        expect(await fred.agents.get('note-taker')).toBeDefined();
        expect(await fred.agents.get('news-briefer')).toBeDefined();
        expect(await fred.agents.get('daily-brief-agent')).toBeDefined();
        expect((await fred.variables.snapshot()).current_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect((await fred.agents.get('web-researcher'))?.config.tools).toContain('agent_browser_research');
        expect((await fred.agents.get('market-researcher'))?.config.tools).toContain('agent_browser_research');
        expect((await fred.agents.get('risk-analyst'))?.config.tools).toContain('agent_browser_research');
      } finally {
        await fred.shutdown();
      }
    });
  });

  test('setupExample remains compatible with the CLI legacy runtime hook', async () => {
    await withTempDir(async (dir) => {
      const fred = await Fred.create();

      try {
        const configPath = path.resolve(process.cwd(), 'examples/13-multi-agent-workflows/config.yaml');
        const result = await setupExample(fred, {
          configPath,
          notebookPath: path.join(dir, 'notebook.md'),
        });

        expect(result.workflows).toEqual(['research-swarm', 'daily-brief']);
        expect(fred.getAgent('concierge')?.config.tools).toContain('handoff_to_agent');
        expect(fred.getAgent('research-orchestrator')?.config.tools).toContain('run_research_swarm');
      } finally {
        await fred.shutdown();
      }
    });
  });

  test('routes broad comparison prompts directly to research-orchestrator', async () => {
    await withTempDir(async (dir) => {
      const configPath = path.resolve(process.cwd(), 'examples/13-multi-agent-workflows/config.yaml');
      const fred = await createFred({ configPath });

      try {
        const notebookPath = path.join(dir, 'notebook.md');
        await setupExample(fred, { notebookPath });

        const route = await fred.effects.run(
          MessageRouterService.pipe(
            Effect.flatMap((router) =>
              router.route('What dog breeds are good for apartment living and first-time owners?')
            )
          )
        );

        expect(route.agent).toBe('research-orchestrator');
        expect(route.fallback).toBe(false);
      } finally {
        await fred.shutdown();
      }
    });
  });

  test('routes research essay prompts directly to research-orchestrator', async () => {
    await withTempDir(async (dir) => {
      const configPath = path.resolve(process.cwd(), 'examples/13-multi-agent-workflows/config.yaml');
      const fred = await createFred({ configPath });

      try {
        const notebookPath = path.join(dir, 'notebook.md');
        await setupExample(fred, { notebookPath });

        const route = await fred.effects.run(
          MessageRouterService.pipe(
            Effect.flatMap((router) =>
              router.route('research the fall of rome and wrote a 500 word essay on your findings')
            )
          )
        );

        expect(route.agent).toBe('research-orchestrator');
        expect(route.fallback).toBe(false);
      } finally {
        await fred.shutdown();
      }
    });
  });
});
