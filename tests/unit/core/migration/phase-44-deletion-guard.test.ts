import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const CORE_SRC = join(PROJECT_ROOT, 'packages/core/src');

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

describe('Phase 44 deletion guards', () => {
  const deletedFiles = [
    'tool/registry.ts',
    'agent/manager.ts',
    'pipeline/manager.ts',
    'context/manager.ts',
    'hooks/manager.ts',
    'platform/registry.ts',
    'provider/service.ts',
    'routing/router.ts',
    'message-processor/processor.ts',
  ];

  for (const relativePath of deletedFiles) {
    test(`${relativePath} is deleted from repository`, () => {
      expect(existsSync(join(CORE_SRC, relativePath))).toBe(false);
    });
  }

  test('exports.ts does not export deleted imperative classes', () => {
    const exportsContent = readFileSync(join(CORE_SRC, 'exports.ts'), 'utf-8');
    const deletedExports = ['ToolRegistry', 'AgentManager', 'ContextManager', 'HookManager', 'MessageRouter'];

    for (const symbolName of deletedExports) {
      const symbolPattern = new RegExp(`\\b${symbolName}\\b`);
      expect(symbolPattern.test(exportsContent)).toBe(false);
    }
  });

  test('message-processor/index.ts does not re-export deleted processor module', () => {
    const indexContent = readFileSync(join(CORE_SRC, 'message-processor/index.ts'), 'utf-8');
    expect(indexContent).not.toContain('./processor');
    expect(/export\s*{\s*MessageProcessor\s*}/.test(indexContent)).toBe(false);
  });

  test('no new XxxManager() or new ToolRegistry() constructors in production code', () => {
    const forbiddenConstructors = [
      'ToolRegistry',
      'AgentManager',
      'PipelineManager',
      'ContextManager',
      'HookManager',
      'ProviderRegistry',
    ];

    const violations: string[] = [];
    const files = collectProductionTsFiles(CORE_SRC);

    for (const filePath of files) {
      const relativePath = filePath.replace(`${CORE_SRC}/`, '');
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          continue;
        }

        for (const className of forbiddenConstructors) {
          const constructorPattern = new RegExp(`\\bnew\\s+${className}\\s*\\(`);
          if (constructorPattern.test(line)) {
            violations.push(`${relativePath}:${index + 1}: ${trimmed}`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
