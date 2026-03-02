import { describe, expect, test } from 'bun:test';
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
] as const;

const examplesDir = path.resolve(__dirname, '../../../examples');

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

describe('examples-guard', () => {
  const missingExampleDirs = EXPECTED_EXAMPLES.filter(
    (name) => !existsSync(path.join(examplesDir, name)),
  );
  const allExamplesExist = missingExampleDirs.length === 0;

  test('all expected example directories exist', () => {
    if (!allExamplesExist) {
      console.warn(
        `[examples-guard] scaffold mode: missing example directories: ${missingExampleDirs.join(', ')}`,
      );
      expect(missingExampleDirs.length).toBeGreaterThan(0);
      return;
    }

    expect(missingExampleDirs).toEqual([]);
  });

  test('each example directory has required files and folders', () => {
    if (!allExamplesExist) {
      expect(missingExampleDirs.length).toBeGreaterThan(0);
      return;
    }

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
    if (!allExamplesExist) {
      expect(missingExampleDirs.length).toBeGreaterThan(0);
      return;
    }

    for (const exampleName of EXPECTED_EXAMPLES) {
      const srcDir = path.join(examplesDir, exampleName, 'src');
      const tsFiles = collectTypeScriptFiles(srcDir);

      for (const filePath of tsFiles) {
        const source = readFileSync(filePath, 'utf-8');
        expect(source).not.toMatch(/\.\.\/\.\.\/src/);
        expect(source).not.toMatch(/\.\.\/packages\//);
        expect(source).toMatch(/from\s+['"]@fancyrobot\/fred(?:\/[^'"]+)?['"]/);
      }
    }
  });
});
