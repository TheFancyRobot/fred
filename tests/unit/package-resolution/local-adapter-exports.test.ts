import { describe, expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function run(command: string, args: string[], cwd: string): string {
  try {
    return execFileSync(command, args, {
      cwd,
      stdio: 'pipe',
      encoding: 'utf-8',
    });
  } catch (cause) {
    const error = cause as { stdout?: string; stderr?: string; status?: number };
    throw new Error(
      `Command failed (${error.status ?? 'unknown'}): ${command} ${args.join(' ')}\n` +
        `cwd: ${cwd}\n` +
        `stdout:\n${error.stdout ?? ''}\n` +
        `stderr:\n${error.stderr ?? ''}`,
    );
  }
}

describe('local adapter package exports', () => {
  test('fred-baml exposes import-safe root and testing subpath exports', async () => {
    const root = await import('@fancyrobot/fred-baml');
    const testing = await import('@fancyrobot/fred-baml/testing');

    expect(typeof root.initFredBamlRuntime).toBe('function');
    expect(typeof root.createBamlTool).toBe('function');
    expect(typeof root.BamlPromptSourceLayer).toBe('function');
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

  test('root manifests prefer Bun source while retaining built JavaScript fallback', async () => {
    const expectedByPackage = {
      'packages/fred-baml/package.json': {
        types: './dist/index.d.ts',
        exports: {
          types: './dist/index.d.ts',
          bun: './src/index.ts',
          import: './dist/index.js',
          default: './dist/index.js',
        },
      },
      'packages/fred-convex/package.json': {
        types: './src/index.ts',
        exports: {
          types: './src/index.ts',
          bun: './src/index.ts',
          import: './dist/index.js',
          default: './dist/index.js',
        },
      },
    } as const;

    for (const [packagePath, expected] of Object.entries(expectedByPackage)) {
      const manifest = JSON.parse(await Bun.file(packagePath).text()) as {
        main: string;
        types: string;
        exports: { '.': Record<string, string> };
      };

      expect(manifest.main).toBe('./dist/index.js');
      expect(manifest.types).toBe(expected.types);
      expect(manifest.exports['.']).toEqual(expected.exports);
    }
  });

  test('testing subpath manifests prefer Bun source while retaining built JavaScript fallback', async () => {
    const expectedByPackage = {
      'packages/fred-baml/package.json': {
        types: './dist/testing.d.ts',
        bun: './src/testing.ts',
        import: './dist/testing.js',
        default: './dist/testing.js',
      },
      'packages/fred-convex/package.json': {
        types: './src/testing.ts',
        bun: './src/testing.ts',
        import: './dist/testing.js',
        default: './dist/testing.js',
      },
    } as const;

    for (const [packagePath, expected] of Object.entries(expectedByPackage)) {
      const manifest = JSON.parse(await Bun.file(packagePath).text()) as {
        exports: { './testing': Record<string, string> };
      };

      expect(manifest.exports['./testing']).toEqual(expected);
    }
  });

  test('fred-baml typechecks from a Stanza-shaped local file dependency consumer', () => {
    run('bun', ['run', '--cwd', 'packages/fred-baml', 'build'], process.cwd());

    const tempDir = mkdtempSync(join(tmpdir(), 'fred-baml-file-consumer-'));

    try {
      mkdirSync(join(tempDir, 'src'));
      writeFileSync(
        join(tempDir, 'package.json'),
        JSON.stringify(
          {
            type: 'module',
            dependencies: {
              '@fancyrobot/fred': `file:${process.cwd()}/packages/core`,
              '@fancyrobot/fred-baml': `file:${process.cwd()}/packages/fred-baml`,
              effect: '^3.21.0',
              typescript: '~5.8.3',
            },
          },
          null,
          2,
        ),
      );
      writeFileSync(
        join(tempDir, 'tsconfig.json'),
        JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2022',
              module: 'ESNext',
              moduleResolution: 'bundler',
              strict: true,
              skipLibCheck: true,
              noEmit: true,
            },
            include: ['src'],
          },
          null,
          2,
        ),
      );
      writeFileSync(
        join(tempDir, 'src', 'index.ts'),
        `import { Schema } from 'effect';\n` +
          `import { makeFredRuntimeLayer } from '@fancyrobot/fred';\n` +
          `import { BamlPromptSourceLayer, createBamlTool } from '@fancyrobot/fred-baml';\n\n` +
          `const promptSourceLayer = BamlPromptSourceLayer(async ({ functionName }) => \`prompt:\${functionName}\`);\n` +
          `const runtimeLayer = makeFredRuntimeLayer({ promptSourceLayer });\n` +
          `void runtimeLayer;\n\n` +
          `const tool = createBamlTool({\n` +
          `  id: 'summarize',\n` +
          `  description: 'Summarize text via BAML',\n` +
          `  inputSchema: Schema.Struct({ text: Schema.String }),\n` +
          `  successSchema: Schema.String,\n` +
          `  execute: ({ text }) => \`summary:\${text}\`,\n` +
          `});\n\n` +
          `const result: Promise<string> | string = tool.execute({ text: 'hello' });\n` +
          `void result;\n`,
      );

      run('bun', ['install'], tempDir);
      run(join(tempDir, 'node_modules', '.bin', 'tsc'), ['--noEmit', '--pretty', 'false'], tempDir);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test('adapter package build scripts keep peer dependencies external', async () => {
    for (const packagePath of ['packages/fred-baml/package.json', 'packages/fred-convex/package.json']) {
      const manifest = JSON.parse(await Bun.file(packagePath).text()) as {
        scripts: { build: string };
      };

      expect(manifest.scripts.build).toContain('--external effect');
      expect(manifest.scripts.build).toContain('--external @fancyrobot/fred');
    }
  });

  test('locally consumed adapter packages do not expose workspace protocol dependencies', async () => {
    const localAdapterManifests = [
      'packages/fred-baml/package.json',
      'packages/fred-convex/package.json',
      'packages/provider-minimax/package.json',
    ];

    for (const packagePath of localAdapterManifests) {
      const manifest = JSON.parse(await Bun.file(packagePath).text()) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
        peerDependencies?: Record<string, string>;
      };

      const dependencySections = {
        dependencies: manifest.dependencies ?? {},
        devDependencies: manifest.devDependencies ?? {},
        optionalDependencies: manifest.optionalDependencies ?? {},
        peerDependencies: manifest.peerDependencies ?? {},
      };

      for (const [sectionName, dependencies] of Object.entries(dependencySections)) {
        for (const [dependencyName, version] of Object.entries(dependencies)) {
          expect({ packagePath, sectionName, dependencyName, version }).not.toMatchObject({
            version: expect.stringMatching(/^workspace:/),
          });
        }
      }
    }
  });
});
