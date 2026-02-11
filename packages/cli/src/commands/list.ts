/**
 * Entity listing command handlers
 *
 * Exposes agents/tools/intents/providers/workflows listing via CLI.
 * Usage: fred agents, fred tools, fred intents, fred providers, fred workflows
 */

import { Fred } from '@fancyrobot/fred';
import { resolveProjectConfig } from '../project/resolve-config.js';

export interface ListCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface ListCommandDependencies {
  fred?: Fred;
  io?: ListCommandIO;
}

const DEFAULT_IO: ListCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const ENTITY_TYPES = ['agents', 'tools', 'intents', 'providers', 'workflows'] as const;
type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * Format a generic table with dynamic column widths.
 *
 * Follows the same pattern as formatSessionsTable in session.ts:
 * dynamically-computed column widths, padEnd alignment, dash dividers.
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
 * Truncate a string to a maximum length, appending ellipsis if needed.
 */
function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 3) + '...';
}

async function initializeFred(io: ListCommandIO): Promise<Fred> {
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

function listAgents(fred: Fred, options: Record<string, unknown>, io: ListCommandIO): number {
  const agents = fred.getAgents();

  if (options.json === true) {
    const data = agents.map((agent) => ({
      id: agent.id,
      model: agent.config.model,
      platform: agent.config.platform,
    }));
    io.stdout(JSON.stringify({ ok: true, command: 'agents', data }, null, 2));
    return 0;
  }

  if (agents.length === 0) {
    io.stdout('No agents registered.');
    return 0;
  }

  const headers = ['ID', 'Model', 'Platform'];
  const rows = agents.map((agent) => [
    agent.id,
    agent.config.model,
    agent.config.platform,
  ]);

  io.stdout(formatTable(headers, rows));
  return 0;
}

function listTools(fred: Fred, options: Record<string, unknown>, io: ListCommandIO): number {
  const tools = fred.getTools();

  if (options.json === true) {
    const data = tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
    }));
    io.stdout(JSON.stringify({ ok: true, command: 'tools', data }, null, 2));
    return 0;
  }

  if (tools.length === 0) {
    io.stdout('No tools registered.');
    return 0;
  }

  const headers = ['ID', 'Name', 'Description'];
  const rows = tools.map((tool) => [
    tool.id,
    tool.name,
    truncate(tool.description, 60),
  ]);

  io.stdout(formatTable(headers, rows));
  return 0;
}

function listIntents(fred: Fred, options: Record<string, unknown>, io: ListCommandIO): number {
  const intents = fred.getIntents();

  if (options.json === true) {
    const data = intents.map((intent) => ({
      id: intent.id,
      target: intent.action.target,
      utteranceCount: intent.utterances.length,
      utterances: intent.utterances,
    }));
    io.stdout(JSON.stringify({ ok: true, command: 'intents', data }, null, 2));
    return 0;
  }

  if (intents.length === 0) {
    io.stdout('No intents registered.');
    return 0;
  }

  const headers = ['ID', 'Target', 'Utterances'];
  const rows = intents.map((intent) => [
    intent.id,
    intent.action.target,
    `${intent.utterances.length} phrases`,
  ]);

  io.stdout(formatTable(headers, rows));
  return 0;
}

function listProviders(fred: Fred, options: Record<string, unknown>, io: ListCommandIO): number {
  const providers = fred.listProviders();

  if (options.json === true) {
    const data = providers.map((id) => ({ id }));
    io.stdout(JSON.stringify({ ok: true, command: 'providers', data }, null, 2));
    return 0;
  }

  if (providers.length === 0) {
    io.stdout('No providers registered.');
    return 0;
  }

  const headers = ['Provider'];
  const rows = providers.map((provider) => [provider]);

  io.stdout(formatTable(headers, rows));
  return 0;
}

function listWorkflows(fred: Fred, options: Record<string, unknown>, io: ListCommandIO): number {
  const workflows = fred.getWorkflowManager()?.listWorkflows() ?? [];

  if (options.json === true) {
    const data = workflows.map((name) => ({ name }));
    io.stdout(JSON.stringify({ ok: true, command: 'workflows', data }, null, 2));
    return 0;
  }

  if (workflows.length === 0) {
    io.stdout('No workflows registered.');
    return 0;
  }

  const headers = ['Workflow'];
  const rows = workflows.map((workflow) => [workflow]);

  io.stdout(formatTable(headers, rows));
  return 0;
}

/**
 * Handle a list command for a given entity type.
 *
 * @param entityType - Entity to list: agents, tools, intents, providers, workflows
 * @param args - Positional arguments (unused for list commands)
 * @param options - CLI options (supports --json)
 * @param deps - Optional injected dependencies for testing
 * @returns Exit code (0 = success, 1 = error)
 */
export async function handleListCommand(
  entityType: string,
  args: string[],
  options: Record<string, unknown>,
  deps: ListCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const fred = deps.fred ?? await initializeFred(io);

  try {
    switch (entityType as EntityType) {
      case 'agents':
        return listAgents(fred, options, io);
      case 'tools':
        return listTools(fred, options, io);
      case 'intents':
        return listIntents(fred, options, io);
      case 'providers':
        return listProviders(fred, options, io);
      case 'workflows':
        return listWorkflows(fred, options, io);
      default:
        io.stderr(`Unknown entity type: ${entityType}. Available: ${ENTITY_TYPES.join(', ')}`);
        return 1;
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
