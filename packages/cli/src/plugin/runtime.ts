import type { PluginCommandExecutionContext } from './api.js';
import {
  listRegisteredPluginCommands,
  type RegisteredPluginContributions,
} from './registry.js';

export interface PluginCommandDescriptor {
  pluginId: string;
  declarationSource: string;
  summary: string;
  canonicalName: string;
  topLevelName: string;
  namespacedName: string;
  topLevelAvailable: boolean;
  topLevelUnavailableReason?: string;
}

interface RegisteredCommandHandler {
  pluginId: string;
  execute: (args: string[], context: PluginCommandExecutionContext) => Promise<number | void> | number | void;
}

export interface PluginCommandDispatchResult {
  handled: boolean;
  exitCode: number;
}

export interface PluginCliRuntime {
  dispatch: (
    command: string,
    args: string[],
    context: PluginCommandExecutionContext,
  ) => Promise<PluginCommandDispatchResult>;
  listCommands: () => PluginCommandDescriptor[];
}

export interface CreatePluginCliRuntimeOptions {
  plugins: readonly RegisteredPluginContributions[];
  builtInCommands: ReadonlySet<string>;
}

export function createPluginCliRuntime(options: CreatePluginCliRuntimeOptions): PluginCliRuntime {
  const commandHandlers = new Map<string, RegisteredCommandHandler>();
  const descriptors: PluginCommandDescriptor[] = [];

  const registeredPluginCommands = listRegisteredPluginCommands(options.plugins);

  for (const registeredCommand of registeredPluginCommands) {
    const aliases = registeredCommand.command.aliases ?? [];
    const commandTokens = [registeredCommand.command.name, ...aliases];

    for (const commandToken of commandTokens) {
      const namespacedName = `${registeredCommand.pluginId}:${commandToken}`;
      const topLevelConflictReason = getTopLevelConflictReason(
        commandToken,
        commandHandlers,
        options.builtInCommands,
      );

      const topLevelAvailable = topLevelConflictReason === undefined;
      if (topLevelAvailable) {
        commandHandlers.set(commandToken, {
          pluginId: registeredCommand.pluginId,
          execute: registeredCommand.command.execute,
        });
      }

      if (!commandHandlers.has(namespacedName)) {
        commandHandlers.set(namespacedName, {
          pluginId: registeredCommand.pluginId,
          execute: registeredCommand.command.execute,
        });
      }

      descriptors.push({
        pluginId: registeredCommand.pluginId,
        declarationSource: registeredCommand.declarationSource,
        summary: registeredCommand.command.summary,
        canonicalName: registeredCommand.command.name,
        topLevelName: commandToken,
        namespacedName,
        topLevelAvailable,
        topLevelUnavailableReason: topLevelConflictReason,
      });
    }
  }

  return {
    async dispatch(command, args, context) {
      const handler = commandHandlers.get(command);
      if (!handler) {
        return {
          handled: false,
          exitCode: 1,
        };
      }

      try {
        const result = await handler.execute(args, context);
        return {
          handled: true,
          exitCode: typeof result === 'number' ? result : 0,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        context.stderr(`[plugin:${handler.pluginId}] ${message}`);
        return {
          handled: true,
          exitCode: 1,
        };
      }
    },
    listCommands() {
      return descriptors.slice();
    },
  };
}

function getTopLevelConflictReason(
  commandName: string,
  commandHandlers: ReadonlyMap<string, RegisteredCommandHandler>,
  builtInCommands: ReadonlySet<string>,
): string | undefined {
  if (builtInCommands.has(commandName)) {
    return `conflicts with built-in command "${commandName}"`;
  }

  const existing = commandHandlers.get(commandName);
  if (existing) {
    return `conflicts with plugin command from "${existing.pluginId}"`;
  }

  return undefined;
}
