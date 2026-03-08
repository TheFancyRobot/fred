import { describe, expect, test } from 'bun:test';
import type { Fred } from '@fancyrobot/fred';
import { runBrowserResearch } from '../../../examples/13-multi-agent-workflows/src/browser-research';

describe('browser research subagent integration', () => {
  test('uses Fred subagent management instead of direct child processes', async () => {
    const spawned: Array<{ id: string; command: string; args: readonly string[] }> = [];
    const destroyed: string[] = [];
    let nextId = 0;

    const fred = {
      subagents: {
        spawn: async (options: { command: string; args?: readonly string[] }) => {
          const id = `subagent-${++nextId}`;
          spawned.push({ id, command: options.command, args: options.args ?? [] });
          return { id };
        },
        execute: async (id: string, options?: { args?: readonly string[] }) => {
          const args = options?.args ?? [];
          if (id === 'subagent-1' && args[0] === 'get') {
            return {
              stdout: 'Example Result https://example.com/dogs\nDog adoption statistics overview',
              stderr: '',
              exitCode: 0,
              signal: null,
            };
          }

          if (id === 'subagent-2' && args[0] === 'get') {
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
      },
    } as unknown as Fred;

    const report = await runBrowserResearch(fred, 'dog adoption statistics', {
      searchUrl: 'https://example.com/search?q=dogs',
      maxResults: 1,
      readTopResults: 1,
    });

    expect(spawned).toHaveLength(2);
    expect(spawned.every((entry) => entry.command === 'agent-browser')).toBe(true);
    expect(destroyed).toEqual(['subagent-2', 'subagent-1']);
    expect(report).toContain('https://example.com/dogs');
    expect(report).toContain('Dogs are adopted across the United States each year.');
  });
});
