/**
 * MCP command handler
 *
 * Manage MCP server lifecycles from the CLI.
 * Subcommands: list, start, stop, status
 */

import {
  createFred,
  type FredClient,
  type MCPServerInfo,
} from '@fancyrobot/fred';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { createColors } from './color.js';
import { sanitizeErrorForCli } from './error-sanitize.js';
import {
  ConfigInitError,
  InvalidArgumentError,
  McpOperationError,
  UnknownSubcommandError,
} from './errors.js';

export interface McpCommandIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

export interface McpCommandDependencies {
  fred?: FredClient;
  io?: McpCommandIO;
}

const DEFAULT_IO: McpCommandIO = {
  stdout: (msg) => console.log(msg),
  stderr: (msg) => console.error(msg),
};

/**
 * Format a table with dynamic column widths.
 */
function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => {
    const values = rows.map((row) => row[index] ?? '');
    return Math.max(header.length, ...values.map((value) => value.length));
  });

  const formatRow = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');

  const headerLine = formatRow(headers);
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = rows.map((row) => formatRow(row));

  return [headerLine, divider, ...body].join('\n');
}

/**
 * Initialize Fred instance with config, wrapped in Effect.
 */
const initializeFredEffect = (io: McpCommandIO): Effect.Effect<FredClient, ConfigInitError> =>
  Effect.gen(function* () {
    const configResult = resolveProjectConfig();
    return yield* Effect.tryPromise({
      try: () => createFred({
        configPath: configResult.success ? configResult.configPath : undefined,
      }),
      catch: (error) =>
        new ConfigInitError({ message: `Failed to initialize from config: ${sanitizeErrorForCli(error)}` }),
    }).pipe(
      Effect.catchTag('ConfigInitError', (error) =>
        Effect.zipRight(
          Effect.sync(() => io.stderr(error.message)),
          Effect.tryPromise({
            try: () => createFred(),
            catch: (cause) => new ConfigInitError({ message: sanitizeErrorForCli(cause) }),
          }),
        ),
      ),
    );
  });

const listMcpServersEffect = (
  fred: FredClient,
): Effect.Effect<readonly MCPServerInfo[], McpOperationError> =>
  Effect.tryPromise({
    try: () => fred.mcp.listServers(),
    catch: (error) => new McpOperationError({ message: sanitizeErrorForCli(error) }),
  });

/**
 * Internal Effect program for `fred mcp list`.
 */
const mcpListEffect = (
  options: Record<string, unknown>,
  fred: FredClient,
  io: McpCommandIO,
): Effect.Effect<number, McpOperationError> =>
  Effect.gen(function* () {
    const allServers = yield* listMcpServersEffect(fred);

    if (options.json === true) {
      const servers = allServers.map((server) => ({
        id: server.id,
        status: server.status,
        transport: server.transport,
        ...(server.connected ? { toolCount: server.tools.length } : {}),
      }));

      io.stdout(JSON.stringify({ ok: true, command: 'mcp-list', servers }, null, 2));
      return 0;
    }

    if (allServers.length === 0) {
      io.stdout('No MCP servers configured.');
      return 0;
    }

    const headers = ['ID', 'Status', 'Transport', 'Tools'];
    const rows = allServers.map((server) => [
      server.id,
      server.status,
      server.transport,
      server.connected ? String(server.tools.length) : '-',
    ]);

    io.stdout(formatTable(headers, rows));
    return 0;
  });

/**
 * Internal Effect program for `fred mcp start`.
 */
const mcpStartEffect = (
  args: string[],
  options: Record<string, unknown>,
  fred: FredClient,
  io: McpCommandIO,
): Effect.Effect<number, InvalidArgumentError | McpOperationError> =>
  Effect.gen(function* () {
    const colors = createColors(process.stdout.isTTY);

    if (options.all === true) {
      const results = yield* Effect.tryPromise({
        try: () => fred.mcp.connectAll(),
        catch: (error) => new McpOperationError({ message: sanitizeErrorForCli(error) }),
      });
      const allServers = results.map((result) => result.id);
      const errors = results.flatMap((result) =>
        result.success ? [] : [`${result.id}: ${result.error ?? 'Unknown error'}`],
      );

      if (errors.length > 0) {
        if (options.json === true) {
          io.stdout(JSON.stringify({ ok: false, command: 'mcp-start', servers: allServers, errors }, null, 2));
        } else {
          io.stderr(colors.red(`Error (exit 2): Failed to start ${errors.length} server(s):`));
          for (const err of errors) {
            io.stderr(colors.red(`  ${err}`));
          }
        }
        return 2;
      }

      if (options.json === true) {
        io.stdout(JSON.stringify({ ok: true, command: 'mcp-start', servers: allServers }, null, 2));
      } else {
        const message = colors.green(`Started ${allServers.length} server(s)`);
        io.stdout(message);
      }
      return 0;
    }

    // Start a specific server
    const serverId = args[1];
    if (!serverId) {
      return yield* new InvalidArgumentError({ message: 'Server ID is required' });
    }

    yield* Effect.tryPromise({
      try: () => fred.mcp.connect(serverId),
      catch: (error) =>
        new McpOperationError({ serverId, message: sanitizeErrorForCli(error) }),
    });

    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: true, command: 'mcp-start', serverId }, null, 2));
    } else {
      io.stdout(colors.green(`Started: ${serverId}`));
    }
    return 0;
  });

/**
 * Internal Effect program for `fred mcp stop`.
 */
const mcpStopEffect = (
  args: string[],
  options: Record<string, unknown>,
  fred: FredClient,
  io: McpCommandIO,
): Effect.Effect<number, InvalidArgumentError | McpOperationError> =>
  Effect.gen(function* () {
    const colors = createColors(process.stdout.isTTY);

    if (options.all === true) {
      const results = yield* Effect.tryPromise({
        try: () => fred.mcp.disconnectAll(),
        catch: (error) => new McpOperationError({ message: sanitizeErrorForCli(error) }),
      });
      const connectedServers = results.map((result) => result.id);

      for (const result of results) {
        if (!result.success) {
          io.stderr(colors.yellow(
            `Warning: Failed to stop ${result.id}: ${result.error ?? 'Unknown error'}`,
          ));
        }
      }

      if (options.json === true) {
        io.stdout(JSON.stringify({ ok: true, command: 'mcp-stop', servers: connectedServers }, null, 2));
      } else {
        io.stdout(`Stopped ${connectedServers.length} server(s)`);
      }
      return 0;
    }

    // Stop a specific server
    const serverId = args[1];
    if (!serverId) {
      return yield* new InvalidArgumentError({ message: 'Server ID is required' });
    }

    yield* Effect.tryPromise({
      try: () => fred.mcp.disconnect(serverId),
      catch: (error) =>
        new McpOperationError({ serverId, message: sanitizeErrorForCli(error) }),
    });

    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: true, command: 'mcp-stop', serverId }, null, 2));
    } else {
      io.stdout(`Stopped: ${serverId}`);
    }
    return 0;
  });

/**
 * Internal Effect program for `fred mcp status`.
 */
const mcpStatusEffect = (
  args: string[],
  options: Record<string, unknown>,
  fred: FredClient,
  io: McpCommandIO,
): Effect.Effect<number, InvalidArgumentError | McpOperationError> =>
  Effect.gen(function* () {
    const colors = createColors(process.stdout.isTTY);

    const serverId = args[1];
    if (!serverId) {
      return yield* new InvalidArgumentError({ message: 'Server ID is required' });
    }

    const servers = yield* listMcpServersEffect(fred);
    const server = servers.find((candidate) => candidate.id === serverId);
    if (!server) {
      return yield* new McpOperationError({ serverId, message: 'Server not found' });
    }

    const { connected: isConnected, tools, toolDiscoveryFailed = false } = server;

    if (options.json === true) {
      const statusData = {
        ok: true,
        command: 'mcp-status',
        server: {
          id: serverId,
          status: server.status,
          transport: server.transport,
          connected: isConnected,
          toolCount: toolDiscoveryFailed ? null : tools.length,
          ...(toolDiscoveryFailed ? { toolDiscoveryFailed: true } : {}),
          ...(options.verbose === true && tools.length > 0
            ? {
                tools: tools.map((tool) => ({
                  id: tool.id,
                  name: tool.name,
                  description: tool.description,
                })),
              }
            : {}),
        },
      };

      io.stdout(JSON.stringify(statusData, null, 2));
      return isConnected ? 0 : 1;
    }

    // Human-readable output
    io.stdout(`Server: ${serverId}`);
    io.stdout(`Status: ${server.status}`);
    io.stdout(`Transport: ${server.transport}`);
    io.stdout(`Connected: ${isConnected ? 'yes' : 'no'}`);
    io.stdout(`Uptime: N/A`);
    io.stdout(`Last error: none`);
    io.stdout(`Tool count: ${toolDiscoveryFailed ? 'discovery failed' : tools.length}`);

    if (options.verbose === true && tools.length > 0) {
      io.stdout('\nTools:');
      for (const tool of tools) {
        io.stdout(`  - ${tool.name}: ${tool.description ?? '(no description)'}`);
      }
    }

    return isConnected ? 0 : 1;
  });

/**
 * Internal Effect program for the mcp command dispatcher.
 */
const mcpCommandEffect = (
  args: string[],
  options: Record<string, unknown>,
  deps: McpCommandDependencies,
): Effect.Effect<
  number,
  InvalidArgumentError | McpOperationError | UnknownSubcommandError
> =>
  Effect.gen(function* () {
    const io = deps.io ?? DEFAULT_IO;
    const colors = createColors(process.stdout.isTTY);

    const fred = deps.fred
      ? deps.fred
      : yield* initializeFredEffect(io).pipe(
          Effect.mapError((error) =>
            new McpOperationError({ message: error.message }),
          ),
        );

    const subcommand = args[0];

    switch (subcommand) {
      case 'list':
        return yield* mcpListEffect(options, fred, io);
      case 'start':
        return yield* mcpStartEffect(args, options, fred, io);
      case 'stop':
        return yield* mcpStopEffect(args, options, fred, io);
      case 'status':
        return yield* mcpStatusEffect(args, options, fred, io);
      default:
        return yield* new UnknownSubcommandError({
          subcommand: subcommand ?? '(none)',
          available: 'list, start, stop, status',
          message: `Unknown subcommand: ${subcommand ?? '(none)'}. Available: list, start, stop, status`,
        });
    }
  });

/**
 * Handle `fred mcp` command.
 *
 * Subcommands: list, start, stop, status
 */
export async function handleMcpCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: McpCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const colors = createColors(process.stdout.isTTY);

  return Effect.runPromise(
    mcpCommandEffect(args, options, deps).pipe(
      Effect.catchTags({
        InvalidArgumentError: (error) =>
          Effect.succeed((() => {
            const subcommand = args[0] ?? 'mcp';
            const commandName = `mcp-${subcommand}`;
            if (options.json === true) {
              io.stdout(JSON.stringify({ ok: false, command: commandName, error: error.message }, null, 2));
            } else {
              io.stderr(colors.red(`Error (exit 2): ${error.message}. Usage: fred mcp ${subcommand} <id>`));
            }
            return 2;
          })()),
        McpOperationError: (error) =>
          Effect.succeed((() => {
            const subcommand = args[0] ?? 'mcp';
            const commandName = `mcp-${subcommand}`;
            const serverId = error.serverId;

            // "Server not found" from status subcommand returns exit 1
            if (subcommand === 'status' && error.message === 'Server not found') {
              if (options.json === true) {
                io.stdout(JSON.stringify({ ok: false, command: commandName, serverId, error: error.message }, null, 2));
              } else {
                io.stderr(colors.red(`Error (exit 1): Server "${serverId}" not found.`));
              }
              return 1;
            }

            if (options.json === true) {
              io.stdout(JSON.stringify({
                ok: false,
                command: commandName,
                ...(serverId ? { serverId } : {}),
                error: error.message,
              }, null, 2));
            } else {
              if (serverId) {
                io.stderr(colors.red(`Error (exit 2): Failed to ${subcommand} ${serverId}: ${error.message}`));
                io.stderr('Try running with --verbose for more details, or check server configuration.');
              } else {
                io.stderr(colors.red(`Error (exit 2): ${error.message}`));
              }
            }
            return 2;
          })()),
        UnknownSubcommandError: (error) =>
          Effect.succeed((() => {
            if (options.json === true) {
              io.stdout(JSON.stringify({ ok: false, command: 'mcp', error: error.message }, null, 2));
            } else {
              io.stderr(`Error (exit 2): ${error.message}`);
              io.stderr(`Available: ${error.available}`);
            }
            return 2;
          })()),
      }),
    ),
  );
}
