import { beforeEach, describe, expect, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { IntentMatcherService, IntentMatcherServiceLive, IntentRouterService, IntentRouterServiceLive } from '../../../../packages/core/src/intent/service';
import type { Intent, IntentMatch } from '../../../../packages/core/src/intent/intent';
import { AgentService } from '../../../../packages/core/src/agent/service';
import type { AgentInstance } from '../../../../packages/core/src/agent/agent';
import { createMockAgent, createMockAgentWithError } from '../../helpers/mock-agent';

const createIntent = (
  id: string,
  utterances: string[],
  action: Intent['action'] = { type: 'agent', target: `${id}-agent` }
): Intent => ({
  id,
  utterances,
  action,
});

const createIntentMatch = (intent: Intent): IntentMatch => ({
  intent,
  confidence: 1,
  matchType: 'exact',
  matchedUtterance: intent.utterances[0],
});

describe('Intent services', () => {
  let mockAgents: Map<string, AgentInstance>;

  const createMockAgentService = (): typeof AgentService.Service => ({
    createAgent: () => Effect.fail({ _tag: 'AgentCreationError' as const } as any),
    getAgent: (id: string) => {
      const agent = mockAgents.get(id);
      return agent
        ? Effect.succeed(agent)
        : Effect.fail({ _tag: 'AgentNotFoundError' as const, id } as any);
    },
    getAgentOptional: (id: string) => Effect.succeed(mockAgents.get(id)),
    hasAgent: (id: string) => Effect.succeed(mockAgents.has(id)),
    removeAgent: () => Effect.succeed(true),
    getAllAgents: () => Effect.succeed(Array.from(mockAgents.values())),
    clear: () => Effect.void,
    setTracer: () => Effect.void,
    setDefaultSystemMessage: () => Effect.void,
    setGlobalVariablesResolver: () => Effect.void,
    matchAgentByUtterance: () => Effect.succeed(null),
    getMCPMetrics: () => Effect.succeed({}),
    registerShutdownHooks: () => Effect.void,
  });

  const runWithMatcherService = <A, E>(
    effect: Effect.Effect<A, E, IntentMatcherService>
  ) => Effect.runPromise(effect.pipe(Effect.provide(IntentMatcherServiceLive)));

  const runWithRouterService = <A, E>(
    effect: Effect.Effect<A, E, IntentRouterService>
  ) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provide(IntentRouterServiceLive),
        Effect.provide(Layer.succeed(AgentService, createMockAgentService()))
      )
    );

  beforeEach(() => {
    mockAgents = new Map();
  });

  describe('IntentMatcherServiceLive', () => {
    test('registers intents and clears state through service methods', async () => {
      const intents = [
        createIntent('greeting', ['hello']),
        createIntent('weather', ['weather in (.+)'])
      ];

      const result = await runWithMatcherService(
        Effect.gen(function* () {
          const service = yield* IntentMatcherService;
          yield* service.registerIntents(intents);
          const afterRegister = yield* service.getIntents();
          yield* service.clear();
          const afterClear = yield* service.getIntents();
          return { afterRegister, afterClear };
        })
      );

      expect(result.afterRegister).toEqual(intents);
      expect(result.afterClear).toEqual([]);
    });

    test('applies exact -> regex -> semantic priority deterministically', async () => {
      const exactIntent = createIntent('exact', ['hello']);
      const regexIntent = createIntent('regex', ['^hello$']);
      const semanticIntent = createIntent('semantic', ['greeting']);

      const match = await runWithMatcherService(
        Effect.gen(function* () {
          const service = yield* IntentMatcherService;
          yield* service.registerIntents([exactIntent, regexIntent, semanticIntent]);
          return yield* service.matchIntent('hello', async (_message, utterances) => ({
            matched: utterances.includes('greeting'),
            confidence: 0.99,
            utterance: 'greeting',
          }));
        })
      );

      expect(match?.intent.id).toBe('exact');
      expect(match?.matchType).toBe('exact');
      const candidateTypes = match?.allCandidates?.map((candidate) => candidate.matchType) ?? [];
      expect(candidateTypes[0]).toBe('exact');
      expect(candidateTypes).toContain('regex');
      expect(candidateTypes[candidateTypes.length - 1]).toBe('semantic');
    });

    test('uses first-match-wins policy for ambiguous equal-priority matches', async () => {
      const first = createIntent('first', ['hello']);
      const second = createIntent('second', ['hello']);

      const results = await runWithMatcherService(
        Effect.gen(function* () {
          const service = yield* IntentMatcherService;
          yield* service.registerIntents([first, second]);
          return yield* Effect.all(
            Array.from({ length: 8 }, () => service.matchIntent('hello'))
          );
        })
      );

      expect(results.every((match) => match?.intent.id === 'first')).toBe(true);
    });
  });

  describe('IntentRouterServiceLive', () => {
    test('routes to default agent when configured', async () => {
      mockAgents.set('default-agent', createMockAgent('default-agent'));

      const response = await runWithRouterService(
        Effect.gen(function* () {
          const service = yield* IntentRouterService;
          yield* service.setDefaultAgent('default-agent');
          return yield* service.routeToDefaultAgent('hello there');
        })
      );

      expect(response.content).toContain('hello there');
    });

    test('fails with ActionHandlerNotFoundError when action handler is missing', async () => {
      const missingHandlerIntent = createIntent('missing-handler', ['ping'], {
        type: 'unknown' as any,
        target: 'irrelevant',
      });

      const result = await runWithRouterService(
        Effect.gen(function* () {
          const service = yield* IntentRouterService;
          return yield* service.routeIntent(createIntentMatch(missingHandlerIntent), 'ping').pipe(Effect.either);
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('ActionHandlerNotFoundError');
        if (result.left._tag === 'ActionHandlerNotFoundError') {
          expect(result.left.actionType).toBe('unknown');
          expect(result.left.message).toContain('No handler registered');
        }
      }
    });

    test('fails with DefaultAgentNotConfiguredError when default agent is unset', async () => {
      const result = await runWithRouterService(
        Effect.gen(function* () {
          const service = yield* IntentRouterService;
          return yield* service.routeToDefaultAgent('hello').pipe(Effect.either);
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('DefaultAgentNotConfiguredError');
        if (result.left._tag === 'DefaultAgentNotConfiguredError') {
          expect(result.left.message).toContain('No default agent configured');
        }
      }
    });

    test('fails with IntentRouteError when target agent is missing', async () => {
      const missingAgentIntent = createIntent('missing-agent', ['hello'], {
        type: 'agent',
        target: 'does-not-exist',
      });

      const result = await runWithRouterService(
        Effect.gen(function* () {
          const service = yield* IntentRouterService;
          return yield* service.routeIntent(createIntentMatch(missingAgentIntent), 'hello').pipe(Effect.either);
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('IntentRouteError');
        if (result.left._tag === 'IntentRouteError') {
          expect(result.left.message).toContain('Failed to route intent');
          expect((result.left.cause as Error).message).toContain('Agent not found: does-not-exist');
        }
      }
    });

    test('preserves runtime cause in IntentRouteError for default-agent execution failures', async () => {
      mockAgents.set('default-agent', createMockAgentWithError('default-agent', new Error('agent boom')));

      const result = await runWithRouterService(
        Effect.gen(function* () {
          const service = yield* IntentRouterService;
          yield* service.setDefaultAgent('default-agent');
          return yield* service.routeToDefaultAgent('hello').pipe(Effect.either);
        })
      );

      expect(result._tag).toBe('Left');
      if (result._tag === 'Left') {
        expect(result.left._tag).toBe('IntentRouteError');
        if (result.left._tag === 'IntentRouteError') {
          expect(result.left.intentId).toBe('default');
          expect(result.left.message).toContain('Failed to route intent');
          expect((result.left.cause as Error).message).toBe('agent boom');
        }
      }
    });
  });
});
