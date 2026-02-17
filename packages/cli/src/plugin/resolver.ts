import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { NormalizedPluginDeclaration } from './schema.js';

export interface PluginResolutionIssue {
  code: string;
  severity: 'error';
  pluginId: string;
  declarationSource: string;
  message: string;
  fix: string;
}

export interface ResolvedPluginDeclaration extends NormalizedPluginDeclaration {
  declarationSource: string;
  resolvedPath: string;
  importTarget: string;
}

export interface ResolvePluginDeclarationsResult {
  resolved: ResolvedPluginDeclaration[];
  issues: PluginResolutionIssue[];
}

export function resolvePluginDeclarations(
  declarations: readonly NormalizedPluginDeclaration[],
  configPath: string,
  resolveModule: (specifier: string, fromDir: string) => string = defaultResolveModule,
): ResolvePluginDeclarationsResult {
  const configDir = dirname(configPath);
  const resolved: ResolvedPluginDeclaration[] = [];
  const issues: PluginResolutionIssue[] = [];

  for (const declaration of declarations) {
    if (declaration.sourceType === 'path') {
      const absolutePath = isAbsolute(declaration.source)
        ? declaration.source
        : resolvePath(configDir, declaration.source);

      if (!existsSync(absolutePath)) {
        issues.push({
          code: 'plugin-path-not-found',
          severity: 'error',
          pluginId: declaration.id,
          declarationSource: declaration.source,
          message: `Local plugin path does not exist: ${absolutePath}`,
          fix: `Create the plugin module at ${absolutePath} or update the plugin source path in your config.`,
        });
        continue;
      }

      resolved.push({
        ...declaration,
        declarationSource: declaration.source,
        resolvedPath: absolutePath,
        importTarget: pathToFileURL(absolutePath).href,
      });
      continue;
    }

    try {
      const packageEntryPath = resolveModule(declaration.source, configDir);
      resolved.push({
        ...declaration,
        declarationSource: declaration.source,
        resolvedPath: packageEntryPath,
        importTarget: pathToFileURL(packageEntryPath).href,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      issues.push({
        code: 'plugin-module-not-found',
        severity: 'error',
        pluginId: declaration.id,
        declarationSource: declaration.source,
        message: `Unable to resolve plugin module "${declaration.source}": ${reason}`,
        fix: `Install plugin package "${declaration.source}" or fix the source specifier in your config.`,
      });
    }
  }

  return { resolved, issues };
}

function defaultResolveModule(specifier: string, fromDir: string): string {
  return Bun.resolveSync(specifier, fromDir);
}
