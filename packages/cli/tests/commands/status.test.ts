import { describe, expect, test } from 'bun:test';
import { Deferred, Effect, Fiber, Stream } from 'effect';
import { createFred, trackAgentRun, type AgentStatusSnapshot, type FredClient } from '@fancyrobot/fred';
import { AgentStatusService } from '@fancyrobot/fred/effect';
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

const createStatusClient = async (snapshot: AgentStatusSnapshot): Promise<FredClient> => {
  const fred = await createFred();
  const status: typeof AgentStatusService.Service = {
    snapshot: Effect.succeed(snapshot),
    changes: Stream.empty,
    transition: () => Effect.void,
  };
  return {
    ...fred,
    effects: {
      run: (effect) => fred.effects.run(Effect.provideService(effect, AgentStatusService, status)),
    },
  };
};

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
    const fred = await createStatusClient([]);
    const exitCode = await handleStatusCommand([], {}, {
      fred,
      io: captured.io,
    });

    expect(exitCode).toBe(0);
    expect(captured.stdout).toEqual(['No agent runs are active.']);
    expect(captured.stderr).toEqual([]);
  });

  test('renders valid structured JSON', async () => {
    const captured = captureIO();
    const fred = await createStatusClient(activeRuns);
    const exitCode = await handleStatusCommand([], { json: true }, {
      fred,
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

  test('sanitizes identifiers before measuring and rendering the human table', async () => {
    const captured = captureIO();
    const unsafeRuns: AgentStatusSnapshot = [{
      ...activeRuns[0]!,
      agentId: 'research\u001b[31mer',
      workflowId: 'workflow\u001b]52;c;Y2xpcGJvYXJk\u0007safe',
      sessionId: 'session\nwrapped',
      fiberId: '#7\u009b31m',
    }];

    const fred = await createStatusClient(unsafeRuns);
    const exitCode = await handleStatusCommand([], {}, {
      fred,
      io: captured.io,
    });

    expect(exitCode).toBe(0);
    expect(captured.stdout[0]).toContain('researcher');
    expect(captured.stdout[0]).toContain('workflowsafe');
    expect(captured.stdout[0]).toContain('session wrapped');
    expect(captured.stdout[0]).toContain('#7');
    expect(captured.stdout[0]).not.toContain('\u001b');
    expect(captured.stdout[0]).not.toContain('\u009b');
    expect(captured.stdout[0]?.split('\n')).toHaveLength(5);
    expect(captured.stderr).toEqual([]);
  });

  test('reads an injected FredClient while a run is active', async () => {
    const fred = await createFred();
    const started = await fred.effects.run(Deferred.make<void>());
    const release = await fred.effects.run(Deferred.make<void>());
    const run = await fred.effects.run(Effect.forkDaemon(
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
    ));

    try {
      await fred.effects.run(Deferred.await(started));
      const active = captureIO();
      expect(await handleStatusCommand([], {}, { fred, io: active.io })).toBe(0);
      expect(active.stdout[0]).toContain('live-agent');
      expect(active.stdout[0]).toContain('live-workflow');
      expect(active.stdout[0]).toContain('live-session');
      expect(active.stdout[0]).toContain('starting');

      await fred.effects.run(Deferred.succeed(release, undefined));
      await fred.effects.run(Fiber.join(run));

      const completed = captureIO();
      expect(await handleStatusCommand([], {}, { fred, io: completed.io })).toBe(0);
      expect(completed.stdout).toEqual(['No agent runs are active.']);
    } finally {
      await fred.effects.run(Deferred.succeed(release, undefined));
      await fred.effects.run(Fiber.interrupt(run));
      await fred.shutdown();
    }
  });
});
