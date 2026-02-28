import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  AggregatedPluginValidationError,
  loadPluginsFromConfig,
} from '../../src/plugin/manager';
import type { FredCliPlugin } from '../../src/plugin/api';

function makePlugin(id: string, compatibility?: Partial<FredCliPlugin['manifest']['compatibility']>): FredCliPlugin {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      compatibility: {
        apiVersion: '^1.0.0',
        requiresFredCli: '^0.2.0 || ^0.3.0',
        ...compatibility,
      },
    },
  };
}

function makeConfigFixture() {
  const root = mkdtempSync(join(tmpdir(), 'fred-plugin-manager-'));
  const configPath = join(root, 'fred.config.ts');
  const pluginDir = join(root, 'plugins');
  const localPluginPath = join(pluginDir, 'local.ts');
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(configPath, 'export default {}\n');
  writeFileSync(localPluginPath, 'export default {}\n');
  return { root, configPath, localPluginPath };
}

describe('loadPluginsFromConfig', () => {
  test('loads mixed npm/local declarations in declaration order', () => {
    const { configPath, localPluginPath } = makeConfigFixture();

    const moduleMap = new Map<string, FredCliPlugin>([
      ['/virtual/pkg-alpha/index.ts', makePlugin('@scope/pkg-alpha')],
      [localPluginPath, makePlugin('./plugins/local.ts')],
      ['/virtual/pkg-beta/index.ts', makePlugin('@scope/pkg-beta')],
    ]);

    const result = loadPluginsFromConfig(
      ['@scope/pkg-alpha', './plugins/local.ts', { id: 'friendly', source: '@scope/pkg-beta' }],
      configPath,
      {
        fredCliVersion: '0.2.0',
        resolveModule: (specifier) => `/virtual/${specifier.replace('@scope/', '').replace('/', '-')}/index.ts`,
        loadModule: (resolvedPath) => ({ default: moduleMap.get(resolvedPath) }),
      },
    );

    expect(result.plugins.map((entry) => entry.pluginId)).toEqual([
      '@scope/pkg-alpha',
      './plugins/local.ts',
      '@scope/pkg-beta',
    ]);
  });

  test('anchors local plugin path resolution to config directory', () => {
    const { configPath, localPluginPath } = makeConfigFixture();
    const loadedPaths: string[] = [];

    loadPluginsFromConfig(['./plugins/local.ts'], configPath, {
      fredCliVersion: '0.2.0',
      loadModule: (resolvedPath) => {
        loadedPaths.push(resolvedPath);
        return { default: makePlugin('./plugins/local.ts') };
      },
    });

    expect(loadedPaths).toEqual([localPluginPath]);
  });

  test('accepts plugins widened for 0.3.x compatibility ranges', () => {
    const { configPath } = makeConfigFixture();

    const result = loadPluginsFromConfig(['@scope/dual-range'], configPath, {
      fredCliVersion: '0.3.0',
      resolveModule: () => '/virtual/dual-range/index.ts',
      loadModule: () => ({
        default: makePlugin('@scope/dual-range', {
          requiresFredCli: '^0.2.0 || ^0.3.0',
        }),
      }),
    });

    expect(result.plugins).toHaveLength(1);
    expect(result.plugins[0]?.pluginId).toBe('@scope/dual-range');
  });

  test('reports invalid semver range as plugin validation issue', () => {
    const { configPath } = makeConfigFixture();

    expect(() =>
      loadPluginsFromConfig(['@scope/invalid-semver'], configPath, {
        fredCliVersion: '0.2.0',
        resolveModule: () => '/virtual/invalid/index.ts',
        loadModule: () => ({
          default: makePlugin('@scope/invalid-semver', {
            requiresFredCli: 'invalid-range',
          }),
        }),
      })
    ).toThrowError(AggregatedPluginValidationError);

    try {
      loadPluginsFromConfig(['@scope/invalid-semver'], configPath, {
        fredCliVersion: '0.2.0',
        resolveModule: () => '/virtual/invalid/index.ts',
        loadModule: () => ({
          default: makePlugin('@scope/invalid-semver', {
            requiresFredCli: 'invalid-range',
          }),
        }),
      });
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregatedPluginValidationError);
      const aggregated = error as AggregatedPluginValidationError;
      expect(aggregated.issues[0]?.code).toBe('plugin-requiresfredcli-invalid-range');
    }
  });

  test('treats incompatible requiresFredCli range as fatal with expected vs detected detail', () => {
    const { configPath } = makeConfigFixture();

    try {
      loadPluginsFromConfig(['@scope/incompatible'], configPath, {
        fredCliVersion: '0.2.0',
        resolveModule: () => '/virtual/incompatible/index.ts',
        loadModule: () => ({
          default: makePlugin('@scope/incompatible', {
            requiresFredCli: '^9.0.0',
          }),
        }),
      });
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregatedPluginValidationError);
      const aggregated = error as AggregatedPluginValidationError;
      const issue = aggregated.issues.find((candidate) => candidate.code === 'plugin-fred-version-incompatible');
      expect(issue).toBeDefined();
      expect(issue?.message).toContain('requires Fred CLI ^9.0.0');
      expect(issue?.message).toContain('detected Fred CLI 0.2.0');
    }
  });

  test('treats deprecated API marker as fatal', () => {
    const { configPath } = makeConfigFixture();

    try {
      loadPluginsFromConfig(['@scope/deprecated'], configPath, {
        fredCliVersion: '0.2.0',
        resolveModule: () => '/virtual/deprecated/index.ts',
        loadModule: () => ({
          default: makePlugin('@scope/deprecated', {
            deprecated: {
              since: '0.1.0',
              message: 'legacy command registration',
              replacement: 'registerCommandV2',
            },
          }),
        }),
      });
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregatedPluginValidationError);
      const aggregated = error as AggregatedPluginValidationError;
      expect(aggregated.issues.some((issue) => issue.code === 'plugin-api-deprecated')).toBeTrue();
    }
  });

  test('aggregates multiple failing plugin issues instead of failing fast', () => {
    const { configPath } = makeConfigFixture();

    try {
      loadPluginsFromConfig(['@scope/one', '@scope/two'], configPath, {
        fredCliVersion: '0.2.0',
        resolveModule: (specifier) => `/virtual/${specifier.replace('@scope/', '')}/index.ts`,
        loadModule: (resolvedPath) => {
          if (resolvedPath.includes('/one/')) {
            return {
              default: makePlugin('@scope/one', {
                requiresFredCli: '^9.0.0',
              }),
            };
          }

          return {
            default: makePlugin('@scope/two', {
              deprecated: {
                since: '0.1.0',
                message: 'legacy API usage',
              },
            }),
          };
        },
      });
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(AggregatedPluginValidationError);
      const aggregated = error as AggregatedPluginValidationError;
      const codes = aggregated.issues.map((issue) => issue.code);
      expect(codes).toContain('plugin-fred-version-incompatible');
      expect(codes).toContain('plugin-api-deprecated');
      expect(aggregated.issues.length).toBeGreaterThanOrEqual(2);
    }
  });
});
