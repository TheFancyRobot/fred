/**
 * Scoped-client routing integration tests
 *
 * Tests Effect-native routing configuration and decisions through one client runtime.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { Effect, Option } from 'effect';
import { createFred, type FredClient } from '../../../../packages/core/src/index';
import { MessageRouterService, ProviderRegistryService } from '../../../../packages/core/src/services';
import type { RoutingConfig } from '../../../../packages/core/src/routing/types';
import { createMockProvider } from '../../helpers/mock-provider';

async function registerMockAgent(
  fred: FredClient,
  agentId: string,
  options?: { persistHistory?: boolean; response?: string }
): Promise<void> {
  const agent = await fred.agents.register({
    id: agentId,
    platform: 'mock',
    model: 'mock-model',
    systemMessage: 'Mock agent',
    persistHistory: options?.persistHistory,
  } as any);

  agent.processMessage = () => Effect.succeed({ content: options?.response ?? 'Mock response' });
}

const configureRouting = (
  fred: FredClient,
  config: RoutingConfig,
): Promise<void> => fred.effects.run(
  Effect.flatMap(MessageRouterService, (router) => router.setConfig(config)),
);

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

describe('Scoped-client routing integration', () => {
  let fred: FredClient;

  beforeEach(async () => {
    fred = await createFred();
    await fred.effects.run(
      Effect.flatMap(ProviderRegistryService, (providers) =>
        providers.registerDefinition({ ...createMockProvider('mock'), aliases: [] })
      ),
    );
  });

  afterEach(async () => {
    await fred.shutdown();
  });

  describe('configureRouting', () => {
    it('should configure routing through the public client paths', async () => {
      await registerMockAgent(fred, 'support-agent');
      await registerMockAgent(fred, 'sales-agent');

      const routingConfig: RoutingConfig = {
        defaultAgent: 'support-agent',
        rules: [
          { id: 'sales-rule', agent: 'sales-agent', keywords: ['pricing', 'buy'] },
        ],
      };

      await configureRouting(fred, routingConfig);

      const decision = await testRoute(fred, 'I want to buy');
      expect(decision?.agent).toBe('sales-agent');
    });
  });

  describe('testRoute', () => {
    it('should return null if routing is not configured', async () => {
      const decision = await testRoute(fred, 'any message');
      expect(decision).toBeNull();
    });

    it('should return routing decision when configured', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'help-agent');

      await configureRouting(fred, {
        defaultAgent: 'default-agent',
        rules: [
          { id: 'help-rule', agent: 'help-agent', keywords: ['help', 'support'] },
        ],
      });

      const helpDecision = await testRoute(fred, 'I need help');
      expect(helpDecision).not.toBeNull();
      expect(helpDecision?.agent).toBe('help-agent');
      expect(helpDecision?.fallback).toBe(false);
      expect(helpDecision?.matchType).toBe('keyword');

      const defaultDecision = await testRoute(fred, 'hello world');
      expect(defaultDecision).not.toBeNull();
      expect(defaultDecision?.agent).toBe('default-agent');
      expect(defaultDecision?.fallback).toBe(true);
    });

    it('should pass metadata to router', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'vip-agent');

      await configureRouting(fred, {
        defaultAgent: 'default-agent',
        rules: [
          { id: 'vip-rule', agent: 'vip-agent', metadata: { tier: 'vip' } },
        ],
      });

      const vipDecision = await testRoute(fred, 'any message', { tier: 'vip' });
      expect(vipDecision).not.toBeNull();
      expect(vipDecision?.agent).toBe('vip-agent');
      expect(vipDecision?.matchType).toBe('metadata-only');

      const regularDecision = await testRoute(fred, 'any message', { tier: 'regular' });
      expect(regularDecision).not.toBeNull();
      expect(regularDecision?.agent).toBe('default-agent');
      expect(regularDecision?.fallback).toBe(true);
    });

    it('should handle regex pattern matching', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'weather-agent');

      await configureRouting(fred, {
        defaultAgent: 'default-agent',
        rules: [
          { id: 'weather-rule', agent: 'weather-agent', patterns: ['^weather', 'forecast'] },
        ],
      });

      const weatherDecision = await testRoute(fred, 'weather in NYC');
      expect(weatherDecision?.agent).toBe('weather-agent');
      expect(weatherDecision?.matchType).toBe('regex');

      const forecastDecision = await testRoute(fred, 'give me the forecast');
      expect(forecastDecision?.agent).toBe('weather-agent');
    });

    it('should handle function matchers', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'long-agent');

      await configureRouting(fred, {
        defaultAgent: 'default-agent',
        rules: [
          {
            id: 'long-message',
            agent: 'long-agent',
            matcher: (msg) => msg.length > 50,
          },
        ],
      });

      const shortDecision = await testRoute(fred, 'hi');
      expect(shortDecision?.agent).toBe('default-agent');

      const longDecision = await testRoute(fred, 'This is a very long message that exceeds fifty characters in length');
      expect(longDecision?.agent).toBe('long-agent');
      expect(longDecision?.matchType).toBe('function');
    });
  });

  describe('fallback behavior', () => {
    it('should preserve configured defaultAgent when no rule matches', async () => {
      await registerMockAgent(fred, 'first-agent');
      await registerMockAgent(fred, 'second-agent');

      await configureRouting(fred, {
        defaultAgent: 'non-existent-agent',
        rules: [],
      });

      const decision = await testRoute(fred, 'any message');
      expect(decision).not.toBeNull();
      expect(decision?.agent).toBe('non-existent-agent');
      expect(decision?.fallback).toBe(true);
    });

    it('should still return configured defaultAgent when no agents are available', async () => {
      await configureRouting(fred, {
        defaultAgent: 'non-existent',
        rules: [],
      });

      const decision = await testRoute(fred, 'any message');
      expect(decision).not.toBeNull();
      expect(decision?.agent).toBe('non-existent');
      expect(decision?.fallback).toBe(true);
    });
  });

  describe('routing hooks', () => {
    it('should allow registering routing hooks on the client', async () => {
      let beforeCalled = false;
      let afterCalled = false;

      await fred.hooks.register('beforeRouting', () => {
        beforeCalled = true;
      });

      await fred.hooks.register('afterRouting', () => {
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

      await configureRouting(fred, {
        defaultAgent: 'default-agent',
        rules: [
          { id: 'keyword-rule', agent: 'keyword-agent', keywords: ['help'] },
          { id: 'regex-rule', agent: 'regex-agent', patterns: ['help me'] },
        ],
      });

      const decision = await testRoute(fred, 'help me please');
      expect(decision?.agent).toBe('regex-agent');
    });

    it('should respect explicit priority', async () => {
      await registerMockAgent(fred, 'default-agent');
      await registerMockAgent(fred, 'low-priority-agent');
      await registerMockAgent(fred, 'high-priority-agent');

      await configureRouting(fred, {
        defaultAgent: 'default-agent',
        rules: [
          { id: 'low', agent: 'low-priority-agent', keywords: ['test'], priority: 10 },
          { id: 'high', agent: 'high-priority-agent', keywords: ['test'], priority: 100 },
        ],
      });

      const decision = await testRoute(fred, 'test message');
      expect(decision?.agent).toBe('high-priority-agent');
    });
  });

});
