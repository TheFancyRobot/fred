/**
 * One-shot live agent status command.
 *
 * This adapter reads the Fred runtime supplied to the handler. It does not
 * attach to another process; the HTTP transport owns that boundary.
 */

import { createFred, type AgentRunInfo, type FredClient } from '@fancyrobot/fred';
import { AgentStatusService } from '@fancyrobot/fred/effect';
import { Effect } from 'effect';
import { sanitizeForTerminalTableCell } from '../runtime/terminal-sanitize.js';
import { sanitizeErrorForCli } from './error-sanitize.js';
import { StatusReadError } from './errors.js';

export interface StatusCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface StatusCommandDependencies {
  fred?: FredClient;
  io?: StatusCommandIO;
}

const DEFAULT_IO: StatusCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const formatTable = (runs: ReadonlyArray<AgentRunInfo>): string => {
  const headers = ['AGENT', 'STATE', 'WORKFLOW', 'SESSION', 'FIBER', 'STARTED'];
  const rows = runs.map((run) => {
    const cells: string[] = [
      run.agentId,
      run.state,
      run.workflowId ?? '-',
      run.sessionId ?? '-',
      run.fiberId,
      new Date(run.startedAt).toISOString(),
    ];
    return cells.map(sanitizeForTerminalTableCell);
  });
  const widths = headers.map((header, index) =>
    Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)),
  );
  const formatRow = (cells: ReadonlyArray<string>): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? cell.length)).join('  ');

  return [
    `${runs.length} active agent run${runs.length === 1 ? '' : 's'}`,
    '',
    formatRow(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(formatRow),
  ].join('\n');
};

const statusCommandEffect = (
  options: Record<string, unknown>,
  deps: StatusCommandDependencies,
  io: StatusCommandIO,
): Effect.Effect<number, StatusReadError> =>
  Effect.gen(function* () {
    const fred = deps.fred ?? (yield* Effect.tryPromise({
      try: () => createFred(),
      catch: (error) => new StatusReadError({ message: sanitizeErrorForCli(error) }),
    }));
    const runs = yield* Effect.tryPromise({
      try: () => fred.effects.run(
        Effect.flatMap(AgentStatusService, (service) => service.snapshot),
      ),
      catch: (error) => new StatusReadError({ message: sanitizeErrorForCli(error) }),
    });

    if (options.json === true) {
      io.stdout(JSON.stringify({
        ok: true,
        command: 'status',
        data: {
          activeRuns: runs.length,
          runs,
        },
      }, null, 2));
      return 0;
    }

    io.stdout(runs.length === 0 ? 'No agent runs are active.' : formatTable(runs));
    return 0;
  });

/** Read one snapshot from the Fred runtime supplied to this handler. */
export async function handleStatusCommand(
  _args: string[],
  options: Record<string, unknown>,
  deps: StatusCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;

  return Effect.runPromise(
    statusCommandEffect(options, deps, io).pipe(
      Effect.catchTag('StatusReadError', (error) =>
        Effect.sync(() => {
          if (options.json === true) {
            io.stdout(JSON.stringify({
              ok: false,
              command: 'status',
              error: { message: error.message },
            }, null, 2));
          } else {
            io.stderr(`Failed to read agent status: ${error.message}`);
          }
          return 1;
        }),
      ),
    ),
  );
}
