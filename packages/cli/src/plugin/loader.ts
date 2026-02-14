import { createRequire } from 'node:module';
import type { FredCliPlugin } from './api.js';
import type {
  PluginResolutionIssue,
  ResolvedPluginDeclaration,
} from './resolver.js';

export interface PluginLoadIssue {
  code: string;
  severity: 'error';
  pluginId: string;
  declarationSource: string;
  message: string;
  fix: string;
}

export interface LoadedPluginDeclaration extends ResolvedPluginDeclaration {
  plugin: FredCliPlugin;
}

export interface LoadPluginModulesResult {
  loaded: LoadedPluginDeclaration[];
  issues: PluginLoadIssue[];
}

const requireModule = createRequire(import.meta.url);

export function loadPluginModules(
  declarations: readonly ResolvedPluginDeclaration[],
  loadModule: (resolvedPath: string) => unknown = defaultLoadModule,
): LoadPluginModulesResult {
  const loaded: LoadedPluginDeclaration[] = [];
  const issues: PluginLoadIssue[] = [];

  for (const declaration of declarations) {
    try {
      const mod = loadModule(declaration.resolvedPath);
      const plugin = extractPlugin(mod);

      if (!plugin) {
        issues.push({
          code: 'plugin-manifest-missing',
          severity: 'error',
          pluginId: declaration.id,
          declarationSource: declaration.declarationSource,
          message: `Plugin module "${declaration.declarationSource}" does not export a valid Fred plugin manifest.`,
          fix: 'Export a Fred plugin object as the default export (or named "plugin") with a valid manifest.',
        });
        continue;
      }

      loaded.push({
        ...declaration,
        plugin,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push({
        code: 'plugin-load-failed',
        severity: 'error',
        pluginId: declaration.id,
        declarationSource: declaration.declarationSource,
        message: `Failed to load plugin module "${declaration.declarationSource}": ${reason}`,
        fix: 'Check the plugin entrypoint for runtime errors and ensure dependencies are installed.',
      });
    }
  }

  return { loaded, issues };
}

function extractPlugin(mod: unknown): FredCliPlugin | undefined {
  if (!mod || typeof mod !== 'object') {
    return undefined;
  }

  const moduleRecord = mod as Record<string, unknown>;
  const candidate = moduleRecord.default ?? moduleRecord.plugin;
  if (!candidate || typeof candidate !== 'object') {
    return undefined;
  }

  const plugin = candidate as FredCliPlugin;
  if (!plugin.manifest || typeof plugin.manifest !== 'object') {
    return undefined;
  }

  if (
    typeof plugin.manifest.id !== 'string' ||
    typeof plugin.manifest.name !== 'string' ||
    typeof plugin.manifest.version !== 'string'
  ) {
    return undefined;
  }

  return plugin;
}

function defaultLoadModule(resolvedPath: string): unknown {
  return requireModule(resolvedPath);
}

export type PluginDiscoverIssue = PluginResolutionIssue | PluginLoadIssue;
