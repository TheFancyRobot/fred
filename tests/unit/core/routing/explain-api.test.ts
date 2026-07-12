/**
 * Integration tests for Effect-native routing explanations.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Effect, Option } from 'effect';
import { createFred, type FredClient } from '../../../../packages/core/src/index';
import { MessageRouterService, ProviderRegistryService } from '../../../../packages/core/src/services';
import type { RoutingConfig } from '../../../../packages/core/src/routing/types';
import { createMockProvider } from '../../helpers/mock-provider';

async function registerMockAgent(
  fred: FredClient,
  agentId: string,
  response: string,
): Promise<void> {
  const agent = await fred.agents.register({
    id: agentId,
    platform: 'mock',
    model: 'mock-model',
    systemMessage: 'Mock agent',
  } as any);

  agent.processMessage = () => Effect.succeed({ content: response });
}

const configureRouting = (fred: FredClient, config: RoutingConfig): Promise<void> =>
  fred.effects.run(Effect.flatMap(MessageRouterService, (router) => router.setConfig(config)));

const testRoute = (
  fred: FredClient,
  message: string,
  metadata?: Record<string, unknown>,
) => fred.effects.run(
  Effect.option(Effect.flatMap(
    MessageRouterService,
    (router) => router.testRoute(message, metadata),
  )),
).then(Option.getOrNull);

const explainRoute = async (
  fred: FredClient,
  message: string,
  metadata?: Record<string, unknown>,
) => (await testRoute(fred, message, metadata))?.explanation ?? null;

describe('Routing Explain API Integration', () => {
  let fred: FredClient;

  beforeEach(async () => {
    fred = await createFred();
    await fred.effects.run(
      Effect.flatMap(ProviderRegistryService, (providers) =>
        providers.registerDefinition({ ...createMockProvider('mock'), aliases: [] })
      ),
    );
    await configureRouting(fred, {
      defaultAgent: 'help-agent',
      rules: [
        { id: 'help-rule', agent: 'help-agent', patterns: ['^help'] },
        { id: 'math-rule', agent: 'math-agent', patterns: ['math|calculate|compute'] },
      ],
    });

    await registerMockAgent(fred, 'help-agent', 'Help response');
    await registerMockAgent(fred, 'math-agent', 'Math response');
  });

  afterEach(async () => {
    await fred.shutdown();
  });

  it('returns RoutingExplanation for a rule-matched message', async () => {
    const explanation = await explainRoute(fred, 'help me with something');

    expect(explanation).toBeDefined();
    expect(explanation!.winner.targetId).toBe('help-agent');
    expect(explanation!.confidence).toBeGreaterThan(0);
    expect(explanation!.matchType).toBe('regex');
    expect(explanation!.narrative).toContain('help-agent');
  });

  it('returns an explanation with alternatives', async () => {
    const explanation = await explainRoute(fred, 'help with math');

    expect(explanation?.winner).toBeDefined();
    expect(Array.isArray(explanation?.alternatives)).toBe(true);
  });

  it('returns null when no router is configured', async () => {
    const noRouter = await createFred();
    try {
      expect(await explainRoute(noRouter, 'test message')).toBeNull();
    } finally {
      await noRouter.shutdown();
    }
  });

  it('includes explanation metadata in the routing decision', async () => {
    const decision = await testRoute(fred, 'help me');

    expect(decision?.agent).toBe('help-agent');
    expect(decision?.explanation?.winner.targetId).toBe('help-agent');
  });

  it('includes a human-readable narrative', async () => {
    const explanation = await explainRoute(fred, 'help me');

    expect(typeof explanation?.narrative).toBe('string');
    expect(explanation?.narrative.length).toBeGreaterThan(0);
    expect(explanation?.narrative).toContain('help-agent');
  });

  it('uses numeric confidence without qualitative labels', async () => {
    const explanation = await explainRoute(fred, 'help me');

    expect(typeof explanation?.confidence).toBe('number');
    expect(explanation!.confidence).toBeGreaterThanOrEqual(0);
    expect(explanation!.confidence).toBeLessThanOrEqual(1);
    expect(explanation!.narrative).not.toMatch(/\b(HIGH|MEDIUM|LOW)\b/);
  });

  it('sorts alternatives by descending confidence', async () => {
    await configureRouting(fred, {
      defaultAgent: 'help-agent',
      rules: [
        { id: 'rule-1', agent: 'help-agent', patterns: ['help'], priority: 100 },
        { id: 'rule-2', agent: 'math-agent', patterns: ['help'], priority: 50 },
      ],
    });

    const explanation = await explainRoute(fred, 'help me');
    expect(explanation!.alternatives.length).toBeGreaterThan(0);
    for (let index = 1; index < explanation!.alternatives.length; index++) {
      expect(explanation!.alternatives[index - 1].confidence).toBeGreaterThanOrEqual(
        explanation!.alternatives[index].confidence,
      );
    }
  });

  it('includes calibration metadata', async () => {
    const explanation = await explainRoute(fred, 'help me');

    expect(explanation?.calibrationMetadata.rawScore).toBeDefined();
    expect(explanation?.calibrationMetadata.calibratedScore).toBeDefined();
    expect(typeof explanation?.calibrationMetadata.calibrated).toBe('boolean');
  });

  it('defines the concerns array', async () => {
    const explanation = await explainRoute(fred, 'help me');
    expect(Array.isArray(explanation?.concerns)).toBe(true);
  });
});
