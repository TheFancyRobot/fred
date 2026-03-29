import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const CLI_TUI_SRC = join(PROJECT_ROOT, 'packages/cli/src/tui');
const OPENTUI_MAIN_ENTRY = join(PROJECT_ROOT, 'node_modules/@opentui/core/index.js');
const OPENTUI_TESTING_ENTRY = join(PROJECT_ROOT, 'node_modules/@opentui/core/testing.js');

function collectProductionTsFiles(dir: string): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectProductionTsFiles(fullPath));
      continue;
    }

    if (fullPath.endsWith('.ts') && !fullPath.endsWith('.test.ts')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('OpenTUI security guards', () => {
  test('CLI TUI code does not import the OpenTUI 3D/image entrypoint', () => {
    const violations: string[] = [];

    for (const filePath of collectProductionTsFiles(CLI_TUI_SRC)) {
      const relativePath = filePath.replace(`${PROJECT_ROOT}/`, '');
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let index = 0; index < lines.length; index++) {
        if (lines[index].includes("@opentui/core/3d")) {
          violations.push(`${relativePath}:${index + 1}: ${lines[index].trim()}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('current OpenTUI main and testing entrypoints do not reference Jimp or 3D helpers', () => {
    const mainEntry = readFileSync(OPENTUI_MAIN_ENTRY, 'utf-8');
    const testingEntry = readFileSync(OPENTUI_TESTING_ENTRY, 'utf-8');

    for (const content of [mainEntry, testingEntry]) {
      expect(content.includes('Jimp')).toBe(false);
      expect(content.includes('./3d')).toBe(false);
      expect(content.includes('TextureUtils')).toBe(false);
    }
  });
});
