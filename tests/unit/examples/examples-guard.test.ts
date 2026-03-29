import { describe, expect, test } from 'bun:test';
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const EXPECTED_EXAMPLES = [
  '01-quickstart-single-agent',
  '02-tools-basics',
  '03-intent-routing-basics',
  '04-dynamic-handoff',
  '05-pipeline-sequential',
  '06-pipeline-graph-workflow',
  '07-hooks-and-middleware',
  '08-observability-tracing',
  '09-evaluation-harness-golden-traces',
  '10-config-driven-yaml',
  '11-mcp-integration',
  '12-cli-and-tui',
  '13-multi-agent-workflows',
] as const;

const examplesDir = path.resolve(__dirname, '../../../examples');
const projectRoot = path.resolve(__dirname, '../../..');

function collectTypeScriptFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...collectTypeScriptFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith('.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Run `bunx tsc --noEmit -p <tsconfig>` and return only errors
 * originating from the example's own source directory.
 * Pre-existing errors in packages/core etc. are filtered out.
 */
function getExampleCompileErrors(exampleName: string): string[] {
  const tsconfigPath = path.join(examplesDir, exampleName, 'tsconfig.json');
  const examplePrefix = `examples/${exampleName}/`;

  try {
    execSync(`bunx tsc --noEmit -p ${tsconfigPath}`, {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return [];
  } catch (err: unknown) {
    const output =
      (err as { stdout?: string }).stdout ||
      (err as { stderr?: string }).stderr ||
      '';
    // Filter to only errors from this example's own files
    return output
      .split('\n')
      .filter(
        (line) => line.startsWith(examplePrefix) && line.includes('error TS'),
      );
  }
}

describe('examples-guard', () => {
  const missingExampleDirs = EXPECTED_EXAMPLES.filter(
    (name) => !existsSync(path.join(examplesDir, name)),
  );

  test('all expected example directories exist', () => {
    expect(missingExampleDirs).toEqual([]);
  });

  test('each example directory has required files and folders', () => {
    for (const exampleName of EXPECTED_EXAMPLES) {
      const exampleRoot = path.join(examplesDir, exampleName);
      expect(existsSync(path.join(exampleRoot, 'package.json'))).toBe(true);
      expect(existsSync(path.join(exampleRoot, 'README.md'))).toBe(true);
      expect(existsSync(path.join(exampleRoot, '.env.example'))).toBe(true);
      expect(existsSync(path.join(exampleRoot, 'tsconfig.json'))).toBe(true);

      const srcDir = path.join(exampleRoot, 'src');
      expect(existsSync(srcDir)).toBe(true);
      expect(statSync(srcDir).isDirectory()).toBe(true);
    }
  });

  test('example source files avoid relative package imports and use @fancyrobot/fred imports', () => {
    for (const exampleName of EXPECTED_EXAMPLES) {
      const srcDir = path.join(examplesDir, exampleName, 'src');
      const tsFiles = collectTypeScriptFiles(srcDir);
      let hasFredImport = false;

      expect(tsFiles.length).toBeGreaterThan(0);

      for (const filePath of tsFiles) {
        const source = readFileSync(filePath, 'utf-8');
        expect(source).not.toMatch(/\.\.\/\.\.\/src/);
        expect(source).not.toMatch(/\.\.\/packages\//);
        if (/from\s+['"]@fancyrobot\/fred(?:\/[^'"]+)?['"]/.test(source)) {
          hasFredImport = true;
        }
      }

      expect(hasFredImport).toBe(true);
    }
  });

  test(
    'each example TypeScript source compiles without errors',
    () => {
    const failures: Array<{ example: string; errors: string[] }> = [];

    for (const exampleName of EXPECTED_EXAMPLES) {
      const tsconfigPath = path.join(
        examplesDir,
        exampleName,
        'tsconfig.json',
      );
      if (!existsSync(tsconfigPath)) {
        failures.push({
          example: exampleName,
          errors: [`Missing tsconfig.json at ${tsconfigPath}`],
        });
        continue;
      }

      const errors = getExampleCompileErrors(exampleName);
      if (errors.length > 0) {
        failures.push({ example: exampleName, errors });
      }
    }

    if (failures.length > 0) {
      const report = failures
        .map(
          ({ example, errors }) =>
            `\n  ✗ ${example}:\n${errors.map((e) => `      ${e}`).join('\n')}`,
        )
        .join('');
      throw new Error(`TypeScript compile failures:${report}`);
    }
  },
    // Each tsc invocation takes ~2s; 13 examples ≈ 26s
    60_000,
  );
});
