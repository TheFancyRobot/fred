import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = process.cwd();
const CORE_SRC = join(PROJECT_ROOT, 'packages/core/src');
const CLI_SRC = join(PROJECT_ROOT, 'packages/cli/src');

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

function findRuntimeBoundaryViolations(
  sourceRoot: string,
  boundaryFiles: ReadonlySet<string>,
  violationPatterns: ReadonlyArray<string>
): string[] {
  const violations: string[] = [];

  for (const filePath of collectProductionTsFiles(sourceRoot)) {
    const relativePath = filePath.replace(`${sourceRoot}/`, '');
    if (boundaryFiles.has(relativePath)) {
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

      if (violationPatterns.some((pattern) => line.includes(pattern))) {
        violations.push(`${relativePath}:${index + 1}: ${trimmed}`);
      }
    }
  }

  return violations;
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
    'client.ts',
    'services.ts',
    'eval/replay.ts',
    'hooks/service.ts',
    'mcp/health.ts',
    'pipeline/service.ts',
    'pipeline/checkpoint/manager.ts',
    'pipeline/checkpoint/postgres.ts',
    'pipeline/checkpoint/sqlite.ts',
    'pipeline/pause/manager.ts',
  ]);

  const cliBoundaryFiles = new Set([
    'commands/chat.ts',
    'commands/run.ts',
    'commands/status.ts',
    'commands/session.ts',
    'commands/validate.ts',
    'commands/intent.ts',
    'commands/list.ts',
    'commands/route.ts',
    'commands/mcp.ts',
    'eval.ts',
  ]);

  test('no Effect.runPromise/Runtime.runPromise/Effect.runFork/Runtime.runFork calls appear outside boundary files in core package', () => {
    const violations = findRuntimeBoundaryViolations(
      CORE_SRC,
      boundaryFiles,
      VIOLATION_PATTERNS
    );
    expect(violations).toEqual([]);
  });

  test('no Effect.runPromise/Runtime.runPromise/Effect.runFork/Runtime.runFork calls in non-boundary CLI files', () => {
    const violations = findRuntimeBoundaryViolations(
      CLI_SRC,
      cliBoundaryFiles,
      VIOLATION_PATTERNS
    );
    expect(violations).toEqual([]);
  });

  test('consumer files have no imperative manager imports', () => {
    const consumerFiles = [
      'packages/cli/src/commands/chat.ts',
      'packages/cli/src/commands/run.ts',
      'packages/cli/src/commands/session.ts',
      'packages/cli/src/eval.ts',
      'packages/cli/src/tui/session.ts',
      'packages/dev/src/dev-chat.ts',
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
