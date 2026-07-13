import { describe, expect, test } from 'bun:test';
import { readFileSync, existsSync, mkdirSync, writeFileSync, rmSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// STEP-59-01: Consumer-surface regression tests
//
// These tests assert the fixed/green state of Fred package surfaces
// (dist entrypoints, tsconfig references, barrel re-exports, etc.).
//
// Failure categories covered:
//   1. Raw-source manifests (main/types/import → src/*.ts, no dist fallback)
//   2. Missing root tsconfig.json references (provider-minimax, fred-http)
//   3. Missing package tsconfig.json (fred-http)
//   4. Missing barrel type re-exports (minimax input/result/adapter types,
//      fred-http app-builder types) — verified via source text analysis
//   5. Build scripts not externalizing peer dependencies
//   6. Workspace protocol leakage in publishable package dependencies
//   7. Missing `files` field allowing unintended publish artifacts
//   8. Temp-consumer typecheck (tsc --noEmit) for Stanza-facing imports
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(import.meta.dir, '../../..');

// ---------------------------------------------------------------------------
// 1. Raw-source manifest audit
// ---------------------------------------------------------------------------

describe('consumer-surface regression: raw-source manifests', () => {
  /**
   * Packages that have ALREADY been fixed with conditional exports
   * (bun → src, import → dist, types → src). These are baseline-good
   * and should NOT appear as RED findings.
   */
  const BASELINE_GOOD_PACKAGES = ['fred-convex'];

  /**
   * Packages expected to be consumed by external applications (Stanza, etc.)
   * and therefore must have proper conditional exports with dist fallbacks.
   * Excludes internal-only CLI/dev packages that rely on Bun source ergonomics.
   */
  const EXTERNALLY_CONSUMED_PACKAGES = [
    'core',             // @fancyrobot/fred
    'provider-minimax', // @fancyrobot/fred-minimax
    'fred-http',        // @fancyrobot/fred-http
    'fred-baml',        // @fancyrobot/fred-baml
    'provider-openai',  // @fancyrobot/fred-openai
    'provider-anthropic', // @fancyrobot/fred-anthropic
    'provider-google',  // @fancyrobot/fred-google
    'provider-groq',    // @fancyrobot/fred-groq
    'provider-openrouter', // @fancyrobot/fred-openrouter
  ];

  for (const pkg of EXTERNALLY_CONSUMED_PACKAGES) {
    const pkgDir = join(REPO_ROOT, 'packages', pkg);

    test.skipIf(BASELINE_GOOD_PACKAGES.includes(pkg))(
      `${pkg}: root export condition includes "bun" before "import" fallback`,
      () => {
        const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));
        const rootExport = manifest?.exports?.['.'];

        // RED expectation: most packages only have types+import pointing to src
        // GREEN target: conditional exports with bun → src, import → dist
        expect(rootExport).toMatchObject({
          types: expect.stringContaining('./dist/'),
          bun: expect.any(String),
          import: expect.stringContaining('./dist/'),
          default: expect.stringContaining('./dist/'),
        });
      },
    );

    test.skipIf(BASELINE_GOOD_PACKAGES.includes(pkg))(
      `${pkg}: "main" field points to built dist, not raw source`,
      () => {
        const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

        // RED expectation: main → ./src/index.ts
        // GREEN target: main → ./dist/index.js
        expect(manifest.main).toContain('./dist/');
      },
    );

    test.skipIf(BASELINE_GOOD_PACKAGES.includes(pkg))(
      `${pkg}: "types" field points to built dist declarations, not raw source`,
      () => {
        const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf-8'));

        expect(manifest.types).toContain('./dist/');
      },
    );
  }

  /**
   * Any package that declares a `bin` must point it at the built dist
   * artifact, not raw TypeScript source. A published bin at `./src/*.ts`
   * ships a Bun/TS entry that standard package-manager bin execution
   * cannot run before the CLI starts.
   */
  const PACKAGES_WITH_BIN = ['cli'];
  for (const pkg of PACKAGES_WITH_BIN) {
    test(`${pkg}: bin entries point at built dist, not raw source`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf-8'),
      );
      const bin = manifest.bin ?? {};
      const entries = typeof bin === 'string' ? [bin] : Object.values(bin);

      for (const target of entries as string[]) {
        expect({ pkg, target }).toMatchObject({
          pkg,
          target: expect.stringContaining('./dist/'),
        });
        expect(target.endsWith('.ts')).toBe(false);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Root tsconfig.json references audit
// ---------------------------------------------------------------------------

describe('consumer-surface regression: root tsconfig references', () => {
  const rootTsconfig = JSON.parse(
    readFileSync(join(REPO_ROOT, 'tsconfig.json'), 'utf-8'),
  );

  const ALL_PACKAGE_DIRS = listPackageDirs();

  const referencedPackages = (rootTsconfig.references ?? []).map(
    (r: { path: string }) => r.path.replace('packages/', ''),
  );

  for (const pkg of ALL_PACKAGE_DIRS) {
    test(
      `${pkg}: included in root tsconfig.json references`,
      () => {
        // RED expectation: provider-minimax and fred-http are MISSING
        expect(referencedPackages).toContain(pkg);
      },
    );
  }
});

// ---------------------------------------------------------------------------
// 3. Package tsconfig.json existence audit
// ---------------------------------------------------------------------------

describe('consumer-surface regression: package tsconfig.json', () => {
  const ALL_PACKAGE_DIRS = listPackageDirs();

  for (const pkg of ALL_PACKAGE_DIRS) {
    test(`${pkg}: has tsconfig.json for project references`, () => {
      // RED expectation: fred-http does NOT have tsconfig.json
      expect(existsSync(join(REPO_ROOT, 'packages', pkg, 'tsconfig.json'))).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Missing barrel type re-exports audit (source text analysis)
//
// We check the barrel file's source text for re-export statements rather
// than using runtime `in` checks, because TypeScript interfaces/types are
// erased at runtime and cannot be verified with `typeof` or `in`.
// ---------------------------------------------------------------------------

describe('consumer-surface regression: barrel type re-exports', () => {
  const MINIMAX_BARREL = readFileSync(
    join(REPO_ROOT, 'packages/provider-minimax/src/index.ts'),
    'utf-8',
  );
  const HTTP_BARREL = readFileSync(
    join(REPO_ROOT, 'packages/fred-http/src/index.ts'),
    'utf-8',
  );

  // --- MiniMax capability types that should be re-exported from barrel ---

  const MINIMAX_EXPECTED_TYPE_EXPORTS: Record<string, string[]> = {
    image: [
      'ImageGenerationInput',
      'ImageGenerationResult',
      'MiniMaxImageAdapter',
    ],
    video: [
      'VideoGenerationInput',
      'VideoQueryInput',
      'VideoTaskResult',
      'VideoQueryResult',
      'MiniMaxVideoAdapter',
    ],
    music: [
      'MusicGenerationInput',
      'MusicGenerationResult',
      'MiniMaxMusicAdapter',
    ],
    speech: [
      'SpeechSynthesisInput',
      'AsyncSpeechSynthesisInput',
      'SpeechSynthesisResult',
      'AsyncSpeechTaskResult',
      'MiniMaxSpeechAdapter',
    ],
    voice: [
      'VoiceCloneInput',
      'VoiceDesignInput',
      'VoiceListInput',
      'VoiceDeleteInput',
      'VoiceCloneResult',
      'VoiceDesignResult',
      'VoiceListResult',
      'VoiceDeleteResult',
      'MiniMaxVoiceAdapter',
    ],
    lyrics: [
      'LyricsGenerationInput',
      'LyricsGenerationResult',
      'MiniMaxLyricsAdapter',
    ],
  };

  for (const [capability, typeNames] of Object.entries(MINIMAX_EXPECTED_TYPE_EXPORTS)) {
    test(`@fancyrobot/fred-minimax barrel re-exports ${capability} type exports`, () => {
      for (const typeName of typeNames) {
        // RED expectation: barrel does NOT contain re-export for this type
        // GREEN target: barrel has `export { ... ${typeName} ... } from './${capability}'`
        //               or `export type { ... ${typeName} ... } from './${capability}'`
        const hasReExport =
          MINIMAX_BARREL.includes(typeName) &&
          (MINIMAX_BARREL.match(new RegExp(`export\\s+(type\\s+)?\\{[^}]*\\b${typeName}\\b`, 'm')) !== null ||
           MINIMAX_BARREL.match(new RegExp(`export\\s+(type\\s+)?\\{[^}]*\\b${typeName}\\b[^}]*\\}\\s*from\\s*['\"]\\./${capability}['\"]`, 'm')) !== null);

        expect(hasReExport).toBe(true);
      }
    });
  }

  // --- supported fred-http route types that should be re-exported from barrel ---

  const HTTP_EXPECTED_TYPE_EXPORTS = [
    'FredHttpRoute',
    'FredHttpRouteVisibility',
  ];

  test('@fancyrobot/fred-http barrel re-exports withHttp route types', () => {
    for (const typeName of HTTP_EXPECTED_TYPE_EXPORTS) {
      // RED expectation: barrel does NOT contain re-export for these types
      // GREEN target: barrel has `export type { ... ${typeName} ... } from './layers/server'`
      const hasReExport =
        HTTP_BARREL.includes(typeName) &&
        (HTTP_BARREL.match(new RegExp(`export\\s+(type\\s+)?\\{[^}]*\\b${typeName}\\b`, 'm')) !== null);

      expect(hasReExport).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Build script peer dependency externalization
// ---------------------------------------------------------------------------

describe('consumer-surface regression: build externalization', () => {
  /**
   * Packages with peerDependencies that should be externalized in build.
   */
  const PACKAGES_WITH_PEERS = [
    'provider-minimax',
    'provider-openai',
    'provider-anthropic',
    'provider-google',
    'provider-groq',
    'provider-openrouter',
    'fred-http',
  ];

  for (const pkg of PACKAGES_WITH_PEERS) {
    test(`${pkg}: build script externalizes all peer dependencies`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf-8'),
      );

      const peers = Object.keys(manifest.peerDependencies ?? {});
      const buildScript: string = manifest.scripts?.build ?? '';

      // RED expectation: most packages do NOT externalize peers in build
      // GREEN target: each peer dep appears as --external <name> in build script
      for (const peer of peers) {
        expect(buildScript).toContain(`--external ${peer}`);
      }
    });
  }

  /**
   * Every subpath in `exports` with a `bun: "./src/**"` condition must have
   * its source entrypoint passed to the `build` script, so the matching
   * non-Bun ("import"/"default") dist file is actually produced. Otherwise
   * TypeScript resolves the subpath fine via co-located .d.ts
   * (build:declarations walks the whole src/ tree), but a real Node/bundler
   * consumer hits a runtime module-not-found error because `bun run build`
   * never bundled that entrypoint.
   */
  const PACKAGES_WITH_SUBPATH_EXPORTS = [
    'core',
    'cli',
    'fred-http',
    'fred-baml',
    'fred-convex',
    'provider-minimax',
  ];

  for (const pkg of PACKAGES_WITH_SUBPATH_EXPORTS) {
    test(`${pkg}: build script bundles every exports-map entrypoint`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf-8'),
      );
      const buildScript: string = manifest.scripts?.build ?? '';
      const exportsMap = manifest.exports ?? {};

      for (const [subpath, condition] of Object.entries(exportsMap) as [string, Record<string, string>][]) {
        const sourceEntry = condition.bun;
        if (!sourceEntry || !sourceEntry.startsWith('./src/')) continue;

        const relativeSource = sourceEntry.replace(/^\.\//, '');
        if (!buildScript.includes(relativeSource)) {
          throw new Error(
            `${pkg}: exports["${subpath}"].bun points at ${sourceEntry}, but the build script does ` +
              `not pass it to bun build, so ${condition.import ?? condition.default} will never be ` +
              `produced. Add it as an entrypoint in packages/${pkg}/package.json's "build" script.`,
          );
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 6. Workspace protocol leakage in publishable packages
// ---------------------------------------------------------------------------

describe('consumer-surface regression: workspace protocol in published deps', () => {
  /**
   * Packages intended for npm publishing. Workspace protocol refs in any
   * dependency section will break `npm pack` / `npm publish` for consumers.
   */
  const PUBLISHABLE_PACKAGES = [
    'core',
    'provider-minimax',
    'provider-openai',
    'provider-anthropic',
    'provider-google',
    'provider-groq',
    'provider-openrouter',
    'fred-http',
    'fred-baml',
    'fred-convex',
  ];

  for (const pkg of PUBLISHABLE_PACKAGES) {
    test(`${pkg}: no workspace: protocol in any dependency section`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf-8'),
      );

      const sections = [
        manifest.dependencies ?? {},
        manifest.devDependencies ?? {},
        manifest.optionalDependencies ?? {},
        manifest.peerDependencies ?? {},
      ];

      for (const section of sections) {
        for (const [name, version] of Object.entries(section)) {
          expect({
            package: pkg,
            section: 'dependency section',
            dep: name,
            version: version as string,
          }).not.toMatchObject({
            version: expect.stringMatching(/^workspace:/),
          });
        }
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Missing `files` field in publishable packages
// ---------------------------------------------------------------------------

describe('consumer-surface regression: files field for npm publish', () => {
  const PUBLISHABLE_PACKAGES = [
    'core',
    'provider-minimax',
    'provider-openai',
    'provider-anthropic',
    'provider-google',
    'provider-groq',
    'provider-openrouter',
    'fred-http',
  ];

  for (const pkg of PUBLISHABLE_PACKAGES) {
    test(`${pkg}: has "files" field to scope npm publish artifacts`, () => {
      const manifest = JSON.parse(
        readFileSync(join(REPO_ROOT, 'packages', pkg, 'package.json'), 'utf-8'),
      );

      // RED expectation: most provider packages lack "files" field
      // GREEN target: "files" includes "dist", "src" (or appropriate set)
      expect(manifest.files).toBeDefined();
      expect(Array.isArray(manifest.files)).toBe(true);
      expect(manifest.files.length).toBeGreaterThan(0);
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Temp-consumer typecheck (tsc --noEmit)
//
// Creates a minimal TypeScript project that imports from Fred packages
// the way Stanza or an external consumer would, then runs tsc --noEmit.
// This is the ONLY reliable way to verify type-only imports because
// TypeScript erases interface/type exports at runtime.
// ---------------------------------------------------------------------------

describe('consumer-surface regression: temp-consumer typecheck', () => {
  const TEMP_DIR = join('/tmp', 'fred-consumer-surface-test');
  const TSC_BIN = join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

  /**
   * Type names that external consumers (like Stanza) need to import
   * from each package barrel. Each entry is [package, typeName].
   */
  const CONSUMER_TYPE_IMPORTS: [string, string][] = [
    // MiniMax input/result/adapter types
    ['@fancyrobot/fred-minimax', 'ImageGenerationInput'],
    ['@fancyrobot/fred-minimax', 'ImageGenerationResult'],
    ['@fancyrobot/fred-minimax', 'MiniMaxImageAdapter'],
    ['@fancyrobot/fred-minimax', 'VideoGenerationInput'],
    ['@fancyrobot/fred-minimax', 'VideoTaskResult'],
    ['@fancyrobot/fred-minimax', 'MiniMaxVideoAdapter'],
    ['@fancyrobot/fred-minimax', 'MusicGenerationInput'],
    ['@fancyrobot/fred-minimax', 'MusicGenerationResult'],
    ['@fancyrobot/fred-minimax', 'MiniMaxMusicAdapter'],
    ['@fancyrobot/fred-minimax', 'SpeechSynthesisInput'],
    ['@fancyrobot/fred-minimax', 'SpeechSynthesisResult'],
    ['@fancyrobot/fred-minimax', 'MiniMaxSpeechAdapter'],
    ['@fancyrobot/fred-minimax', 'VoiceCloneInput'],
    ['@fancyrobot/fred-minimax', 'VoiceCloneResult'],
    ['@fancyrobot/fred-minimax', 'MiniMaxVoiceAdapter'],
    ['@fancyrobot/fred-minimax', 'LyricsGenerationInput'],
    ['@fancyrobot/fred-minimax', 'LyricsGenerationResult'],
    ['@fancyrobot/fred-minimax', 'MiniMaxLyricsAdapter'],
    // fred-http supported custom route type
    ['@fancyrobot/fred-http', 'FredHttpRoute'],
  ];

  /**
   * Run tsc --noEmit on a minimal consumer that imports one type,
   * and check whether tsc reports a missing-export error for it.
   *
   * Uses spawnSync with an argv array (no shell) so no command string is
   * built from path values. Under `bun test`, spawnSync's piped stdout/
   * stderr capture is unreliable, so tsc's output is redirected to a file
   * via file-descriptor stdio (opened here, not through a shell redirect)
   * and read back.
   */
  function checkTypeExportViaTsc(
    packageName: string,
    typeName: string,
  ): { exported: boolean; output: string } {
    const testCaseDir = join(TEMP_DIR, 'check', typeName);
    if (existsSync(testCaseDir)) rmSync(testCaseDir, { recursive: true, force: true });
    mkdirSync(testCaseDir, { recursive: true });

    const packagePath = packageName === '@fancyrobot/fred-minimax'
      ? join(REPO_ROOT, 'packages/provider-minimax/src/index.ts')
      : packageName === '@fancyrobot/fred-http'
      ? join(REPO_ROOT, 'packages/fred-http/src/index.ts')
      : join(REPO_ROOT, 'packages/core/src/index.ts');

    writeFileSync(
      join(testCaseDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'bundler',
          target: 'ESNext',
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          baseUrl: '.',
          paths: { [packageName]: [packagePath] },
        },
      }, null, 2),
    );

    writeFileSync(
      join(testCaseDir, 'consumer.ts'),
      `import type { ${typeName} } from '${packageName}';\nexport type T = ${typeName};\n`,
    );

    const tscCmd = existsSync(TSC_BIN) ? TSC_BIN : 'tsc';
    const outputFile = join(testCaseDir, 'tsc-output.txt');
    const outFd = openSync(outputFile, 'w');
    let status: number | null;
    let signal: NodeJS.Signals | null;
    try {
      const result = spawnSync(tscCmd, ['--noEmit'], {
        cwd: testCaseDir,
        timeout: 30_000,
        stdio: ['ignore', outFd, outFd],
      });
      status = result.status;
      signal = result.signal;
    } finally {
      closeSync(outFd);
    }

    let output = '';
    try {
      output = readFileSync(outputFile, 'utf-8');
    } catch {
      // File might not exist if tsc failed to spawn.
    }

    // Check for specific TypeScript error codes indicating missing exports:
    // TS2614: Module has no exported member (with default import suggestion)
    // TS2305: Module has no exported member named
    // TS2724: Module has no exported member named (with suggestion)
    const hasMissingExport = /TS(2614|2305|2724)/.test(output) && output.includes(typeName);

    // A non-zero exit that isn't a recognized missing-export error means tsc
    // failed for some other reason (bad tsconfig, missing binary, timeout,
    // syntax error) — that must fail loudly rather than silently report
    // `exported: true`, which would make the test pass without having
    // verified anything.
    if (status !== 0 && !hasMissingExport) {
      if (existsSync(testCaseDir)) rmSync(testCaseDir, { recursive: true, force: true });
      throw new Error(
        `tsc exited ${status ?? '(signal ' + signal + ')'} for an unrecognized reason ` +
          `while checking ${packageName}#${typeName}:\n${output}`
      );
    }

    // Cleanup
    if (existsSync(testCaseDir)) rmSync(testCaseDir, { recursive: true, force: true });

    return { exported: !hasMissingExport, output };
  }

  function cleanupAll(): void {
    if (existsSync(TEMP_DIR)) {
      rmSync(TEMP_DIR, { recursive: true, force: true });
    }
  }

  for (const [packageName, typeName] of CONSUMER_TYPE_IMPORTS) {
    test(`${packageName} exports ${typeName} (tsc --noEmit)`, () => {
      // RED expectation: tsc reports missing export errors
      // GREEN target: barrel re-exports all consumer-facing types
      const result = checkTypeExportViaTsc(packageName, typeName);
      expect(result.exported).toBe(true);
    });
  }

  // Cleanup after all tests
  test('cleanup temp consumer directory', () => {
    cleanupAll();
    expect(existsSync(TEMP_DIR)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function listPackageDirs(): string[] {
  const entries: string[] = [];
  const { readdirSync: readdir, statSync } = require('node:fs');
  for (const entry of readdir(join(REPO_ROOT, 'packages'), { withFileTypes: true })) {
    if (
      entry.isDirectory() &&
      existsSync(join(REPO_ROOT, 'packages', entry.name, 'package.json'))
    ) {
      entries.push(entry.name);
    }
  }
  return entries.sort();
}
