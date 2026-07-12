/**
 * Entity listing command handlers
 *
 * Exposes agents/tools/intents/providers/workflows listing via CLI.
 * Usage: fred agents, fred tools, fred intents, fred providers, fred workflows
 */

import { createFred, type FredClient } from '@fancyrobot/fred';
import { IntentMatcherService, ProviderRegistryService } from '@fancyrobot/fred/effect';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { sanitizeErrorForCli } from './error-sanitize.js';
import { ConfigInitError, FredInitError } from './errors.js';

export interface ListCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface ListCommandDependencies {
  fred?: FredClient;
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

/**
 * Initialize Fred instance with config, wrapped in Effect.
 */
const initializeFredEffect = (io: ListCommandIO): Effect.Effect<FredClient, ConfigInitError> =>
  Effect.gen(function* () {
    const configResult = resolveProjectConfig();
    const fred = yield* Effect.tryPromise({
        try: () => createFred({ configPath: configResult.success ? configResult.configPath : undefined }),
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
    return fred;
  });

async function listAgents(fred: FredClient, options: Record<string, unknown>, io: ListCommandIO): Promise<number> {
  const agents = await fred.agents.list();

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

async function listTools(fred: FredClient, options: Record<string, unknown>, io: ListCommandIO): Promise<number> {
  const tools = await fred.tools.list();

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

async function listIntents(fred: FredClient, options: Record<string, unknown>, io: ListCommandIO): Promise<number> {
  const intents = await fred.effects.run(
    Effect.flatMap(IntentMatcherService, (service) => service.getIntents()),
  );

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

async function listProviders(fred: FredClient, options: Record<string, unknown>, io: ListCommandIO): Promise<number> {
  const providers = await fred.effects.run(
    Effect.flatMap(ProviderRegistryService, (service) => service.listProviders()),
  );

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

async function listWorkflows(fred: FredClient, options: Record<string, unknown>, io: ListCommandIO): Promise<number> {
  const workflows = await fred.workflows.list();

  if (options.json === true) {
    const data = workflows.map((workflow) => ({ name: workflow.id }));
    io.stdout(JSON.stringify({ ok: true, command: 'workflows', data }, null, 2));
    return 0;
  }

  if (workflows.length === 0) {
    io.stdout('No workflows registered.');
    return 0;
  }

  const headers = ['Workflow'];
  const rows = workflows.map((workflow) => [workflow.id]);

  io.stdout(formatTable(headers, rows));
  return 0;
}

/**
 * Internal Effect program for the list command.
 */
const listCommandEffect = (
  entityType: string,
  _args: string[],
  options: Record<string, unknown>,
  deps: ListCommandDependencies,
): Effect.Effect<number, FredInitError> =>
  Effect.gen(function* () {
    const io = deps.io ?? DEFAULT_IO;

    const fred = deps.fred
      ? deps.fred
      : yield* initializeFredEffect(io).pipe(
          Effect.catchTag('ConfigInitError', () =>
            Effect.fail(new FredInitError({ message: 'Failed to initialize Fred' })),
          ),
        );

    const operation = (() => {
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
        return Promise.resolve(1);
      }
    })();
    return yield* Effect.tryPromise({
      try: () => operation,
      catch: (error) => new FredInitError({ message: sanitizeErrorForCli(error) }),
    });
  });

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

  return Effect.runPromise(
    listCommandEffect(entityType, args, options, deps).pipe(
      Effect.catchTag('FredInitError', (error) =>
        Effect.sync(() => {
          io.stderr(sanitizeErrorForCli(error));
          return 1;
        }),
      ),
    ),
  );
}
