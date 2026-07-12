import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import ts from 'typescript';

type ExportTarget = {
  types: string;
  bun: string;
  import: string;
  default: string;
};

type InventoryEntry = {
  packageDir: string;
  version: string;
  subpath: string;
  declarations: string[];
  runtime: string[];
};

type PackageManifest = {
  name: string;
  version: string;
  license?: string;
  exports: Record<string, ExportTarget>;
  bin?: string | Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};

type PackResult = {
  filename: string;
  size: number;
  unpackedSize: number;
  files: Array<{ path: string }>;
};

const REPO_ROOT = resolve(import.meta.dir, '../../..');
const INVENTORY_PATH = join(import.meta.dir, 'public-api-inventory.json');
const inventory = JSON.parse(readFileSync(INVENTORY_PATH, 'utf8')) as InventoryEntry[];
const packageDirs = [...new Set(inventory.map(({ packageDir }) => packageDir))].sort();
const tempDirs: string[] = [];
const stagedPackageDirs = new Map<string, string>();
const declarationOnlyRuntimeTargets: Array<{ path: string; missingBeforeBuild: boolean }> = [];

function removeRuntimeArtifacts(directory: string): void {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      removeRuntimeArtifacts(path);
    } else if (/\.(?:c|m)?js(?:\.map)?$/.test(entry.name)) {
      rmSync(path, { force: true });
    }
  }
}

beforeAll(() => {
  const stageRoot = mkdtempSync(join(tmpdir(), 'fred-package-stage-'));
  tempDirs.push(stageRoot);
  cpSync(join(REPO_ROOT, 'tsconfig.base.json'), join(stageRoot, 'tsconfig.base.json'));
  symlinkSync(join(REPO_ROOT, 'node_modules'), join(stageRoot, 'node_modules'), 'dir');

  for (const packageDir of packageDirs) {
    const sourceDir = join(REPO_ROOT, 'packages', packageDir);
    const stageDir = join(stageRoot, 'packages', packageDir);
    mkdirSync(resolve(stageDir, '..'), { recursive: true });
    cpSync(sourceDir, stageDir, {
      recursive: true,
      filter: (source) => basename(source) !== 'node_modules',
    });
    const sourceNodeModules = join(sourceDir, 'node_modules');
    if (existsSync(sourceNodeModules)) {
      symlinkSync(sourceNodeModules, join(stageDir, 'node_modules'), 'dir');
    }

    // Model the canonical declarations-before-test gate in a disposable copy.
    // Packing this stage prevents stale checkout artifacts from affecting the
    // release contract while still exercising each package's real build.
    const manifest = readManifest(packageDir);
    removeRuntimeArtifacts(join(stageDir, 'dist'));
    for (const target of Object.values(manifest.exports)) {
      const declaration = join(stageDir, target.types);
      if (!existsSync(declaration)) {
        throw new Error(
          `Declaration gate must run before package-surface tests; missing ${declaration}`,
        );
      }
      const runtime = join(stageDir, target.import);
      declarationOnlyRuntimeTargets.push({
        path: runtime,
        missingBeforeBuild: !existsSync(runtime),
      });
    }

    run('bun', ['run', 'build'], stageDir);
    stagedPackageDirs.set(packageDir, stageDir);
  }
}, 120_000);

afterAll(() => {
  for (const tempDir of tempDirs) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function readManifest(packageDir: string): PackageManifest {
  return JSON.parse(
    readFileSync(join(REPO_ROOT, 'packages', packageDir, 'package.json'), 'utf8'),
  ) as PackageManifest;
}

function specifier(entry: InventoryEntry, manifest: PackageManifest): string {
  return entry.subpath === '.' ? manifest.name : `${manifest.name}${entry.subpath.slice(1)}`;
}

function declarationExports(file: string): string[] {
  const options: ts.CompilerOptions = {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    types: [],
  };
  const program = ts.createProgram([file], options);
  const sourceFile = program.getSourceFile(file);
  if (!sourceFile) throw new Error(`Declaration entrypoint is missing: ${file}`);
  const symbol = program.getTypeChecker().getSymbolAtLocation(sourceFile);
  if (!symbol) throw new Error(`Declaration entrypoint has no module symbol: ${file}`);
  return program.getTypeChecker().getExportsOfModule(symbol).map(({ name }) => name).sort();
}

function run(command: string, args: string[], cwd = REPO_ROOT): string {
  const env = { ...process.env };
  // Bun's test runner sets this compatibility flag for child processes. If it
  // reaches the npm shim, `npm pack` is handled as Bun and emits no npm JSON.
  delete env.BUN_BE_BUN;
  const result = Bun.spawnSync([command, ...args], {
    cwd,
    env,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const stdout = result.stdout.toString();
  if (!result.success) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.exitCode})\n` +
        `cwd: ${cwd}\n` +
        `stdout:\n${stdout}\nstderr:\n${result.stderr.toString()}`,
    );
  }
  return stdout;
}

function pack(packageDir: string, destination: string, dryRun: boolean): PackResult {
  const dryRunArg = dryRun ? ' --dry-run' : ' --dry-run=false';
  const resultPath = join(destination, `${packageDir}-${dryRun ? 'dry-run' : 'pack'}.json`);
  const stageDir = stagedPackageDirs.get(packageDir);
  if (!stageDir) throw new Error(`Package stage is missing: ${packageDir}`);
  // Invoke npm behind a shell boundary so Bun's child-process compatibility
  // mode cannot swallow npm's JSON pipe while this file runs under bun:test.
  run(
    '/bin/zsh',
    ['-lc', `unset BUN_BE_BUN; npm pack --json --pack-destination ${destination}${dryRunArg} > ${resultPath}`],
    stageDir,
  );
  const output = readFileSync(resultPath, 'utf8');
  if (output.trim().length === 0) {
    throw new Error(`npm pack returned no JSON for ${packageDir}`);
  }
  const results = JSON.parse(output) as PackResult[];
  if (results.length !== 1) throw new Error(`Expected one pack result for ${packageDir}`);
  return results[0]!;
}

function dependencyVersions(manifest: PackageManifest): Array<[string, string]> {
  return Object.entries({
    ...manifest.dependencies,
    ...manifest.optionalDependencies,
    ...manifest.peerDependencies,
  });
}

function peerVersions(manifest: PackageManifest): Array<[string, string]> {
  return Object.entries(manifest.peerDependencies ?? {});
}

describe('publishable package contract', () => {
  test('builds pack inputs from the declarations-before-test state', () => {
    expect(declarationOnlyRuntimeTargets.length).toBeGreaterThan(0);
    for (const runtime of declarationOnlyRuntimeTargets) {
      expect(runtime.missingBeforeBuild).toBe(true);
      expect(existsSync(runtime.path)).toBe(true);
    }
  });

  test('locks independent versions, supported subpaths, declarations, and Bun runtime exports', async () => {
    for (const packageDir of packageDirs) {
      const manifest = readManifest(packageDir);
      const entries = inventory.filter((entry) => entry.packageDir === packageDir);
      expect(manifest.version).toBe(entries[0]!.version);
      expect(Object.keys(manifest.exports).sort()).toEqual(entries.map(({ subpath }) => subpath).sort());

      for (const entry of entries) {
        const target = manifest.exports[entry.subpath]!;
        expect(target.types).toStartWith('./dist/');
        expect(target.import).toStartWith('./dist/');
        expect(target.default).toBe(target.import);
        expect(target.bun).toStartWith('./src/');
        expect(declarationExports(resolve(REPO_ROOT, 'packages', packageDir, target.types))).toEqual(
          entry.declarations,
        );
        const runtimeModule = await import(specifier(entry, manifest));
        expect(Object.keys(runtimeModule).sort()).toEqual(entry.runtime);
      }
    }
  }, 120_000);

  test('npm dry-runs include every conditional entrypoint and exclude private artifacts', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fred-pack-dry-run-'));
    tempDirs.push(tempDir);

    for (const packageDir of packageDirs) {
      const manifest = readManifest(packageDir);
      const result = pack(packageDir, tempDir, true);
      const files = result.files.map(({ path }) => path).sort();
      const required = new Set(['README.md', 'package.json']);
      for (const target of Object.values(manifest.exports)) {
        Object.values(target).forEach((path) => required.add(path.replace(/^\.\//, '')));
      }
      const bins = typeof manifest.bin === 'string' ? [manifest.bin] : Object.values(manifest.bin ?? {});
      bins.forEach((path) => required.add(path.replace(/^\.\//, '')));

      expect(files).toEqual(expect.arrayContaining([...required]));
      expect(files.filter((path) => /(^|\/)(\.env|\.agent-vault|\.codex|\.git)(\/|$)/.test(path))).toEqual([]);
      expect(files.filter((path) => /\.(db|sqlite|pem|key)$/.test(path))).toEqual([]);
      expect(files.filter((path) => /(^|\/)src\/.*\.d\.ts(?:\.map)?$/.test(path))).toEqual([]);
      expect(files.filter((path) => /\.test\./.test(path))).toEqual([]);
      expect(result.unpackedSize).toBeLessThan(8_000_000);
    }
  }, 120_000);

  test('actual tarballs install, typecheck, and load built exports in an isolated consumer', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'fred-packed-consumer-'));
    const packDir = join(tempDir, 'packs');
    const consumerDir = join(tempDir, 'consumer');
    tempDirs.push(tempDir);
    run('mkdir', ['-p', packDir, consumerDir]);

    const tarballs = new Map<string, string>();
    const externalDependencies: Record<string, string> = { typescript: '^5.9.3' };
    for (const packageDir of packageDirs) {
      const manifest = readManifest(packageDir);
      const result = pack(packageDir, packDir, false);
      const tarball = join(packDir, result.filename);
      if (!existsSync(tarball)) {
        throw new Error(`npm pack did not create ${tarball}; found: ${readdirSync(packDir).join(', ')}`);
      }
      const packedManifestPath = join(tempDir, `${packageDir}-package.json`);
      run('/bin/zsh', ['-lc', `unset BUN_BE_BUN; tar -xOf ${tarball} package/package.json > ${packedManifestPath}`]);
      const packedManifest = JSON.parse(readFileSync(packedManifestPath, 'utf8')) as PackageManifest;
      expect(packedManifest.name).toBe(manifest.name);
      expect(packedManifest.version).toBe(manifest.version);
      expect(packedManifest.license).toBe('MIT');
      for (const [name, version] of dependencyVersions(packedManifest)) {
        expect(version).not.toStartWith('workspace:');
      }
      for (const [name, version] of peerVersions(packedManifest)) {
        if (!name.startsWith('@fancyrobot/')) externalDependencies[name] = version;
      }
      tarballs.set(manifest.name, tarball);
    }

    const packedDependencies = Object.fromEntries(
      [...tarballs].map(([name, tarball]) => [name, `file:${tarball}`]),
    );
    const dependencies = Object.fromEntries([
      ...Object.entries(externalDependencies),
      ...Object.entries(packedDependencies),
    ]);
    writeFileSync(
      join(consumerDir, 'package.json'),
      JSON.stringify({ private: true, type: 'module', dependencies, overrides: packedDependencies }, null, 2),
    );
    writeFileSync(
      join(consumerDir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          skipLibCheck: true,
          strict: true,
          target: 'ES2022',
        },
        include: ['consumer.ts'],
      }, null, 2),
    );
    const specifiers = inventory.map((entry) => specifier(entry, readManifest(entry.packageDir)));
    writeFileSync(
      join(consumerDir, 'consumer.ts'),
      specifiers.map((name, index) => `import type * as Surface${index} from '${name}';\ntype T${index} = keyof typeof Surface${index};`).join('\n'),
    );
    const builtEntrypoints = inventory.map((entry) => {
      const manifest = readManifest(entry.packageDir);
      const target = manifest.exports[entry.subpath]!;
      return `./node_modules/${manifest.name}/${target.import.replace(/^\.\//, '')}`;
    });
    writeFileSync(
      join(consumerDir, 'runtime.mjs'),
      `await Promise.all(${JSON.stringify(builtEntrypoints)}.map((name) => import(name)));\n`,
    );

    run('bun', ['install', '--offline', '--ignore-scripts'], consumerDir);
    run(join(consumerDir, 'node_modules', '.bin', 'tsc'), ['--pretty', 'false'], consumerDir);
    run('bun', ['runtime.mjs'], consumerDir);

    for (const [name] of tarballs) {
      const packagePath = join(consumerDir, 'node_modules', ...name.split('/'));
      expect(existsSync(packagePath)).toBe(true);
      expect(readdirSync(packagePath)).toContain('dist');
    }
  }, 120_000);
});
