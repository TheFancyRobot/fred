/**
 * Phase 60 / STEP-60-03: snapshot/replay machinery removal.
 *
 * The scoped client owns one live Effect service graph. Mutating routing,
 * workflows, tools, and intents preserves the state already registered in it.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect } from 'effect';
import { createFred } from '../../../../packages/core/src/index';
import {
  IntentMatcherService,
  MessageRouterService,
} from '../../../../packages/core/src/services';
import type { Tool } from '../../../../packages/core/src/tool/tool';

const CLIENT_SOURCE_PATH = join(process.cwd(), 'packages/core/src/client.ts');

function makeTool(id: string): Tool {
  return {
    id,
    name: id,
    description: `test tool ${id}`,
    parameters: { type: 'object', properties: {} },
    execute: () => 'ok',
  } as unknown as Tool;
}

describe('Phase 60 scoped runtime contracts', () => {
  test('snapshot/replay machinery is absent from the supported client', () => {
    const source = readFileSync(CLIENT_SOURCE_PATH, 'utf-8');
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

  test('tool registration writes immediately to the live client runtime', async () => {
    const fred = await createFred();
    try {
      await fred.tools.register(makeTool('live-tool'));
      expect((await fred.tools.list()).some((tool) => tool.id === 'live-tool')).toBe(true);
    } finally {
      await fred.shutdown();
    }
  });

  test('routing mutation preserves previously registered state', async () => {
    const fred = await createFred();
    try {
      await fred.tools.register(makeTool('survives-routing-change'));
      await fred.effects.run(
        Effect.flatMap(MessageRouterService, (router) =>
          router.setConfig({ defaultAgent: 'a1', rules: [] })
        ),
      );

      expect((await fred.tools.list()).some(
        (tool) => tool.id === 'survives-routing-change',
      )).toBe(true);
    } finally {
      await fred.shutdown();
    }
  });

  test('workflow definitions preserve client runtime state', async () => {
    const fred = await createFred();
    try {
      await fred.tools.register(makeTool('survives-workflow-changes'));
      await fred.workflows.define({
        id: 'wf-one',
        steps: [{ type: 'function', name: 'one', fn: () => 'one' }],
      });
      await fred.workflows.define({
        id: 'wf-two',
        steps: [{ type: 'function', name: 'two', fn: () => 'two' }],
      });

      expect((await fred.workflows.list()).map(({ id }) => id).sort()).toEqual([
        'wf-one',
        'wf-two',
      ]);
      expect((await fred.tools.list()).some(
        (tool) => tool.id === 'survives-workflow-changes',
      )).toBe(true);
    } finally {
      await fred.shutdown();
    }
  });

  test('intent registration is additive upsert, not replace', async () => {
    const fred = await createFred();
    try {
      await fred.effects.run(
        Effect.flatMap(IntentMatcherService, (matcher) =>
          matcher.registerIntents([
            { id: 'intent-a', utterances: ['alpha'], action: { type: 'agent', target: 'a1' } },
          ])
        ),
      );
      await fred.effects.run(
        Effect.flatMap(IntentMatcherService, (matcher) =>
          matcher.registerIntents([
            { id: 'intent-b', utterances: ['beta'], action: { type: 'agent', target: 'a2' } },
          ])
        ),
      );

      const ids = await fred.effects.run(
        Effect.flatMap(IntentMatcherService, (matcher) =>
          Effect.map(matcher.getIntents(), (intents) =>
            intents.map((intent) => intent.id).sort()
          )
        ),
      );
      expect(ids).toEqual(['intent-a', 'intent-b']);
    } finally {
      await fred.shutdown();
    }
  });
});
