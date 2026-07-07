/**
 * Phase 43 Static Migration Contracts
 *
 * These tests lock migration constraints for Fred facade internals:
 * - packages/core/src/index.ts must not import imperative managers/registries/router
 * - Fred constructor/runtime setup must not instantiate those imperative classes
 * - Runtime lifecycle uses lazy initialization via ensureRuntime (not in constructor)
 * - Boundary execution uses Runtime.runPromise (runtime-scoped, not Effect.runPromise)
 */

import { describe, test, expect } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';
import { Fred } from '../../../../packages/core/src/index';

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

/**
 * Extract a method body from source text by matching a method signature.
 * Returns the full method body between the opening and closing braces.
 */
function extractMethodBody(source: string, methodSignature: RegExp): string {
  const match = source.match(methodSignature);
  if (!match || match.index === undefined) {
    return '';
  }

  // Find the opening brace after the signature
  let pos = match.index + match[0].length;
  while (pos < source.length && source[pos] !== '{') pos++;
  if (pos >= source.length) return '';

  // Track brace depth to find the closing brace
  let depth = 0;
  const start = pos;
  for (let i = pos; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
    if (depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return '';
}

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

describe('Runtime lifecycle contracts', () => {
  const source = fs.readFileSync(FRED_INDEX_PATH, 'utf-8');

  test('Fred source uses lazy runtime initialization via ensureRuntime', () => {
    // ensureRuntime method must exist
    expect(source).toMatch(/ensureRuntime/);

    // Constructor must NOT contain createFredRuntimeWithOptions or Layer.toRuntime
    const constructorBody = extractMethodBody(source, /constructor\s*\(tracer\?\s*:\s*Tracer\)/);
    expect(constructorBody).not.toBe('');
    expect(constructorBody).not.toMatch(/createFredRuntimeWithOptions/);
    expect(constructorBody).not.toMatch(/Layer\.toRuntime/);

    // ensureRuntime method definition must contain runtime creation call
    // (directly or via the shared buildRuntimeLayer helper).
    const ensureRuntimeBody = extractMethodBody(source, /private\s+async\s+ensureRuntime\s*\(\)/);
    expect(ensureRuntimeBody).not.toBe('');
    expect(ensureRuntimeBody).toMatch(/createFredRuntimeWithOptions|makeFredRuntimeLayer|buildRuntimeLayer/);

    // The shared layer builder must compose the canonical Fred layer graph.
    const buildLayerBody = extractMethodBody(source, /private\s+buildRuntimeLayer\s*\(\)/);
    expect(buildLayerBody).not.toBe('');
    expect(buildLayerBody).toMatch(/makeFredRuntimeLayer/);
  });

  test('Fred.create() eagerly initializes runtime', () => {
    // Fred.create static method must call ensureRuntime before returning
    const createBody = extractMethodBody(source, /static\s+async\s+create\s*\(/);
    expect(createBody).not.toBe('');
    expect(createBody).toMatch(/ensureRuntime\s*\(\)/);
  });
});

describe('Boundary execution contracts', () => {
  const source = fs.readFileSync(FRED_INDEX_PATH, 'utf-8');

  test('runEffect uses Runtime.runPromise for runtime-scoped execution', () => {
    // Extract runEffect method body (protected: FredBase delegations call it)
    const runEffectBody = extractMethodBody(source, /(?:private|protected)\s+async\s+runEffect\s*</);
    expect(runEffectBody).not.toBe('');

    // Must use Runtime.runPromise(runtime) — runtime-scoped execution
    expect(runEffectBody).toMatch(/Runtime\.runPromise\s*\(\s*runtime\s*\)/);

    // Must NOT use Effect.runPromise for boundary execution
    expect(runEffectBody).not.toMatch(/Effect\.runPromise/);
  });

  test('processMessage and streamMessage delegate through runEffect', () => {
    // Extract processMessage method body
    const processMessageBody = extractMethodBody(source, /async\s+processMessage\s*\(\s*message\s*:\s*string/);
    expect(processMessageBody).not.toBe('');

    // Extract streamMessage method body
    const streamMessageBody = extractMethodBody(source, /streamMessage\s*\(\s*message\s*:\s*string/);
    expect(streamMessageBody).not.toBe('');

    // Both must delegate through runEffect (which internally uses Runtime.runPromise)
    expect(processMessageBody).toMatch(/this\.runEffect/);
    expect(streamMessageBody).toMatch(/this\.runEffect/);
  });
});

describe('Consumer compatibility contracts', () => {
  test('direct context methods exist on lazy-init Fred instance', () => {
    const fred = new Fred();

    expect(typeof fred.generateConversationId).toBe('function');
    expect(typeof fred.setDefaultPolicy).toBe('function');
    expect(typeof fred.setStorage).toBe('function');
    expect(typeof fred.getHistory).toBe('function');
    expect(typeof fred.addMessages).toBe('function');
    expect(typeof fred.clearContext).toBe('function');
  });

  test('generateConversationId works pre-runtime', () => {
    const fred = new Fred();
    const id = fred.generateConversationId();

    expect(typeof id).toBe('string');
    expect(id).toMatch(/^conv_[0-9a-f-]{36}$/);
  });

  test('setDefaultPolicy stores policy pre-runtime for replay', () => {
    // Pre-runtime: should not throw
    const fred1 = new Fred();
    expect(() => fred1.setDefaultPolicy({ maxMessages: 50 })).not.toThrow();

    // With runtime: should also not throw (async create not awaited here, just verifying method exists)
    const fred2 = new Fred();
    expect(() => fred2.setDefaultPolicy({ maxMessages: 50 })).not.toThrow();
  });

  test('setStorage stores adapter pre-runtime for replay', () => {
    const fred = new Fred();
    const mockStorage = {
      get: async () => null,
      set: async () => {},
      delete: async () => {},
      clear: async () => {},
      listSessions: async () => [],
    };
    expect(() => fred.setStorage(mockStorage)).not.toThrow();
  });

  test('initializeFromConfig ensures runtime before delegating', () => {
    const source = fs.readFileSync(FRED_INDEX_PATH, 'utf-8');

    // Find initializeFromConfig method and extract its Promise<void> body
    // The signature spans multiple lines with options parameter, so match up to the return type
    const initBody = extractMethodBody(
      source,
      /async\s+initializeFromConfig[\s\S]*?:\s*Promise<void>/
    );
    expect(initBody).not.toBe('');
    expect(initBody).toMatch(/ensureRuntime/);

    // Verify ensureRuntime is called before configInitializer.initialize
    const ensureRuntimeIdx = initBody.indexOf('ensureRuntime');
    const delegateIdx = initBody.indexOf('configInitializer.initialize');
    expect(ensureRuntimeIdx).toBeGreaterThan(-1);
    expect(delegateIdx).toBeGreaterThan(-1);
    expect(ensureRuntimeIdx).toBeLessThan(delegateIdx);
  });
});
