import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

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
//   6. Subpath exports (chat-defaults for dev, plugin for cli)
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

  test('has build:declarations script', () => {
    expect(manifest.scripts?.['build:declarations']).toBeDefined();
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

  test('workspace: protocol is acceptable in CLI runtime dependencies', () => {
    // CLI uses workspace: for sibling Fred packages in the monorepo.
    // Bun resolves workspace: to actual versions during publish.
    // This is acceptable because the CLI is a monorepo-internal tool.
    const deps = manifest.dependencies ?? {};
    const workspaceDeps = Object.entries(deps).filter(
      ([, v]) => (v as string).startsWith('workspace:'),
    );

    // All workspace deps should be Fred packages (monorepo siblings)
    for (const [name] of workspaceDeps) {
      expect(name).toMatch(/^@fancyrobot\//);
    }
  });
});
