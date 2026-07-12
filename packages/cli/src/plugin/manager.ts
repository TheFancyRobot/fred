import { readFileSync } from 'node:fs';
import { normalizePluginDeclarations, PluginDeclarationValidationError } from './schema.js';
import { loadPluginModules, type PluginDiscoverIssue } from './loader.js';
import { stagePluginContributions, type RegisteredPluginContributions } from './registry.js';
import { resolvePluginDeclarations } from './resolver.js';
import { validateLoadedPlugins, type PluginValidationIssue } from './validator.js';
import type { PluginDeclaration } from '@fancyrobot/fred';

export interface PluginStartupIssue {
  code: string;
  severity: 'error';
  pluginId: string;
  declarationSource: string;
  message: string;
  fix: string;
}

export class AggregatedPluginValidationError extends Error {
  readonly issues: PluginStartupIssue[];

  constructor(issues: PluginStartupIssue[]) {
    super(`Plugin validation failed with ${issues.length} issue${issues.length === 1 ? '' : 's'}.`);
    this.name = 'AggregatedPluginValidationError';
    this.issues = issues;
  }
}

export interface LoadPluginsFromConfigOptions {
  fredCliVersion?: string;
  resolveModule?: (specifier: string, fromDir: string) => string;
  loadModule?: (resolvedPath: string) => unknown;
}

export interface LoadPluginsFromConfigResult {
  plugins: RegisteredPluginContributions[];
}

const DEFAULT_FRED_CLI_VERSION = getCliVersionFromPackageJson();

export function loadPluginsFromConfig(
  declarations: readonly PluginDeclaration[] | undefined,
  configPath: string,
  options: LoadPluginsFromConfigOptions = {},
): LoadPluginsFromConfigResult {
  const issues: PluginStartupIssue[] = [];
  const normalized = normalizeDeclarations(declarations, issues);

  // Phase 1: discover + validate all plugin declarations.
  const resolution = resolvePluginDeclarations(normalized, configPath, options.resolveModule);
  issues.push(...resolution.issues.map(mapIssue));

  const discovery = loadPluginModules(resolution.resolved, options.loadModule);
  issues.push(...discovery.issues.map(mapIssue));

  const fredCliVersion = options.fredCliVersion ?? DEFAULT_FRED_CLI_VERSION;
  const validationIssues = validateLoadedPlugins(discovery.loaded, fredCliVersion);
  issues.push(...validationIssues.map(mapIssue));

  if (issues.length > 0) {
    throw new AggregatedPluginValidationError(issues);
  }

  // Phase 2: register staged contributions only after validation is clean.
  const plugins = stagePluginContributions(discovery.loaded);
  return { plugins };
}

function normalizeDeclarations(
  declarations: readonly PluginDeclaration[] | undefined,
  issues: PluginStartupIssue[],
) {
  try {
    return normalizePluginDeclarations(declarations);
  } catch (error) {
    if (error instanceof PluginDeclarationValidationError) {
      issues.push({
        code: error.code,
        severity: 'error',
        pluginId: 'unknown-plugin',
        declarationSource: 'plugins[]',
        message: error.message,
        fix: 'Fix plugin declaration entries in your config and run `fred config validate` again.',
      });
      return [];
    }

    throw error;
  }
}

function mapIssue(issue: PluginDiscoverIssue | PluginValidationIssue): PluginStartupIssue {
  return {
    code: issue.code,
    severity: issue.severity,
    pluginId: issue.pluginId,
    declarationSource: issue.declarationSource,
    message: issue.message,
    fix: issue.fix,
  };
}

function getCliVersionFromPackageJson(): string {
  try {
    const packageJsonUrl = new URL('../../package.json', import.meta.url);
    const raw = readFileSync(packageJsonUrl, 'utf-8');
    const parsed = JSON.parse(raw) as { version?: unknown };
    if (typeof parsed.version === 'string' && parsed.version.length > 0) {
      return parsed.version;
    }
  } catch {
    // Ignore and use fallback.
  }

  return '0.0.0';
}
