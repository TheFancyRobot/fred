/**
 * Phase 43 Static Migration Contracts
 *
 * These tests lock migration constraints for Fred facade internals:
 * - packages/core/src/index.ts must not import imperative managers/registries/router
 * - Fred constructor/runtime setup must not instantiate those imperative classes
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

const PROJECT_ROOT = path.resolve(import.meta.dir, '../../../..');
const FRED_INDEX_PATH = path.join(PROJECT_ROOT, 'packages/core/src/index.ts');

const FORBIDDEN_SYMBOLS = [
  'ToolRegistry',
  'AgentManager',
  'PipelineManager',
  'ContextManager',
  'HookManager',
  'ProviderRegistry',
  'MessageRouter',
] as const;

describe('Phase 43 Static Migration Contracts', () => {
  test('Fred index does not import forbidden imperative seams', () => {
    const content = fs.readFileSync(FRED_INDEX_PATH, 'utf-8');

    for (const symbol of FORBIDDEN_SYMBOLS) {
      const importPattern = new RegExp(`\\bimport\\b[\\s\\S]*?\\b${symbol}\\b[\\s\\S]*?from\\s+['\"][^'\"]+['\"]`, 'm');
      expect(importPattern.test(content)).toBe(false);
    }
  });

  test('Fred source does not construct forbidden imperative classes', () => {
    const content = fs.readFileSync(FRED_INDEX_PATH, 'utf-8');

    for (const symbol of FORBIDDEN_SYMBOLS) {
      const constructionPattern = new RegExp(`\\bnew\\s+${symbol}\\s*\\(`);
      expect(constructionPattern.test(content)).toBe(false);
    }
  });
});
