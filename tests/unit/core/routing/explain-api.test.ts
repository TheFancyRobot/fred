/**
 * Integration tests for routing explain() API and AgentResponse extension
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Fred } from '../../../../packages/core/src/index';
import { createMockProvider } from '../../helpers/mock-provider';

async function registerMockAgent(
  fred: Fred,
  agentId: string,
  response: string
): Promise<void> {
  if (!fred.hasProvider('mock')) {
    const provider = createMockProvider('mock');
    fred.registerProvider('mock', { ...provider, aliases: [] });
  }

  const agent = await fred.registerAgent({
    id: agentId,
    platform: 'mock',
    model: 'mock-model',
    systemMessage: 'Mock agent',
  } as any);

  agent.processMessage = async () => ({ content: response });
}

describe('Routing Explain API Integration', () => {
  let fred: Fred;

  beforeEach(async () => {
    fred = await Fred.create();

    fred.configureRouting({
      defaultAgent: 'help-agent',
      rules: [
        {
          id: 'help-rule',
          agent: 'help-agent',
          patterns: ['^help'],
        },
        {
          id: 'math-rule',
          agent: 'math-agent',
          patterns: ['math|calculate|compute'],
        },
      ],
    });

    await registerMockAgent(fred, 'help-agent', 'Help response');
    await registerMockAgent(fred, 'math-agent', 'Math response');
  });

  afterEach(async () => {
    await fred.shutdown();
  });

  it('fred.routing.explain() returns RoutingExplanation for rule-matched message', async () => {
    const explanation = await fred.routing.explain('help me with something');

    expect(explanation).toBeDefined();
    expect(explanation!.winner).toBeDefined();
    expect(explanation!.winner.targetId).toBe('help-agent');
    expect(explanation!.confidence).toBeGreaterThan(0);
    expect(explanation!.matchType).toBe('regex');
    expect(explanation!.narrative).toContain('help-agent');
  });

  it('fred.routing.explain() returns explanation with alternatives', async () => {
    const explanation = await fred.routing.explain('help with math');

    expect(explanation).toBeDefined();
    expect(explanation!.winner).toBeDefined();
    expect(explanation!.alternatives).toBeDefined();
    expect(Array.isArray(explanation!.alternatives)).toBe(true);
  });

  it('fred.routing.explain() returns null when no router configured', async () => {
    const fredNoRouter = await Fred.create();
    try {
      const explanation = await fredNoRouter.routing.explain('test message');
      expect(explanation).toBeNull();
    } finally {
      await fredNoRouter.shutdown();
    }
  });

  it('testRoute includes explanation metadata', async () => {
    const decision = await fred.testRoute('help me');

    expect(decision).toBeDefined();
    expect(decision?.agent).toBe('help-agent');
    expect(decision?.explanation).toBeDefined();
    expect(decision?.explanation?.winner.targetId).toBe('help-agent');
  });

  it('explanation narrative contains routing details', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.narrative).toBeDefined();
    expect(typeof explanation!.narrative).toBe('string');
    expect(explanation!.narrative.length).toBeGreaterThan(0);
    expect(explanation!.narrative).toContain('help-agent');
  });

  it('explanation confidence is numeric (no qualitative labels)', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(typeof explanation!.confidence).toBe('number');
    expect(explanation!.confidence).toBeGreaterThanOrEqual(0);
    expect(explanation!.confidence).toBeLessThanOrEqual(1);
    expect(explanation!.narrative).not.toMatch(/\b(HIGH|MEDIUM|LOW)\b/);
  });

  it('explanation alternatives sorted by confidence descending', async () => {
    fred.configureRouting({
      defaultAgent: 'help-agent',
      rules: [
        {
          id: 'rule-1',
          agent: 'help-agent',
          patterns: ['help'],
          priority: 100,
        },
        {
          id: 'rule-2',
          agent: 'math-agent',
          patterns: ['help'],
          priority: 50,
        },
      ],
    });

    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.alternatives.length).toBeGreaterThan(0);

    for (let i = 1; i < explanation!.alternatives.length; i++) {
      expect(explanation!.alternatives[i - 1].confidence).toBeGreaterThanOrEqual(
        explanation!.alternatives[i].confidence
      );
    }
  });

  it('explanation includes calibration metadata', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.calibrationMetadata).toBeDefined();
    expect(explanation!.calibrationMetadata.rawScore).toBeDefined();
    expect(explanation!.calibrationMetadata.calibratedScore).toBeDefined();
    expect(typeof explanation!.calibrationMetadata.calibrated).toBe('boolean');
  });

  it('explanation concerns array is defined (may be empty)', async () => {
    const explanation = await fred.routing.explain('help me');

    expect(explanation).toBeDefined();
    expect(explanation!.concerns).toBeDefined();
    expect(Array.isArray(explanation!.concerns)).toBe(true);
  });
});
