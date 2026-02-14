import type { PluginCommandContribution, PluginSlashCommandContribution } from './api.js';
import type { LoadedPluginDeclaration } from './loader.js';

export interface RegisteredPluginContributions {
  pluginId: string;
  declarationSource: string;
  manifest: LoadedPluginDeclaration['plugin']['manifest'];
  commands: PluginCommandContribution[];
  slashCommands: PluginSlashCommandContribution[];
}

export function stagePluginContributions(
  declarations: readonly LoadedPluginDeclaration[],
): RegisteredPluginContributions[] {
  return declarations.map((declaration) => ({
    pluginId: declaration.id,
    declarationSource: declaration.declarationSource,
    manifest: declaration.plugin.manifest,
    commands: declaration.plugin.commands ?? [],
    slashCommands: declaration.plugin.slashCommands ?? [],
  }));
}
