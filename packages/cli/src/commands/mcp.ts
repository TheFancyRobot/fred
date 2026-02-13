/**
 * MCP command handler
 *
 * Manage MCP server lifecycles from the CLI.
 * Subcommands: list, start, stop, status
 */

import { Fred } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { createColors } from './color.js';
import type { MCPServerRegistry } from '@fancyrobot/fred/mcp/registry';

export interface McpCommandIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

export interface McpCommandDependencies {
  fred?: Fred;
  io?: McpCommandIO;
  registry?: MCPServerRegistry; // Override for testing
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
 * Initialize Fred instance with config.
 */
async function initializeFred(io: McpCommandIO): Promise<Fred> {
  const fred = new Fred();
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.configPath) {
    try {
      await fred.initializeFromConfig(configResult.configPath);
    } catch (error) {
      io.stderr(`Failed to initialize from config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return fred;
}

/**
 * Handle `fred mcp list` command.
 */
async function handleMcpList(
  options: Record<string, unknown>,
  deps: McpCommandDependencies,
  io: McpCommandIO,
  fred: Fred,
): Promise<number> {
  const registry = deps.registry ?? fred.getMCPServerRegistry();
  const allServers = registry.getAllConfiguredServers();

  if (options.json === true) {
    const servers = allServers.map((id) => {
      const status = registry.getServerStatus(id) ?? 'stopped';
      const config = registry.getServerConfig(id);
      const transport = config?.transport ?? 'unknown';

      const client = registry.getClient(id);
      const toolCount = client ? undefined : undefined; // Will be populated if connected

      // Try to get tool count if connected
      let tools: number | undefined;
      if (client && client.isConnected()) {
        // We can't easily get tool count synchronously, so leave it undefined
        tools = undefined;
      }

      return {
        id,
        status,
        transport,
        ...(tools !== undefined ? { toolCount: tools } : {}),
      };
    });

    io.stdout(JSON.stringify({ ok: true, command: 'mcp-list', servers }, null, 2));
    return 0;
  }

  if (allServers.length === 0) {
    io.stdout('No MCP servers configured.');
    return 0;
  }

  const headers = ['ID', 'Status', 'Transport', 'Tools'];
  const rows = allServers.map((id) => {
    const status = registry.getServerStatus(id) ?? 'stopped';
    const config = registry.getServerConfig(id);
    const transport = config?.transport ?? 'unknown';

    const client = registry.getClient(id);
    let toolCount = '-';
    if (client && client.isConnected()) {
      // For connected servers, we could try to list tools, but it's async
      // For now, just show "-" for tool count in table view
      toolCount = '-';
    }

    return [id, status, transport, toolCount];
  });

  io.stdout(formatTable(headers, rows));
  return 0;
}

/**
 * Handle `fred mcp start` command.
 */
async function handleMcpStart(
  args: string[],
  options: Record<string, unknown>,
  deps: McpCommandDependencies,
  io: McpCommandIO,
  fred: Fred,
): Promise<number> {
  const registry = deps.registry ?? fred.getMCPServerRegistry();
  const colors = createColors(process.stdout.isTTY);

  if (options.all === true) {
    // Start all configured servers
    const allServers = registry.getAllConfiguredServers();
    const errors: string[] = [];

    for (const serverId of allServers) {
      try {
        await Effect.runPromise(registry.ensureConnected(serverId));
      } catch (error) {
        errors.push(`${serverId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (errors.length > 0) {
      io.stderr(colors.red(`Error (exit 2): Failed to start ${errors.length} server(s):`));
      for (const err of errors) {
        io.stderr(colors.red(`  ${err}`));
      }
      if (options.json === true) {
        io.stdout(JSON.stringify({ ok: false, command: 'mcp-start', servers: allServers, errors }, null, 2));
      }
      return 2;
    }

    const message = colors.green(`Started ${allServers.length} server(s)`);
    io.stdout(message);
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: true, command: 'mcp-start', servers: allServers }, null, 2));
    }
    return 0;
  }

  // Start a specific server
  const serverId = args[1];
  if (!serverId) {
    io.stderr(colors.red('Error (exit 2): Server ID is required. Usage: fred mcp start <id>'));
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, command: 'mcp-start', error: 'Server ID is required' }, null, 2));
    }
    return 2;
  }

  try {
    await Effect.runPromise(registry.ensureConnected(serverId));
    io.stdout(colors.green(`Started: ${serverId}`));
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: true, command: 'mcp-start', serverId }, null, 2));
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(colors.red(`Error (exit 2): Failed to start ${serverId}: ${message}`));
    io.stderr('Try running with --verbose for more details, or check server configuration.');
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, command: 'mcp-start', serverId, error: message }, null, 2));
    }
    return 2;
  }
}

/**
 * Handle `fred mcp stop` command.
 */
async function handleMcpStop(
  args: string[],
  options: Record<string, unknown>,
  deps: McpCommandDependencies,
  io: McpCommandIO,
  fred: Fred,
): Promise<number> {
  const registry = deps.registry ?? fred.getMCPServerRegistry();
  const colors = createColors(process.stdout.isTTY);

  if (options.all === true) {
    // Stop all connected servers
    const connectedServers = registry.getRegisteredServers();

    for (const serverId of connectedServers) {
      try {
        await Effect.runPromise(registry.removeServer(serverId));
      } catch (error) {
        // Log warning but continue
        io.stderr(colors.yellow(`Warning: Failed to stop ${serverId}: ${error instanceof Error ? error.message : String(error)}`));
      }
    }

    io.stdout(`Stopped ${connectedServers.length} server(s)`);
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: true, command: 'mcp-stop', servers: connectedServers }, null, 2));
    }
    return 0;
  }

  // Stop a specific server
  const serverId = args[1];
  if (!serverId) {
    io.stderr(colors.red('Error (exit 2): Server ID is required. Usage: fred mcp stop <id>'));
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, command: 'mcp-stop', error: 'Server ID is required' }, null, 2));
    }
    return 2;
  }

  try {
    await Effect.runPromise(registry.removeServer(serverId));
    io.stdout(`Stopped: ${serverId}`);
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: true, command: 'mcp-stop', serverId }, null, 2));
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(colors.red(`Failed to stop ${serverId}: ${message}`));
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, command: 'mcp-stop', serverId, error: message }, null, 2));
    }
    return 2;
  }
}

/**
 * Handle `fred mcp status` command.
 */
async function handleMcpStatus(
  args: string[],
  options: Record<string, unknown>,
  deps: McpCommandDependencies,
  io: McpCommandIO,
  fred: Fred,
): Promise<number> {
  const registry = deps.registry ?? fred.getMCPServerRegistry();
  const colors = createColors(process.stdout.isTTY);

  const serverId = args[1];
  if (!serverId) {
    io.stderr(colors.red('Error (exit 2): Server ID is required. Usage: fred mcp status <id>'));
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, command: 'mcp-status', error: 'Server ID is required' }, null, 2));
    }
    return 2;
  }

  const status = registry.getServerStatus(serverId);
  const config = registry.getServerConfig(serverId);

  if (!config) {
    io.stderr(colors.red(`Error (exit 1): Server "${serverId}" not found.`));
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, command: 'mcp-status', serverId, error: 'Server not found' }, null, 2));
    }
    return 1;
  }

  const client = registry.getClient(serverId);
  const isConnected = client?.isConnected() ?? false;
  const transport = config.transport;

  // Try to discover tools if connected
  let tools: any[] = [];
  if (isConnected && client) {
    try {
      const result = await Effect.runPromise(
        Effect.either(registry.discoverTools(serverId))
      );
      if (result._tag === 'Right') {
        tools = result.right;
      }
    } catch {
      // Ignore tool discovery errors
    }
  }

  if (options.json === true) {
    const statusData: any = {
      ok: true,
      command: 'mcp-status',
      server: {
        id: serverId,
        status: status ?? 'stopped',
        transport,
        connected: isConnected,
        toolCount: tools.length,
      },
    };

    if (options.verbose === true && tools.length > 0) {
      statusData.server.tools = tools.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
      }));
    }

    io.stdout(JSON.stringify(statusData, null, 2));
    return isConnected ? 0 : 1;
  }

  // Human-readable output
  io.stdout(`Server: ${serverId}`);
  io.stdout(`Status: ${status ?? 'stopped'}`);
  io.stdout(`Transport: ${transport}`);
  io.stdout(`Connected: ${isConnected ? 'yes' : 'no'}`);
  io.stdout(`Uptime: N/A`); // Not tracked by registry
  io.stdout(`Last error: none`); // Not tracked by registry
  io.stdout(`Tool count: ${tools.length}`);

  if (options.verbose === true && tools.length > 0) {
    io.stdout('\nTools:');
    for (const tool of tools) {
      io.stdout(`  - ${tool.name}: ${tool.description ?? '(no description)'}`);
    }
  }

  return isConnected ? 0 : 1;
}

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
  const fred = deps.fred ?? await initializeFred(io);

  const subcommand = args[0];

  try {
    switch (subcommand) {
      case 'list':
        return await handleMcpList(options, deps, io, fred);
      case 'start':
        return await handleMcpStart(args, options, deps, io, fred);
      case 'stop':
        return await handleMcpStop(args, options, deps, io, fred);
      case 'status':
        return await handleMcpStatus(args, options, deps, io, fred);
      default:
        io.stderr(`Error (exit 2): Unknown subcommand: ${subcommand ?? '(none)'}`);
        io.stderr('Available: list, start, stop, status');
        return 2;
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 2;
  }
}
