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

describe('Phase 44 boundary guards', () => {
  const boundaryFiles = new Set([
    'index.ts',
    'services.ts',
  ]);

  const knownExceptions = new Set([
    'agent/factory.ts',
    'pipeline/executor.ts',
    'pipeline/graph-executor.ts',
    'pipeline/service.ts',
    'hooks/service.ts',
    'eval/service.ts',
    'eval/replay.ts',
    'mcp/health.ts',
    'effect/index.ts',
    'observability/otel.ts',
    'observability/context.ts',
  ]);

  test('no NEW Effect.runPromise/Runtime.runPromise calls appear outside boundary and known exception files', () => {
    const violations: string[] = [];

    for (const filePath of collectProductionTsFiles(CORE_SRC)) {
      const relativePath = filePath.replace(`${CORE_SRC}/`, '');
      if (boundaryFiles.has(relativePath) || knownExceptions.has(relativePath)) {
        continue;
      }

      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
          continue;
        }

        if (line.includes('Effect.runPromise') || line.includes('Runtime.runPromise')) {
          violations.push(`${relativePath}:${index + 1}: ${trimmed}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('known exception files exist and still carry the audited runPromise usage', () => {
    for (const relativePath of knownExceptions) {
      const absolutePath = join(CORE_SRC, relativePath);
      expect(existsSync(absolutePath)).toBe(true);

      const content = readFileSync(absolutePath, 'utf-8');
      expect(content.includes('Effect.runPromise') || content.includes('Runtime.runPromise')).toBe(true);
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
