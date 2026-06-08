import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const tempDirs: string[] = [];

describe('local adapter package exports', () => {
  afterAll(() => {
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('fred-baml exposes import-safe root and testing subpath exports', async () => {
    const root = await import('@fancyrobot/fred-baml');
    const testing = await import('@fancyrobot/fred-baml/testing');

    expect(typeof root.initFredBamlRuntime).toBe('function');
    expect(typeof root.createBamlTool).toBe('function');
    expect(typeof testing.createStubBamlRuntime).toBe('function');
    expect(typeof testing.loadStubBamlClient).toBe('function');
  });

  test('fred-convex exposes import-safe root and testing subpath exports', async () => {
    const root = await import('@fancyrobot/fred-convex');
    const testing = await import('@fancyrobot/fred-convex/testing');

    expect(typeof root.initFredConvexRuntime).toBe('function');
    expect(typeof root.createConvexTool).toBe('function');
    expect(typeof testing.createStubConvexRuntime).toBe('function');
    expect(typeof testing.createStubConvexClient).toBe('function');
  });

  test('supports package-name imports from local sibling workspace links', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fred-adapters-sibling-'));
    tempDirs.push(tempDir);

    const root = resolve(process.cwd());
    const scopeDir = join(tempDir, 'node_modules', '@fancyrobot');
    mkdirSync(scopeDir, { recursive: true });
    symlinkSync(resolve(root, 'packages/core'), join(scopeDir, 'fred'), 'dir');
    symlinkSync(resolve(root, 'packages/fred-baml'), join(scopeDir, 'fred-baml'), 'dir');
    symlinkSync(resolve(root, 'packages/fred-convex'), join(scopeDir, 'fred-convex'), 'dir');

    writeFileSync(
      join(tempDir, 'package.json'),
      JSON.stringify({ name: 'fred-adapters-sibling-fixture', private: true, type: 'module' }, null, 2)
    );

    writeFileSync(
      join(tempDir, 'index.ts'),
      `import { initFredBamlRuntime, createBamlTool } from '@fancyrobot/fred-baml';
import { createStubBamlRuntime } from '@fancyrobot/fred-baml/testing';
import { initFredConvexRuntime, createConvexTool } from '@fancyrobot/fred-convex';
import { createStubConvexRuntime } from '@fancyrobot/fred-convex/testing';

if (typeof initFredBamlRuntime !== 'function') throw new Error('bad baml root export');
if (typeof createBamlTool !== 'function') throw new Error('bad baml tool export');
if (typeof createStubBamlRuntime !== 'function') throw new Error('bad baml testing export');
if (typeof initFredConvexRuntime !== 'function') throw new Error('bad convex root export');
if (typeof createConvexTool !== 'function') throw new Error('bad convex tool export');
if (typeof createStubConvexRuntime !== 'function') throw new Error('bad convex testing export');
`
    );

    const run = spawnSync('bun', ['run', 'index.ts'], {
      cwd: tempDir,
      encoding: 'utf8',
      timeout: 180_000,
    });

    expect(run.stderr).toBe('');
    expect(run.status).toBe(0);
  }, 240_000);

  test('adapter manifests prefer Bun source while retaining built JavaScript fallbacks', async () => {
    for (const packagePath of ['packages/fred-baml/package.json', 'packages/fred-convex/package.json']) {
      const manifest = JSON.parse(await Bun.file(packagePath).text()) as {
        main: string;
        types: string;
        exports: {
          '.': Record<string, string>;
          './testing': Record<string, string>;
        };
      };

      expect(manifest.main).toBe('./dist/index.js');
      expect(manifest.types).toBe('./src/index.ts');
      expect(manifest.exports['.']).toEqual({
        types: './src/index.ts',
        bun: './src/index.ts',
        import: './dist/index.js',
        default: './dist/index.js',
      });
      expect(manifest.exports['./testing']).toEqual({
        types: './src/testing.ts',
        bun: './src/testing.ts',
        import: './dist/testing.js',
        default: './dist/testing.js',
      });
    }
  });
});
