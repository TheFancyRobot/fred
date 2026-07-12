import { describe, expect, test } from 'bun:test';
import type { FredClient } from '@fancyrobot/fred';
import { runBrowserResearch } from '../../../examples/13-multi-agent-workflows/src/browser-research';

describe('browser research subagent integration', () => {
  test('uses Fred subagent management instead of direct child processes', async () => {
    const originalFetch = globalThis.fetch;
    const spawned: Array<{ id: string; command: string; args: readonly string[] }> = [];
    const destroyed: string[] = [];
    let nextId = 0;

    globalThis.fetch = async () => new Response(`
      <div class="result results_links web-result">
        <div class="links_main links_deep result__body">
          <h2 class="result__title">
            <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fdogs">Example Result</a>
          </h2>
          <a class="result__snippet">Dog adoption statistics overview</a>
        </div>
      </div>
    `, {
      headers: { 'content-type': 'text/html; charset=utf-8' },
      status: 200,
    });

    try {
      const now = new Date().toISOString();
      const fred: Pick<FredClient, 'subagents'> = {
        subagents: {
          spawn: async (options: { command: string; args?: readonly string[] }) => {
            const id = `subagent-${++nextId}`;
            spawned.push({ id, command: options.command, args: options.args ?? [] });
            return {
              id,
              name: 'browser-test',
              command: options.command,
              args: options.args ?? [],
              envKeys: [],
              metadata: {},
              status: 'idle',
              createdAt: now,
              updatedAt: now,
              executionCount: 0,
            };
          },
          execute: async (_id: string, options?: { args?: readonly string[] }) => {
            const args = options?.args ?? [];
            if (args[0] === 'get') {
              return {
                stdout: 'Dogs are adopted across the United States each year.',
                stderr: '',
                exitCode: 0,
                signal: null,
              };
            }

            return {
              stdout: '',
              stderr: '',
              exitCode: 0,
              signal: null,
            };
          },
          destroy: async (id: string) => {
            destroyed.push(id);
            return true;
          },
          list: async () => [],
          inspect: async () => null,
        },
      };

      const report = await runBrowserResearch(fred, 'dog adoption statistics', {
        searchUrl: 'https://example.com/search?q=dogs',
        maxResults: 1,
        readTopResults: 1,
      });

      expect(spawned).toHaveLength(1);
      expect(spawned.every((entry) => entry.command === 'agent-browser')).toBe(true);
      expect(destroyed).toEqual(['subagent-1']);
      expect(report).toContain('https://example.com/dogs');
      expect(report).toContain('Dogs are adopted across the United States each year.');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
