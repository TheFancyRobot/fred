/**
 * Phase 60 / STEP-60-03: snapshot/replay machinery removal.
 *
 * The Effect runtime is built lazily exactly once and never invalidated:
 * - synchronous registration methods force a synchronous runtime build
 * - configuration changes (routing, tracer, workflows) are live service
 *   mutations that preserve runtime identity
 * - initializeFromConfig re-initialization mutates instead of rebuilding
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Fred } from '../../../../packages/core/src/index';
import type { Tool } from '../../../../packages/core/src/tool/tool';

const FRED_INDEX_PATH = join(
  process.cwd(),
  'packages/core/src/index.ts'
);

function makeTool(id: string): Tool {
  return {
    id,
    name: id,
    description: `test tool ${id}`,
    parameters: { type: 'object', properties: {} },
    execute: () => 'ok',
  } as unknown as Tool;
}

describe('Phase 60 eager runtime contracts', () => {
  test('snapshot/replay machinery is deleted from the Fred facade', () => {
    const source = readFileSync(FRED_INDEX_PATH, 'utf-8');
    for (const forbidden of [
      'applyRuntimeState',
      'runtimeGeneration',
      'invalidateRuntime',
      'toolSnapshot',
      'intentSnapshot',
      'providerSnapshot',
      'workflowSnapshot',
      'hookSnapshot',
      'graphWorkflowSnapshot',
      'pendingContextPolicy',
      'pendingStorageAdapter',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  test('synchronous registration before create() builds the runtime and persists', async () => {
    const fred = new Fred();

    // Sync registration with no runtime forces a synchronous build.
    fred.registerTool(makeTool('sync-built'));
    expect(fred.getTool('sync-built')).toBeDefined();

    // The same runtime is reused by the async path — no rebuild, no replay.
    const runtime = await fred.getRuntime();
    expect(fred.getTool('sync-built')).toBeDefined();
    expect(await fred.getRuntime()).toBe(runtime);

    await fred.shutdown();
  });

  test('configureRouting after create() mutates the live runtime (identity preserved)', async () => {
    const fred = await Fred.create();
    const runtimeBefore = await fred.getRuntime();

    fred.registerTool(makeTool('survives-routing-change'));
    fred.configureRouting({ defaultAgent: 'a1', rules: [] });

    const runtimeAfter = await fred.getRuntime();
    expect(runtimeAfter).toBe(runtimeBefore);
    // State registered before the routing change is still present.
    expect(fred.getTool('survives-routing-change')).toBeDefined();

    await fred.shutdown();
  });

  test('enableTracing and configureWorkflows preserve runtime identity and state', async () => {
    const fred = await Fred.create();
    const runtimeBefore = await fred.getRuntime();

    fred.registerTool(makeTool('survives-config-changes'));
    fred.enableTracing();
    fred.configureWorkflows([
      { name: 'wf-one', defaultAgent: 'a1', agents: ['a1'] },
    ]);
    fred.configureWorkflows([
      { name: 'wf-two', defaultAgent: 'a2', agents: ['a2'] },
    ]);

    expect(await fred.getRuntime()).toBe(runtimeBefore);
    expect(fred.getTool('survives-config-changes')).toBeDefined();
    // configureWorkflows replaces the workflow set (clear + add).
    expect(fred.hasWorkflow('wf-one')).toBe(false);
    expect(fred.hasWorkflow('wf-two')).toBe(true);

    await fred.shutdown();
  });

  test('registerIntents is additive upsert, not replace', async () => {
    const fred = await Fred.create();

    fred.registerIntents([
      { id: 'intent-a', utterances: ['alpha'], action: { type: 'agent', target: 'a1' } },
    ]);
    fred.registerIntents([
      { id: 'intent-b', utterances: ['beta'], action: { type: 'agent', target: 'a2' } },
    ]);

    const ids = fred.getIntents().map((intent) => intent.id).sort();
    expect(ids).toEqual(['intent-a', 'intent-b']);

    await fred.shutdown();
  });
});
