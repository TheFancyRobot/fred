import { describe, expect, test } from 'bun:test';
import { Deferred, Effect, Fiber, Runtime } from 'effect';
import { Fred, trackAgentRun, type AgentStatusSnapshot } from '@fancyrobot/fred';
import { handleStatusCommand, type StatusCommandIO } from '../../src/commands/status';

const captureIO = () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: StatusCommandIO = {
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  };
  return { io, stdout, stderr };
};

const activeRuns: AgentStatusSnapshot = [
  {
    fiberId: '#7',
    agentId: 'researcher',
    workflowId: 'report-workflow',
    sessionId: 'session-42',
    state: 'running_tool',
    startedAt: Date.parse('2026-07-10T12:00:00.000Z'),
  },
];

describe('status command', () => {
  test('is registered in built-in dispatch and help', async () => {
    const source = await Bun.file(new URL('../../src/index.ts', import.meta.url)).text();

    expect(source).toContain("import { handleStatusCommand } from './commands/status'");
    expect(source).toContain("'status',");
    expect(source).toContain("case 'status':");
    expect(source).toContain('fred status');
  });

  test('renders a clear empty human result', async () => {
    const captured = captureIO();
    const exitCode = await handleStatusCommand([], {}, {
      fred: { getAgentStatus: async () => [] },
      io: captured.io,
    });

    expect(exitCode).toBe(0);
    expect(captured.stdout).toEqual(['No agent runs are active.']);
    expect(captured.stderr).toEqual([]);
  });

  test('renders valid structured JSON', async () => {
    const captured = captureIO();
    const exitCode = await handleStatusCommand([], { json: true }, {
      fred: { getAgentStatus: async () => activeRuns },
      io: captured.io,
    });

    expect(exitCode).toBe(0);
    expect(JSON.parse(captured.stdout[0] ?? '{}')).toEqual({
      ok: true,
      command: 'status',
      data: {
        activeRuns: 1,
        runs: activeRuns,
      },
    });
    expect(captured.stderr).toEqual([]);
  });

  test('reads an injected Fred runtime while a run is active', async () => {
    const fred = await Fred.create();
    const started = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const runtime = await fred.getRuntime();
    const run = Runtime.runFork(runtime)(
      trackAgentRun({
        runId: 'status-command-run',
        agentId: 'live-agent',
        workflowId: 'live-workflow',
        sessionId: 'live-session',
      })(
        Deferred.succeed(started, undefined).pipe(
          Effect.zipRight(Deferred.await(release)),
        ),
      ),
    );

    try {
      await Effect.runPromise(Deferred.await(started));
      const active = captureIO();
      expect(await handleStatusCommand([], {}, { fred, io: active.io })).toBe(0);
      expect(active.stdout[0]).toContain('live-agent');
      expect(active.stdout[0]).toContain('live-workflow');
      expect(active.stdout[0]).toContain('live-session');
      expect(active.stdout[0]).toContain('starting');

      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.join(run));

      const completed = captureIO();
      expect(await handleStatusCommand([], {}, { fred, io: completed.io })).toBe(0);
      expect(completed.stdout).toEqual(['No agent runs are active.']);
    } finally {
      await Effect.runPromise(Deferred.succeed(release, undefined));
      await Effect.runPromise(Fiber.interrupt(run));
      await fred.shutdown();
    }
  });
});
