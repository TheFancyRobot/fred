import { describe, expect, test } from 'bun:test';
import type { Fred } from '@fancyrobot/fred';
import { buildBuiltinSlashCommands } from '../../../packages/cli/src/commands/chat';

describe('chat subagent slash commands', () => {
  test('lists and inspects active subagents', async () => {
    const fred = {
      subagents: {
        list: async () => [
          {
            id: 'subagent-1',
            name: 'researcher',
            command: 'node',
            args: ['worker.js'],
            cwd: '/tmp/work',
            envKeys: ['API_KEY'],
            metadata: { kind: 'research' },
            status: 'running',
            createdAt: '2026-03-08T10:00:00.000Z',
            updatedAt: '2026-03-08T10:00:10.000Z',
            executionCount: 2,
            currentExecution: {
              args: ['run'],
              startedAt: '2026-03-08T10:00:05.000Z',
              pid: 4242,
            },
            lastExecution: {
              args: ['warmup'],
              startedAt: '2026-03-08T09:59:00.000Z',
              endedAt: '2026-03-08T09:59:03.000Z',
              exitCode: 0,
              signal: null,
              stdoutPreview: 'ready',
            },
          },
        ],
        inspect: async (id: string) => id === 'subagent-1'
          ? {
              id: 'subagent-1',
              name: 'researcher',
              command: 'node',
              args: ['worker.js'],
              cwd: '/tmp/work',
              envKeys: ['API_KEY'],
              metadata: { kind: 'research' },
              status: 'running',
              createdAt: '2026-03-08T10:00:00.000Z',
              updatedAt: '2026-03-08T10:00:10.000Z',
              executionCount: 2,
              currentExecution: {
                args: ['run'],
                startedAt: '2026-03-08T10:00:05.000Z',
                pid: 4242,
              },
              lastExecution: {
                args: ['warmup'],
                startedAt: '2026-03-08T09:59:00.000Z',
                endedAt: '2026-03-08T09:59:03.000Z',
                exitCode: 0,
                signal: null,
                stdoutPreview: 'ready',
              },
            }
          : null,
        destroy: async () => false,
      },
    } as unknown as Fred;

    const commands = buildBuiltinSlashCommands(fred);
    const listOutput = await commands.find((command) => command.commandId === 'subagents')!.execute('', {
      cwd: process.cwd(),
      sessionId: 'session-1',
    });
    const inspectOutput = await commands.find((command) => command.commandId === 'subagent-inspect')!.execute('subagent-1', {
      cwd: process.cwd(),
      sessionId: 'session-1',
    });

    expect(listOutput).toContain('Active subagents');
    expect(listOutput).toContain('subagent-1');
    expect(listOutput).toContain('pid=4242');

    expect(inspectOutput).toContain('Subagent subagent-1');
    expect(inspectOutput).toContain('status: running');
    expect(inspectOutput).toContain('stdout: ready');
  });

  test('destroys a subagent and reports missing ids', async () => {
    let destroyedId: string | null = null;
    const fred = {
      subagents: {
        list: async () => [],
        inspect: async () => null,
        destroy: async (id: string) => {
          destroyedId = id;
          return id === 'subagent-2';
        },
      },
    } as unknown as Fred;

    const commands = buildBuiltinSlashCommands(fred);
    const destroyCommand = commands.find((command) => command.commandId === 'subagent-destroy');

    await expect(destroyCommand?.execute('', { cwd: process.cwd() })).rejects.toThrow(
      'Missing subagent id. Usage: /fred:subagent-destroy <id>',
    );

    const destroyedOutput = await destroyCommand!.execute('subagent-2', { cwd: process.cwd() });
    const missingOutput = await destroyCommand!.execute('missing', { cwd: process.cwd() });

    expect(String(destroyedId)).toBe('missing');
    expect(destroyedOutput).toBe('Destroyed subagent: subagent-2');
    expect(missingOutput).toBe('Subagent not found or already destroyed: missing');
  });
});
