import { describe, test, expect } from 'bun:test';
import { Effect, Layer } from 'effect';
import {
  MessageRouterService,
  MessageRouterServiceLiveWithConfig,
} from '../../../../packages/core/src/routing/service';
import type { RoutingConfig } from '../../../../packages/core/src/routing/types';

function serviceLayer(config: RoutingConfig): Layer.Layer<MessageRouterService> {
  return MessageRouterServiceLiveWithConfig(config);
}

describe('MessageRouterService (layer contracts)', () => {
  test('keeps deterministic first-match-wins under equal specificity', async () => {
    const config: RoutingConfig = {
      defaultAgent: 'fallback',
      rules: [
        { id: 'rule-first', agent: 'agent-first', keywords: ['status'] },
        { id: 'rule-second', agent: 'agent-second', keywords: ['status'] },
      ],
    };

    const decisions = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MessageRouterService;
        return yield* Effect.all(
          Array.from({ length: 5 }, () => service.route('status update'))
        );
      }).pipe(
        Effect.provide(serviceLayer(config))
      )
    );

    for (const decision of decisions) {
      expect(decision.agent).toBe('agent-first');
      expect(decision.rule?.id).toBe('rule-first');
      expect(decision.fallback).toBe(false);
    }
  });

  test('prefers metadata+pattern matches over pattern-only matches', async () => {
    const config: RoutingConfig = {
      defaultAgent: 'fallback',
      rules: [
        {
          id: 'pattern-only',
          agent: 'agent-pattern',
          patterns: ['invoice'],
        },
        {
          id: 'meta-plus-pattern',
          agent: 'agent-meta-pattern',
          metadata: { tier: 'enterprise' },
          patterns: ['invoice'],
        },
      ],
    };

    const decision = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MessageRouterService;
        return yield* service.route('show invoice summary', { tier: 'enterprise' });
      }).pipe(
        Effect.provide(serviceLayer(config))
      )
    );

    expect(decision.agent).toBe('agent-meta-pattern');
    expect(decision.rule?.id).toBe('meta-plus-pattern');
    expect(decision.fallback).toBe(false);
  });

  test('uses fallback cascade when no rules match', async () => {
    const withDefault: RoutingConfig = {
      defaultAgent: 'default-agent',
      rules: [{ id: 'only-rule', agent: 'specialist', keywords: ['specialist'] }],
    };

    const decisionWithDefault = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MessageRouterService;
        return yield* service.route('no configured pattern here');
      }).pipe(
        Effect.provide(serviceLayer(withDefault))
      )
    );

    expect(decisionWithDefault.fallback).toBe(true);
    expect(decisionWithDefault.agent).toBe('default-agent');

    const noDefault: RoutingConfig = {
      defaultAgent: '',
      rules: [],
    };

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const service = yield* MessageRouterService;
        return yield* service.route('still no match');
      }).pipe(
        Effect.provide(serviceLayer(noDefault))
      )
    );

    expect(exit._tag).toBe('Failure');
  });

  test('returns stable explanations for route and testRoute', async () => {
    const config: RoutingConfig = {
      defaultAgent: 'fallback',
      rules: [
        { id: 'exact', agent: 'agent-exact', patterns: ['^route me$'] },
        { id: 'regex', agent: 'agent-regex', patterns: ['route'] },
      ],
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const service = yield* MessageRouterService;
        const decision = yield* service.route('route me');
        const dryRun = yield* service.testRoute('route me');
        return { decision, dryRun };
      }).pipe(
        Effect.provide(serviceLayer(config))
      )
    );

    expect(result.decision.explanation?.winner.targetId).toBe('agent-exact');
    expect(result.decision.explanation?.narrative).toContain('agent-exact');
    expect(result.decision.explanation?.alternatives.length).toBeGreaterThanOrEqual(0);
    expect(result.dryRun.explanation?.winner.targetId).toBe(result.decision.explanation?.winner.targetId);
    expect(result.dryRun.matchType).toBe(result.decision.matchType);
  });
});
