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

describe('Effect runtime boundary guards', () => {
  const VIOLATION_PATTERNS = [
    'Effect.runPromise',
    'Runtime.runPromise',
    'Effect.runFork',
    'Runtime.runFork',
  ];

  const boundaryFiles = new Set([
    'index.ts',
    'services.ts',
    'pipeline/service.ts',
    'pipeline/checkpoint/manager.ts',
    'pipeline/checkpoint/postgres.ts',
    'pipeline/checkpoint/sqlite.ts',
    'pipeline/pause/manager.ts',
  ]);

  const knownExceptions = new Set([
    'hooks/service.ts',
    'eval/service.ts',
    'eval/replay.ts',
    'mcp/health.ts',
  ]);

  test('no NEW Effect.runPromise/Runtime.runPromise/Effect.runFork/Runtime.runFork calls appear outside boundary and known exception files', () => {
    const violations: string[] = [];

    for (const filePath of collectProductionTsFiles(CORE_SRC)) {
      const relativePath = filePath.replace(`${CORE_SRC}/`, '');
      if (boundaryFiles.has(relativePath) || knownExceptions.has(relativePath)) {
        continue;
      }

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      let inBlockComment = false;

      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();

        if (inBlockComment) {
          if (trimmed.includes('*/')) {
            inBlockComment = false;
          }
          continue;
        }

        if (trimmed.startsWith('//')) {
          continue;
        }

        if (trimmed.includes('/*')) {
          if (!trimmed.includes('*/')) {
            inBlockComment = true;
          }
          continue;
        }

        if (VIOLATION_PATTERNS.some((pattern) => line.includes(pattern))) {
          violations.push(`${relativePath}:${index + 1}: ${trimmed}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('known exception files exist and still carry at least one audited boundary violation pattern', () => {
    for (const relativePath of knownExceptions) {
      const absolutePath = join(CORE_SRC, relativePath);
      expect(existsSync(absolutePath)).toBe(true);

      const content = readFileSync(absolutePath, 'utf-8');
      expect(VIOLATION_PATTERNS.some((pattern) => content.includes(pattern))).toBe(true);
    }
  });

  test('consumer files have no imperative manager imports', () => {
    const consumerFiles = [
      'packages/cli/src/commands/chat.ts',
      'packages/cli/src/commands/run.ts',
      'packages/cli/src/commands/session.ts',
      'packages/cli/src/eval.ts',
      'packages/cli/src/tui/session.ts',
      'packages/dev/src/dev-chat.ts',
      'packages/dev/src/server/app.ts',
      'packages/dev/src/server/chat/handlers.ts',
    ].map((relativePath) => join(PROJECT_ROOT, relativePath));

    const forbidden = ['ContextManager', 'AgentManager', 'PipelineManager', 'HookManager', 'ProviderRegistry', 'ToolRegistry'];

    for (const filePath of consumerFiles) {
      const content = readFileSync(filePath, 'utf-8');
      for (const className of forbidden) {
        const importPattern = new RegExp(`import[\\s\\S]*\\b${className}\\b[\\s\\S]*from`);
        expect(importPattern.test(content)).toBe(false);
      }
    }
  });
});
