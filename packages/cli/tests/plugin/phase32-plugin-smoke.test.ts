import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(import.meta.dir, '../../../..');
const CLI_ENTRY = join(REPO_ROOT, 'packages/cli/src/index.ts');

const createdTempDirs: string[] = [];

function runCli(args: string[], cwd: string) {
  return spawnSync('bun', ['run', CLI_ENTRY, ...args], {
    cwd,
    env: process.env,
    encoding: 'utf-8',
  });
}

function writePluginPackage(
  projectRoot: string,
  packageName: string,
  source: string,
): void {
  const packageDir = join(projectRoot, 'node_modules', packageName);
  mkdirSync(packageDir, { recursive: true });
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    main: 'index.js',
  }, null, 2));
  writeFileSync(join(packageDir, 'index.js'), source);
}

function createValidPluginProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'fred-phase32-plugin-smoke-'));
  createdTempDirs.push(projectRoot);

  mkdirSync(join(projectRoot, 'plugins'), { recursive: true });

  writePluginPackage(projectRoot, 'npm-plugin', `
module.exports = {
  plugin: {
    manifest: {
      id: 'npm-plugin',
      name: 'NPM Plugin',
      version: '1.0.0',
      compatibility: {
        apiVersion: '^1.0.0',
        requiresFredCli: '^0.2.0 || ^0.3.0'
      }
    },
    commands: [
      {
        name: 'deploy',
        summary: 'Deploy from npm plugin',
        execute(args, context) {
          context.stdout('npm deploy ' + args.join(','));
          return 0;
        }
      }
    ]
  }
};
`);

  writePluginPackage(projectRoot, 'object-plugin', `
module.exports = {
  plugin: {
    manifest: {
      id: 'object-plugin',
      name: 'Object Plugin',
      version: '1.0.0',
      compatibility: {
        apiVersion: '^1.0.0',
        requiresFredCli: '^0.2.0 || ^0.3.0'
      }
    },
    commands: [
      {
        name: 'run',
        summary: 'Plugin run variant',
        execute(args, context) {
          context.stdout('object run ' + args.join(','));
          return 0;
        }
      }
    ]
  }
};
`);

  writeFileSync(join(projectRoot, 'plugins', 'local-plugin.cjs'), `
module.exports = {
  plugin: {
    manifest: {
      id: 'local-plugin',
      name: 'Local Plugin',
      version: '1.0.0',
      compatibility: {
        apiVersion: '^1.0.0',
        requiresFredCli: '^0.2.0 || ^0.3.0'
      }
    },
    commands: [
      {
        name: 'local-info',
        summary: 'Local command',
        execute(args, context) {
          context.stdout('local info ' + args.join(','));
          return 0;
        }
      }
    ]
  }
};
`);

  writeFileSync(join(projectRoot, 'fred.config.json'), JSON.stringify({
    agents: [
      {
        id: 'assistant',
        systemMessage: 'Test assistant',
        platform: 'openai',
        model: 'gpt-4o-mini',
      },
    ],
    plugins: [
      'npm-plugin',
      './plugins/local-plugin.cjs',
      {
        id: 'friendly-id',
        source: 'object-plugin',
      },
    ],
  }, null, 2));

  return projectRoot;
}

function createInvalidPluginProject(): string {
  const projectRoot = mkdtempSync(join(tmpdir(), 'fred-phase32-plugin-invalid-'));
  createdTempDirs.push(projectRoot);

  writePluginPackage(projectRoot, 'incompatible-plugin', `
module.exports = {
  plugin: {
    manifest: {
      id: 'incompatible-plugin',
      name: 'Incompatible Plugin',
      version: '1.0.0',
      compatibility: {
        apiVersion: '^1.0.0',
        requiresFredCli: '^9.0.0'
      }
    }
  }
};
`);

  writePluginPackage(projectRoot, 'deprecated-plugin', `
module.exports = {
  plugin: {
    manifest: {
      id: 'deprecated-plugin',
      name: 'Deprecated Plugin',
      version: '1.0.0',
      compatibility: {
        apiVersion: '^1.0.0',
        requiresFredCli: '^0.2.0 || ^0.3.0',
        deprecated: {
          since: '0.1.0',
          message: 'legacy API usage',
          replacement: 'registerCommandV2'
        }
      }
    }
  }
};
`);

  writeFileSync(join(projectRoot, 'fred.config.json'), JSON.stringify({
    agents: [
      {
        id: 'assistant',
        systemMessage: 'Test assistant',
        platform: 'openai',
        model: 'gpt-4o-mini',
      },
    ],
    plugins: ['incompatible-plugin', 'deprecated-plugin'],
  }, null, 2));

  return projectRoot;
}

afterEach(() => {
  while (createdTempDirs.length > 0) {
    const dir = createdTempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('phase 32 plugin CLI smoke', () => {
  test('loads mixed declarations and renders plugin help with unavailable stubs', () => {
    const projectRoot = createValidPluginProject();
    const result = runCli(['help'], projectRoot);

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('Plugin Commands:');
    expect(result.stdout).toContain('deploy');
    expect(result.stdout).toContain('namespaced: npm-plugin:deploy');
    expect(result.stdout).toContain('namespaced: ./plugins/local-plugin.cjs:local-info');
    expect(result.stdout).toContain('run (unavailable: conflicts with built-in command "run")');
  });

  test('supports top-level and namespaced execution while preserving built-in conflicts', () => {
    const projectRoot = createValidPluginProject();

    const topLevel = runCli(['deploy', '--target', 'prod'], projectRoot);
    expect(topLevel.status).toBe(0);
    expect(topLevel.stdout).toContain('npm deploy --target,prod');

    const namespaced = runCli(['npm-plugin:deploy', '--dry-run'], projectRoot);
    expect(namespaced.status).toBe(0);
    expect(namespaced.stdout).toContain('npm deploy --dry-run');

    const builtInConflict = runCli(['run'], projectRoot);
    expect(builtInConflict.stdout).not.toContain('object run');
    expect(builtInConflict.stderr).not.toContain('[plugin:object-plugin]');
  });

  test('emits one aggregated startup report and exits with code 12 for plugin validation failures', () => {
    const projectRoot = createInvalidPluginProject();
    // Use a non-help command so plugin validation runs before dispatch.
    // `fred help` intentionally skips plugin validation so it always succeeds.
    const result = runCli(['agents'], projectRoot);

    expect(result.status).toBe(12);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Plugin startup validation failed');
    expect(result.stderr.match(/Plugin startup validation failed/g)?.length).toBe(1);
    expect(result.stderr).toContain('plugin incompatible-plugin');
    expect(result.stderr).toContain('plugin deprecated-plugin');
    expect(result.stderr).toContain('plugin-fred-version-incompatible');
    expect(result.stderr).toContain('plugin-api-deprecated');
  });
});
