/**
 * Phase 43 static migration contracts for the supported scoped client.
 *
 * The client boundary composes Effect services directly, owns one scoped
 * runtime, and must not revive imperative manager or registry facades.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createFred } from '../../../../packages/core/src/index';
import { ToolRegistryService } from '../../../../packages/core/src/services';

const CLIENT_SOURCE_PATH = join(process.cwd(), 'packages/core/src/client.ts');
const source = readFileSync(CLIENT_SOURCE_PATH, 'utf-8');

const FORBIDDEN_SYMBOLS = [
  'ToolRegistry',
  'AgentManager',
  'PipelineManager',
  'ContextManager',
  'HookManager',
  'ProviderRegistry',
  'MessageRouter',
] as const;

function extractFunctionBody(sourceText: string, signature: RegExp): string {
  const match = sourceText.match(signature);
  if (!match || match.index === undefined) return '';

  let position = match.index + match[0].length;
  while (position < sourceText.length && sourceText[position] !== '{') position++;
  if (position >= sourceText.length) return '';

  let depth = 0;
  const start = position;
  for (let index = position; index < sourceText.length; index++) {
    if (sourceText[index] === '{') depth++;
    else if (sourceText[index] === '}') depth--;
    if (depth === 0) return sourceText.slice(start, index + 1);
  }
  return '';
}

describe('Phase 43 static migration contracts', () => {
  test('client source does not import forbidden imperative seams', () => {
    for (const symbol of FORBIDDEN_SYMBOLS) {
      const importPattern = new RegExp(
        `\\bimport\\b[\\s\\S]*?\\b${symbol}\\b[\\s\\S]*?from\\s+['\"][^'\"]+['\"]`,
        'm',
      );
      expect(importPattern.test(source)).toBe(false);
    }
  });

  test('client source does not construct forbidden imperative classes', () => {
    for (const symbol of FORBIDDEN_SYMBOLS) {
      expect(source).not.toMatch(new RegExp(`\\bnew\\s+${symbol}\\s*\\(`));
    }
  });

  test('createFred composes and scopes the canonical service layer', () => {
    const createBody = extractFunctionBody(
      source,
      /export\s+async\s+function\s+createFred[\s\S]*?:\s*Promise<FredClient>/,
    );

    expect(createBody).not.toBe('');
    expect(createBody).toMatch(/makeFredRuntimeLayer/);
    expect(createBody).toMatch(/Scope\.extend\(Layer\.toRuntime/);
    expect(createBody).toMatch(/Scope\.close/);
  });

  test('client calls share the owned runtime through the boundary helper', () => {
    expect(source).toMatch(/const\s+run\s*=\s*<A,\s*E>/);
    expect(source).toMatch(/Runtime\.runPromise\(clientRuntime\)/);
    expect(source).toMatch(/Effect\.exit\(effect\)/);
  });
});

describe('Scoped client compatibility contracts', () => {
  test('grouped context and tool capabilities operate against shared services', async () => {
    const fred = await createFred();
    try {
      const session = await fred.sessions.open();
      expect(session.id).toMatch(/^conv_[0-9a-f-]{36}$/);

      const serviceToolCount = await fred.effects.run(
        Effect.flatMap(ToolRegistryService, (tools) => tools.size()),
      );
      expect(serviceToolCount).toBe((await fred.tools.list()).length);
    } finally {
      await fred.shutdown();
    }
  });

  test('configuration delegates through the service-backed initializer', () => {
    expect(source).toMatch(/initializer\.initializeServices\(/);
    expect(source).not.toMatch(/initializer\.initialize\(/);
  });
});
