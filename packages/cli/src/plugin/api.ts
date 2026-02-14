export const PLUGIN_API_VERSION = '1.0.0';

export interface PluginCompatibilityContract {
  apiVersion: string;
  requiresFredCli: string;
  deprecated?: {
    since: string;
    message: string;
    replacement?: string;
  };
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  compatibility: PluginCompatibilityContract;
}

export interface PluginCommandExecutionContext {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  signal?: AbortSignal;
}

export interface PluginSlashCommandExecutionContext {
  cwd: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export interface PluginCommandContribution {
  name: string;
  aliases?: string[];
  summary: string;
  execute: (
    args: string[],
    context: PluginCommandExecutionContext,
  ) => Promise<number | void> | number | void;
}

export interface PluginSlashCommandContribution {
  name: string;
  usage?: string;
  summary: string;
  available?: (context: PluginSlashCommandExecutionContext) => boolean | Promise<boolean>;
  execute: (
    args: string,
    context: PluginSlashCommandExecutionContext,
  ) => Promise<string | void> | string | void;
}

export interface FredCliPlugin {
  manifest: PluginManifest;
  commands?: PluginCommandContribution[];
  slashCommands?: PluginSlashCommandContribution[];
}
