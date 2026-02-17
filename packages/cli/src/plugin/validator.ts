import semver from 'semver';
import { PLUGIN_API_VERSION } from './api.js';
import type { LoadedPluginDeclaration } from './loader.js';

export interface PluginValidationIssue {
  code: string;
  severity: 'error';
  pluginId: string;
  declarationSource: string;
  message: string;
  fix: string;
}

export function validateLoadedPlugins(
  declarations: readonly LoadedPluginDeclaration[],
  fredCliVersion: string,
): PluginValidationIssue[] {
  const issues: PluginValidationIssue[] = [];

  for (const declaration of declarations) {
    const compatibility = declaration.plugin.manifest.compatibility;

    if (!semver.validRange(compatibility.requiresFredCli)) {
      issues.push({
        code: 'plugin-requiresfredcli-invalid-range',
        severity: 'error',
        pluginId: declaration.id,
        declarationSource: declaration.declarationSource,
        message: `Plugin "${declaration.id}" has an invalid requiresFredCli range: "${compatibility.requiresFredCli}".`,
        fix: 'Use a valid semver range for manifest.compatibility.requiresFredCli (for example: ^0.2.0).',
      });
      continue;
    }

    if (!semver.satisfies(fredCliVersion, compatibility.requiresFredCli, { includePrerelease: true })) {
      issues.push({
        code: 'plugin-fred-version-incompatible',
        severity: 'error',
        pluginId: declaration.id,
        declarationSource: declaration.declarationSource,
        message: `Plugin "${declaration.id}" requires Fred CLI ${compatibility.requiresFredCli} but detected Fred CLI ${fredCliVersion}.`,
        fix: `Upgrade/downgrade Fred CLI to satisfy ${compatibility.requiresFredCli}, or install a plugin version compatible with ${fredCliVersion}.`,
      });
    }

    if (!semver.validRange(compatibility.apiVersion)) {
      issues.push({
        code: 'plugin-apiversion-invalid-range',
        severity: 'error',
        pluginId: declaration.id,
        declarationSource: declaration.declarationSource,
        message: `Plugin "${declaration.id}" has an invalid apiVersion range: "${compatibility.apiVersion}".`,
        fix: `Use a valid semver range that targets the plugin API contract (current: ${PLUGIN_API_VERSION}).`,
      });
    } else if (!semver.satisfies(PLUGIN_API_VERSION, compatibility.apiVersion, { includePrerelease: true })) {
      issues.push({
        code: 'plugin-apiversion-incompatible',
        severity: 'error',
        pluginId: declaration.id,
        declarationSource: declaration.declarationSource,
        message: `Plugin "${declaration.id}" expects plugin API ${compatibility.apiVersion} but detected plugin API ${PLUGIN_API_VERSION}.`,
        fix: `Use a plugin version compatible with API ${PLUGIN_API_VERSION} or update Fred CLI to a compatible API version.`,
      });
    }

    if (compatibility.deprecated) {
      const replacement = compatibility.deprecated.replacement
        ? ` Use ${compatibility.deprecated.replacement} instead.`
        : '';

      issues.push({
        code: 'plugin-api-deprecated',
        severity: 'error',
        pluginId: declaration.id,
        declarationSource: declaration.declarationSource,
        message: `Plugin "${declaration.id}" uses deprecated plugin API since ${compatibility.deprecated.since}: ${compatibility.deprecated.message}.${replacement}`,
        fix: replacement
          ? `Migrate plugin "${declaration.id}" to ${compatibility.deprecated.replacement}.`
          : `Update plugin "${declaration.id}" to a release that no longer uses deprecated API features.`,
      });
    }
  }

  return issues;
}
