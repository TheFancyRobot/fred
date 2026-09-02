import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { startDevChat as startDevChatFromCli } from '@fancyrobot/fred-cli';
import { startDevChat as startDevChatFromDev } from '@fancyrobot/fred-dev';
import {
  DEV_CHAT_PROVIDER_PACKAGES as cliProviderPackages,
  detectAvailableProvider as detectAvailableProviderFromCli,
} from '@fancyrobot/fred-cli/chat-defaults';
import {
  DEV_CHAT_PROVIDER_PACKAGES as devProviderPackages,
  detectAvailableProvider as detectAvailableProviderFromDev,
} from '@fancyrobot/fred-dev/chat-defaults';

// ---------------------------------------------------------------------------
// STEP-59-07: Remaining package entrypoints and dependency anomalies
//
// Tests for packages not covered by consumer-surface-regression.test.ts:
//   - fred-dev (@fancyrobot/fred-dev)
//   - fred-cli (@fancyrobot/fred-cli)
//
// Validates:
//   1. Conditional exports with bun → src, import/default → dist
//   2. main points to dist, not raw source
//   3. types points to dist declarations
//   4. files field includes dist and src
//   5. Build scripts externalize peer dependencies
//   6. Subpath exports (chat-defaults for both packages, plugin for cli)
//   7. Final fred-dev shim dependency direction and source ownership
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dir, '../../..');

// ---------------------------------------------------------------------------
// fred-dev
// ---------------------------------------------------------------------------

describe('remaining package entrypoints: fred-dev', () => {
  const pkgDir = join(REPO_ROOT, 'packages', 'dev');
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

  test('root export has bun→src and import/default→dist conditional exports', () => {
    const rootExport = manifest?.exports?.['.'];
    expect(rootExport).toMatchObject({
      types: expect.any(String),
      bun: './src/index.ts',
      import: expect.stringContaining('./dist/'),
      default: expect.stringContaining('./dist/'),
    });
  });

  test('./chat-defaults subpath has bun→src and import/default→dist conditional exports', () => {
    const chatDefaultsExport = manifest?.exports?.['./chat-defaults'];
    expect(chatDefaultsExport).toMatchObject({
      types: expect.any(String),
      bun: './src/chat-defaults.ts',
      import: expect.stringContaining('./dist/'),
      default: expect.stringContaining('./dist/'),
    });
  });

  test('"main" field points to built dist', () => {
    expect(manifest.main).toContain('./dist/');
  });

  test('"types" field points to dist declarations', () => {
    expect(manifest.types).toContain('./dist/');
    expect(manifest.types).toMatch(/\.d\.ts$/);
  });

  test('has "files" field with dist and src', () => {
    expect(manifest.files).toBeDefined();
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files).toContain('src');
    expect(manifest.files).toContain('dist');
  });

  test('build script externalizes all peer dependencies', () => {
    const peers = Object.keys(manifest.peerDependencies ?? {});
    const buildScript: string = manifest.scripts?.build ?? '';

    for (const peer of peers) {
      expect(buildScript).toContain(`--external ${peer}`);
    }
  });

  test('is a deprecated compatibility shim with only the CLI runtime peer', () => {
    expect(manifest.deprecated).toContain('@fancyrobot/fred-cli');
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.peerDependencies).toEqual({
      '@fancyrobot/fred-cli': '^0.7.0',
    });
    expect(manifest.devDependencies).toEqual({
      '@fancyrobot/fred-cli': 'workspace:^',
      '@types/bun': '1.3.14',
    });

    const sourceFiles = Array.from(
      new Bun.Glob('src/*.ts').scanSync({ cwd: pkgDir }),
    ).sort();
    expect(sourceFiles).toEqual(['src/chat-defaults.ts', 'src/index.ts']);

    const rootSource = readFileSync(join(pkgDir, 'src', 'index.ts'), 'utf-8');
    const defaultsSource = readFileSync(join(pkgDir, 'src', 'chat-defaults.ts'), 'utf-8');
    expect(rootSource).toContain("from '@fancyrobot/fred-cli'");
    expect(rootSource).toContain("from '@fancyrobot/fred-cli/chat-defaults'");
    expect(defaultsSource).toContain("from '@fancyrobot/fred-cli/chat-defaults'");
  });

  test('root and chat-defaults exports forward the CLI identities', () => {
    const cliStartContract: (setupHook?: Parameters<typeof startDevChatFromCli>[0]) => Promise<void> =
      startDevChatFromCli;
    const devStartContract: (setupHook?: Parameters<typeof startDevChatFromDev>[0]) => Promise<void> =
      startDevChatFromDev;

    expect(cliStartContract).toBe(startDevChatFromCli);
    expect(devStartContract).toBe(startDevChatFromDev);
    expect(startDevChatFromDev).toBe(startDevChatFromCli);
    expect(devProviderPackages).toBe(cliProviderPackages);
    expect(detectAvailableProviderFromDev).toBe(detectAvailableProviderFromCli);
  });

  test('has build:declarations script', () => {
    expect(manifest.scripts?.['build:declarations']).toBeDefined();
    expect(manifest.scripts?.['build:declarations']).toContain('rm -rf dist');
    expect(manifest.scripts?.['build:declarations']).toContain('tsc');
  });

  test('no workspace: protocol in peerDependencies or non-Fred dependencies', () => {
    // fred-dev may have workspace: in dependencies for local monorepo use,
    // but peerDependencies should use regular version ranges
    const peers = manifest.peerDependencies ?? {};
    for (const [name, version] of Object.entries(peers)) {
      expect({ dep: name, version: version as string }).not.toMatchObject({
        version: expect.stringMatching(/^workspace:/),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// fred-cli
// ---------------------------------------------------------------------------

describe('remaining package entrypoints: fred-cli', () => {
  const pkgDir = join(REPO_ROOT, 'packages', 'cli');
  const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

  test('root export has bun→src and import/default→dist conditional exports', () => {
    const rootExport = manifest?.exports?.['.'];
    expect(rootExport).toMatchObject({
      types: expect.any(String),
      bun: './src/index.ts',
      import: expect.stringContaining('./dist/'),
      default: expect.stringContaining('./dist/'),
    });
  });

  test('./plugin subpath has bun→src and import/default→dist conditional exports', () => {
    const pluginExport = manifest?.exports?.['./plugin'];
    expect(pluginExport).toMatchObject({
      types: expect.any(String),
      bun: './src/plugin/api.ts',
      import: expect.stringContaining('./dist/'),
      default: expect.stringContaining('./dist/'),
    });
  });

  test('./chat-defaults subpath has bun→src and import/default→dist conditional exports', () => {
    const chatDefaultsExport = manifest?.exports?.['./chat-defaults'];
    expect(chatDefaultsExport).toMatchObject({
      types: './dist/chat-defaults.d.ts',
      bun: './src/chat-defaults.ts',
      import: './dist/chat-defaults.js',
      default: './dist/chat-defaults.js',
    });
  });

  test('does not import or depend on fred-dev', () => {
    expect(manifest.dependencies?.['@fancyrobot/fred-dev']).toBeUndefined();
    expect(manifest.peerDependencies?.['@fancyrobot/fred-dev']).toBeUndefined();
    expect(manifest.scripts?.build).not.toContain('@fancyrobot/fred-dev');

    const sourceFiles = Array.from(
      new Bun.Glob('src/**/*.ts').scanSync({ cwd: pkgDir }),
    );
    const legacyImportPattern = /from\s+['"]@fancyrobot\/fred-dev(?:\/[^'"]*)?['"]/;
    const offenders = sourceFiles.filter((relativePath) =>
      legacyImportPattern.test(readFileSync(join(pkgDir, relativePath), 'utf-8'))
    );
    expect(offenders).toEqual([]);
  });

  test('Bun source exports do not reach into monorepo-relative core sources', () => {
    const sourceFiles = Array.from(
      new Bun.Glob('src/**/*.ts').scanSync({ cwd: pkgDir }),
    );
    const offenders = sourceFiles.filter((relativePath) =>
      /(?:\.\.\/)+core\/src\//.test(readFileSync(join(pkgDir, relativePath), 'utf-8'))
    );
    expect(offenders).toEqual([]);
  });

  test('"main" field points to built dist', () => {
    expect(manifest.main).toContain('./dist/');
  });

  test('"types" field points to dist declarations', () => {
    expect(manifest.types).toContain('./dist/');
    expect(manifest.types).toMatch(/\.d\.ts$/);
  });

  test('has "files" field with dist and src', () => {
    expect(manifest.files).toBeDefined();
    expect(Array.isArray(manifest.files)).toBe(true);
    expect(manifest.files).toContain('src');
    expect(manifest.files).toContain('dist');
  });

  test('build script externalizes peer dependencies', () => {
    const peers = Object.keys(manifest.peerDependencies ?? {});
    const buildScript: string = manifest.scripts?.build ?? '';

    for (const peer of peers) {
      expect(buildScript).toContain(`--external ${peer}`);
    }
  });

  test('has build:declarations script', () => {
    expect(manifest.scripts?.['build:declarations']).toBeDefined();
    expect(manifest.scripts?.['build:declarations']).toContain('tsc');
  });

  test('bin field is defined for CLI entry point', () => {
    expect(manifest.bin).toBeDefined();
    expect(manifest.bin?.fred).toBeDefined();
  });

  test('runtime dependencies use publishable semver ranges', () => {
    const deps = manifest.dependencies ?? {};
    const workspaceDeps = Object.entries(deps).filter(
      ([, v]) => (v as string).startsWith('workspace:'),
    );
    expect(workspaceDeps).toEqual([]);
  });
});
