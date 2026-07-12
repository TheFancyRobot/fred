/**
 * Config resolution and validation
 *
 * Loads and validates Fred config files, producing either valid config data
 * or structured diagnostics.
 */

import { loadValidatedConfig, type FrameworkConfig } from '@fancyrobot/fred';
import { AggregatedPluginValidationError, loadPluginsFromConfig } from '../plugin/manager.js';
import { detectProjectRoot } from './detect';
import { formatConfigDiagnostic, formatPluginDiagnostics } from './diagnostics';
import type { ConfigResolutionResult, ConfigDiagnostic } from './types';

/**
 * Resolve project config from current directory
 *
 * This function:
 * 1. Detects the project root and config file
 * 2. Loads the config file
 * 3. Validates the config
 * 4. Returns either validated config or structured diagnostics
 *
 * All errors are converted to structured diagnostics instead of throwing,
 * making it suitable for CLI use where we want to show actionable errors.
 *
 * @param startDir - Directory to start search from (defaults to process.cwd())
 * @returns Resolution result with config data or diagnostics
 */
export function resolveProjectConfig(
  startDir?: string
): ConfigResolutionResult<FrameworkConfig> {
  const diagnostics: ConfigDiagnostic[] = [];

  try {
    // Step 1: Detect project root
    const detection = detectProjectRoot(startDir);

    if (!detection.found || !detection.configPath) {
      diagnostics.push({
        code: 'config-not-found',
        severity: 'error',
        message: 'No Fred config file found',
        fix: 'Create a fred.config.ts, fred.config.json, or fred.config.yaml file in your project root. Run: fred init',
      });

      return {
        success: false,
        diagnostics,
      };
    }

    // Step 2: Load config file
    let config: FrameworkConfig;
    try {
      config = loadValidatedConfig(detection.configPath);
    } catch (error) {
      // Parse/load errors
      diagnostics.push(formatConfigDiagnostic(error as Error, detection.configPath));
      return {
        success: false,
        configPath: detection.configPath,
        diagnostics,
      };
    }

    // Step 3: Validate config
    // Step 3: Validate plugin declarations and compatibility through plugin manager
    if (config.plugins && config.plugins.length > 0) {
      try {
        loadPluginsFromConfig(config.plugins, detection.configPath);
      } catch (error) {
        if (error instanceof AggregatedPluginValidationError) {
          diagnostics.push(...formatPluginDiagnostics(error.issues, detection.configPath));
        } else {
          diagnostics.push(formatConfigDiagnostic(error as Error, detection.configPath));
        }
      }
    }

    if (diagnostics.length > 0) {
      return {
        success: false,
        configPath: detection.configPath,
        diagnostics,
      };
    }

    // Success!
    return {
      success: true,
      config,
      configPath: detection.configPath,
      diagnostics: [], // No errors or warnings
    };
  } catch (error) {
    // Unexpected errors (should be rare)
    diagnostics.push({
      code: 'config-unexpected-error',
      severity: 'error',
      message: error instanceof Error ? error.message : String(error),
      fix: 'This is an unexpected error. Please report it as a bug.',
    });

    return {
      success: false,
      diagnostics,
    };
  }
}

/**
 * Resolve config and throw if invalid
 *
 * Convenience wrapper that throws a detailed error if config is invalid.
 * Useful for programmatic usage where you want an exception on failure.
 *
 * @param startDir - Directory to start search from
 * @returns Validated config
 * @throws Error with diagnostic details if config is invalid
 */
export function resolveProjectConfigOrThrow(startDir?: string): {
  config: FrameworkConfig;
  configPath: string;
} {
  const result = resolveProjectConfig(startDir);

  if (!result.success) {
    // Format diagnostics into error message
    const errorMessages = result.diagnostics
      .filter(d => d.severity === 'error')
      .map(d => {
        const parts = [d.message];
        if (d.path) parts.push(`(${d.path})`);
        if (d.fix) parts.push(`Fix: ${d.fix}`);
        return parts.join(' ');
      })
      .join('\n');

    throw new Error(
      `Failed to resolve config:\n${errorMessages}`
    );
  }

  return {
    config: result.config!,
    configPath: result.configPath!,
  };
}
