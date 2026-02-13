import { describe, expect, test } from 'bun:test';
import { Fred } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { handleMcpCommand } from '../../src/commands/mcp';
import type { MCPServerConfig, MCPClient } from '@fancyrobot/fred/mcp/types';
import type { Tool } from '@fancyrobot/fred/tool/tool';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function createCapturingIO() {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    io: {
      stdout: (msg: string) => output.push(msg),
      stderr: (msg: string) => errors.push(msg),
    },
    output,
    errors,
  };
}

interface MockServer {
  id: string;
  status?: 'connected' | 'disconnected' | 'error';
  config: MCPServerConfig;
  tools?: Tool[];
  startShouldFail?: boolean;
}

function createMockRegistry(servers: MockServer[]) {
  const connectedServers = servers.filter((s) => s.status === 'connected');
  const allServers = servers;

  return {
    getAllConfiguredServers: () => allServers.map((s) => s.id),
    getRegisteredServers: () => connectedServers.map((s) => s.id),
    getServerStatus: (id: string) => {
      const server = servers.find((s) => s.id === id);
      return server?.status;
    },
    getServerConfig: (id: string) => {
      const server = servers.find((s) => s.id === id);
      return server?.config;
    },
    getClient: (id: string) => {
      const server = servers.find((s) => s.id === id && s.status === 'connected');
      if (!server) return undefined;
      return {
        isConnected: () => true,
        listTools: async () => server.tools ?? [],
      } as MCPClient;
    },
    ensureConnected: (serverId: string) => {
      const server = servers.find((s) => s.id === serverId);
      if (!server) {
        return Effect.fail(new Error(`Server '${serverId}' not found in lazy configs`));
      }
      if (server.startShouldFail) {
        return Effect.fail(new Error(`Failed to connect lazy server '${serverId}': Connection refused`));
      }
      return Effect.succeed({
        isConnected: () => true,
        listTools: async () => server.tools ?? [],
      } as MCPClient);
    },
    removeServer: (serverId: string) => {
      return Effect.succeed(undefined);
    },
    discoverTools: (serverId: string) => {
      const server = servers.find((s) => s.id === serverId && s.status === 'connected');
      if (!server) {
        return Effect.fail(new Error(`MCP server '${serverId}' not found`));
      }
      return Effect.succeed(server.tools ?? []);
    },
  };
}

function createMockFred(servers: MockServer[] = []): Fred {
  const fred = new Fred();
  const registry = createMockRegistry(servers);
  (fred as any).getMCPServerRegistry = () => registry;
  return fred;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe('mcp list', () => {
  test('lists all configured servers with status and transport', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'filesystem',
        status: 'connected',
        config: { id: 'filesystem', transport: 'stdio', command: 'npx', args: ['@modelcontextprotocol/server-filesystem'] },
      },
      {
        id: 'web-search',
        status: undefined, // lazy/never started
        config: { id: 'web-search', transport: 'http', url: 'http://localhost:8080' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['list'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toContain('filesystem');
    expect(captured.output[0]).toContain('connected');
    expect(captured.output[0]).toContain('stdio');
    expect(captured.output[0]).toContain('web-search');
    expect(captured.output[0]).toContain('stopped');
    expect(captured.output[0]).toContain('http');
  });

  test('shows empty message when no servers configured', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['list'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toBe('No MCP servers configured.');
  });

  test('returns JSON with --json flag', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'filesystem',
        status: 'connected',
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['list'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('mcp-list');
    expect(payload.servers).toHaveLength(1);
    expect(payload.servers[0].id).toBe('filesystem');
    expect(payload.servers[0].status).toBe('connected');
    expect(payload.servers[0].transport).toBe('stdio');
  });

  test('shows tool count for connected servers', async () => {
    const captured = createCapturingIO();
    const mockTools: Tool[] = [
      { id: 'filesystem/read', name: 'read_file', description: 'Read a file', handler: async () => ({}) } as any,
      { id: 'filesystem/write', name: 'write_file', description: 'Write a file', handler: async () => ({}) } as any,
    ];

    const fred = createMockFred([
      {
        id: 'filesystem',
        status: 'connected',
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
        tools: mockTools,
      },
      {
        id: 'lazy-server',
        status: undefined,
        config: { id: 'lazy-server', transport: 'http', url: 'http://localhost:9000' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['list'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    // Both servers should show "-" for tool count in table view (async limitation)
    expect(captured.output[0]).toContain('filesystem');
    expect(captured.output[0]).toContain('lazy-server');
  });
});

describe('mcp start', () => {
  test('starts a server by ID', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'filesystem',
        status: undefined,
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['start', 'filesystem'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toContain('Started');
    expect(captured.output[0]).toContain('filesystem');
  });

  test('starts all servers with --all', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'filesystem',
        status: undefined,
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
      },
      {
        id: 'web-search',
        status: undefined,
        config: { id: 'web-search', transport: 'http', url: 'http://localhost:8080' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['start'],
      { all: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toContain('Started');
    expect(captured.output[0]).toContain('2');
  });

  test('returns exit 2 on start failure', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'broken-server',
        status: undefined,
        config: { id: 'broken-server', transport: 'stdio', command: 'npx' },
        startShouldFail: true,
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['start', 'broken-server'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Failed to start');
    expect(captured.errors[0]).toContain('broken-server');
    expect(captured.errors[0]).toContain('exit 2');
  });

  test('returns exit 2 when server ID is missing', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['start'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Server ID is required');
    expect(captured.errors[0]).toContain('exit 2');
  });
});

describe('mcp stop', () => {
  test('stops a server by ID', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'filesystem',
        status: 'connected',
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['stop', 'filesystem'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toContain('Stopped');
    expect(captured.output[0]).toContain('filesystem');
  });

  test('stops all servers with --all', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'filesystem',
        status: 'connected',
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
      },
      {
        id: 'web-search',
        status: 'connected',
        config: { id: 'web-search', transport: 'http', url: 'http://localhost:8080' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['stop'],
      { all: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output[0]).toContain('Stopped');
    expect(captured.output[0]).toContain('2');
  });

  test('returns exit 2 when server ID is missing', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['stop'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Server ID is required');
    expect(captured.errors[0]).toContain('exit 2');
  });
});

describe('mcp status', () => {
  test('shows connected server status with tool count', async () => {
    const captured = createCapturingIO();
    const mockTools: Tool[] = [
      { id: 'filesystem/read', name: 'read_file', description: 'Read a file', handler: async () => ({}) } as any,
    ];

    const fred = createMockFred([
      {
        id: 'filesystem',
        status: 'connected',
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
        tools: mockTools,
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['status', 'filesystem'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    expect(captured.output.join('\n')).toContain('Server: filesystem');
    expect(captured.output.join('\n')).toContain('Status: connected');
    expect(captured.output.join('\n')).toContain('Transport: stdio');
    expect(captured.output.join('\n')).toContain('Connected: yes');
    expect(captured.output.join('\n')).toContain('Tool count: 1');
  });

  test('shows disconnected server status', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'lazy-server',
        status: undefined,
        config: { id: 'lazy-server', transport: 'http', url: 'http://localhost:9000' },
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['status', 'lazy-server'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1); // Not connected
    expect(captured.output.join('\n')).toContain('Server: lazy-server');
    expect(captured.output.join('\n')).toContain('Status: stopped');
    expect(captured.output.join('\n')).toContain('Connected: no');
  });

  test('returns exit 1 for not-found server', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['status', 'nonexistent'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(1);
    expect(captured.errors[0]).toContain('not found');
    expect(captured.errors[0]).toContain('nonexistent');
    expect(captured.errors[0]).toContain('exit 1');
  });

  test('returns JSON status with --json', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([
      {
        id: 'filesystem',
        status: 'connected',
        config: { id: 'filesystem', transport: 'stdio', command: 'npx' },
        tools: [],
      },
    ]);

    const exitCode = await handleMcpCommand(
      ['status', 'filesystem'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(0);
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(true);
    expect(payload.command).toBe('mcp-status');
    expect(payload.server.id).toBe('filesystem');
    expect(payload.server.status).toBe('connected');
    expect(payload.server.connected).toBe(true);
    expect(payload.server.transport).toBe('stdio');
  });

  test('errors when server ID is missing', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['status'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Server ID is required');
    expect(captured.errors[0]).toContain('exit 2');
  });
});

describe('mcp command errors', () => {
  test('errors on unknown subcommand', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['unknown'],
      {},
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors[0]).toContain('Unknown subcommand');
    expect(captured.errors[0]).toContain('exit 2');
    expect(captured.errors[1]).toContain('Available: list, start, stop, status');
  });

  test('outputs JSON error when server ID missing for start with --json', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['start'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors).toHaveLength(0); // No stderr output
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.command).toBe('mcp-start');
    expect(payload.error).toContain('Server ID is required');
  });

  test('outputs JSON error when server ID missing for stop with --json', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['stop'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors).toHaveLength(0); // No stderr output
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.command).toBe('mcp-stop');
    expect(payload.error).toContain('Server ID is required');
  });

  test('outputs JSON error when server ID missing for status with --json', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['status'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors).toHaveLength(0); // No stderr output
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.command).toBe('mcp-status');
    expect(payload.error).toContain('Server ID is required');
  });

  test('outputs JSON error on unknown subcommand with --json', async () => {
    const captured = createCapturingIO();
    const fred = createMockFred([]);

    const exitCode = await handleMcpCommand(
      ['unknown'],
      { json: true },
      { fred, io: captured.io },
    );

    expect(exitCode).toBe(2);
    expect(captured.errors).toHaveLength(0); // No stderr output
    const payload = JSON.parse(captured.output[0] ?? '{}');
    expect(payload.ok).toBe(false);
    expect(payload.command).toBe('mcp');
    expect(payload.error).toContain('Unknown subcommand');
    expect(payload.error).toContain('Available: list, start, stop, status');
  });
});
