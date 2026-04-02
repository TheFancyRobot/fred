/**
 * Fred routing integration tests
 *
 * Tests Fred.configureRouting(), Fred.testRoute(), and routing integration.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Effect } from 'effect';
import { Fred } from '../../../../packages/core/src/index';
import type { RoutingConfig } from '../../../../packages/core/src/routing/types';
import { createMockProvider } from '../../helpers/mock-provider';

async function registerMockAgent(
  fred: Fred,
  agentId: string,
  options?: { persistHistory?: boolean; response?: string }
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
    persistHistory: options?.persistHistory,
  } as any);

  agent.processMessage = () => Effect.succeed({ content: options?.response ?? 'Mock response' });
}

describe('Fred Routing Integration', () => {
  let fred: Fred;

  beforeEach(async () => {
    fred = await Fred.create();
  });

  afterEach(async () => {
    await fred.shutdown();
  });

  describe('configureRouting', () => {
    it('should configure routing through public facade paths', async () => {
      await registerMockAgent(fred, 'support-agent');
      await registerMockAgent(fred, 'sales-agent');

      const routingConfig: RoutingConfig = {
        defaultAgent: 'support-agent',
        rules: [
          { id: 'sales-rule', agent: 'sales-agent', keywords: ['pricing', 'buy'] },
        ],
      };

      fred.configureRouting(routingConfig);

      const decision = await fred.testRoute('I want to buy');
      expect(decision?.agent).toBe('sales-agent');
    });
  });

  describe('testRoute', () => {
    it('should return null if routing is not configured', async () => {
      const decision = await fred.testRoute('any message');
      expect(decision).toBeNull();
    });

    it('should return routing decision when configured', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'help-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'help-rule', agent: 'help-agent', keywords: ['help', 'support'] },
        ],
      });

      const helpDecision = await fred.testRoute('I need help');
      expect(helpDecision).not.toBeNull();
      expect(helpDecision?.agent).toBe('help-agent');
      expect(helpDecision?.fallback).toBe(false);
      expect(helpDecision?.matchType).toBe('keyword');

      const defaultDecision = await fred.testRoute('hello world');
      expect(defaultDecision).not.toBeNull();
      expect(defaultDecision?.agent).toBe('default-agent');
      expect(defaultDecision?.fallback).toBe(true);
    });

    it('should pass metadata to router', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'vip-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'vip-rule', agent: 'vip-agent', metadata: { tier: 'vip' } },
        ],
      });

      const vipDecision = await fred.testRoute('any message', { tier: 'vip' });
      expect(vipDecision).not.toBeNull();
      expect(vipDecision?.agent).toBe('vip-agent');
      expect(vipDecision?.matchType).toBe('metadata-only');

      const regularDecision = await fred.testRoute('any message', { tier: 'regular' });
      expect(regularDecision).not.toBeNull();
      expect(regularDecision?.agent).toBe('default-agent');
      expect(regularDecision?.fallback).toBe(true);
    });

    it('should handle regex pattern matching', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'weather-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'weather-rule', agent: 'weather-agent', patterns: ['^weather', 'forecast'] },
        ],
      });

      const weatherDecision = await fred.testRoute('weather in NYC');
      expect(weatherDecision?.agent).toBe('weather-agent');
      expect(weatherDecision?.matchType).toBe('regex');

      const forecastDecision = await fred.testRoute('give me the forecast');
      expect(forecastDecision?.agent).toBe('weather-agent');
    });

    it('should handle function matchers', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'long-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          {
            id: 'long-message',
            agent: 'long-agent',
            matcher: (msg) => msg.length > 50,
          },
        ],
      });

      const shortDecision = await fred.testRoute('hi');
      expect(shortDecision?.agent).toBe('default-agent');

      const longDecision = await fred.testRoute('This is a very long message that exceeds fifty characters in length');
      expect(longDecision?.agent).toBe('long-agent');
      expect(longDecision?.matchType).toBe('function');
    });
  });

  describe('fallback behavior', () => {
    it('should preserve configured defaultAgent when no rule matches', async () => {
      await registerMockAgent(fred, 'first-agent');
      await registerMockAgent(fred, 'second-agent');

      fred.configureRouting({
        defaultAgent: 'non-existent-agent',
        rules: [],
      });

      const decision = await fred.testRoute('any message');
      expect(decision).not.toBeNull();
      expect(decision?.agent).toBe('non-existent-agent');
      expect(decision?.fallback).toBe(true);
    });

    it('should still return configured defaultAgent when no agents are available', async () => {
      fred.configureRouting({
        defaultAgent: 'non-existent',
        rules: [],
      });

      const decision = await fred.testRoute('any message');
      expect(decision).not.toBeNull();
      expect(decision?.agent).toBe('non-existent');
      expect(decision?.fallback).toBe(true);
    });
  });

  describe('routing hooks', () => {
    it('should allow registering routing hooks on Fred', () => {
      let beforeCalled = false;
      let afterCalled = false;

      fred.registerHook('beforeRouting', () => {
        beforeCalled = true;
      });

      fred.registerHook('afterRouting', () => {
        afterCalled = true;
      });

      expect(beforeCalled).toBe(false);
      expect(afterCalled).toBe(false);
    });
  });

  describe('specificity', () => {
    it('should route to most specific rule', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'keyword-agent');
      await registerMockAgent(fred, 'regex-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'keyword-rule', agent: 'keyword-agent', keywords: ['help'] },
          { id: 'regex-rule', agent: 'regex-agent', patterns: ['help me'] },
        ],
      });

      const decision = await fred.testRoute('help me please');
      expect(decision?.agent).toBe('regex-agent');
    });

    it('should respect explicit priority', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'low-priority-agent');
      await registerMockAgent(fred, 'high-priority-agent');

      fred.configureRouting({
        defaultAgent: 'default-agent',
        rules: [
          { id: 'low', agent: 'low-priority-agent', keywords: ['test'], priority: 10 },
          { id: 'high', agent: 'high-priority-agent', keywords: ['test'], priority: 100 },
        ],
      });

      const decision = await fred.testRoute('test message');
      expect(decision?.agent).toBe('high-priority-agent');
    });
  });

});
