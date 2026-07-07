/**
 * Effect services for Intent matching and routing
 */

import { Context, Effect, Layer, Ref } from 'effect';
import type { Action, Intent, IntentMatch } from './intent';
import type { AgentResponse, AgentMessage } from '../agent/agent';
import { AgentService } from '../agent/service';
import type { IntentMatchError, ActionHandlerNotFoundError, DefaultAgentNotConfiguredError, IntentRouteError } from './errors';
import {
  ActionHandlerNotFoundError as ActionHandlerNotFoundErrorType,
  DefaultAgentNotConfiguredError as DefaultAgentNotConfiguredErrorType,
  IntentMatchError as IntentMatchErrorType,
  IntentRouteError as IntentRouteErrorType,
  getActionHandlerNotFoundMessage,
  getDefaultAgentNotConfiguredMessage,
  getIntentRouteErrorMessage,
} from './errors';

/**
 * Semantic matcher function type
 */
export type SemanticMatcherFn = (
  message: string,
  utterances: string[]
) => Promise<{ matched: boolean; confidence: number; utterance?: string }>;

/**
 * IntentMatcherService interface
 */
export interface IntentMatcherService {
  matchIntent(
    message: string,
    semanticMatcher?: SemanticMatcherFn
  ): Effect.Effect<IntentMatch | null, IntentMatchError>;

  registerIntents(intents: Intent[]): Effect.Effect<void>;

  getIntents(): Effect.Effect<Intent[]>;

  clear(): Effect.Effect<void>;
}

export const IntentMatcherService = Context.GenericTag<IntentMatcherService>(
  'IntentMatcherService'
);

/**
 * IntentMatcherService implementation using IntentMatcher
 */
class IntentMatcherServiceImpl implements IntentMatcherService {
  constructor(private intents: Ref.Ref<Intent[]>) {}

  matchIntent(
    message: string,
    semanticMatcher?: SemanticMatcherFn
  ): Effect.Effect<IntentMatch | null, IntentMatchError> {
    const self = this;

    return Effect.gen(function* () {
      const intents = yield* Ref.get(self.intents);
      const normalizedMessage = message.toLowerCase().trim();

      let candidateIndex = 0;
      const allCandidates: Array<{
        intentId: string;
        intentName: string;
        confidence: number;
        matchType: 'exact' | 'regex' | 'semantic';
        matchedUtterance?: string;
        order: number;
      }> = [];

      for (const intent of intents) {
        for (const utterance of intent.utterances) {
          if (normalizedMessage === utterance.toLowerCase().trim()) {
            allCandidates.push({
              intentId: intent.id,
              intentName: intent.description || intent.id,
              confidence: 1,
              matchType: 'exact',
              matchedUtterance: utterance,
              order: candidateIndex,
            });
          }
          candidateIndex += 1;
        }
      }

      for (const intent of intents) {
        for (const utterance of intent.utterances) {
          const regexMatch = yield* Effect.sync(() => {
            try {
              const regex = new RegExp(utterance, 'i');
              return regex.test(message);
            } catch {
              return false;
            }
          });

          if (regexMatch) {
            allCandidates.push({
              intentId: intent.id,
              intentName: intent.description || intent.id,
              confidence: 0.8,
              matchType: 'regex',
              matchedUtterance: utterance,
              order: candidateIndex,
            });
          }
          candidateIndex += 1;
        }
      }

      if (semanticMatcher) {
        for (const intent of intents) {
          const result = yield* Effect.tryPromise({
            try: () => semanticMatcher(message, intent.utterances),
            catch: (cause) =>
              new IntentMatchErrorType({
                message: 'Semantic matching failed',
                cause: cause instanceof Error ? cause : new Error(String(cause)),
              }),
          });

          if (result.matched) {
            allCandidates.push({
              intentId: intent.id,
              intentName: intent.description || intent.id,
              confidence: result.confidence,
              matchType: 'semantic',
              matchedUtterance: result.utterance,
              order: candidateIndex,
            });
          }
          candidateIndex += 1;
        }
      }

      if (allCandidates.length === 0) {
        return null;
      }

      const matchTypePriority = {
        exact: 3,
        regex: 2,
        semantic: 1,
      } as const;

      allCandidates.sort((a, b) => {
        const priorityDiff = matchTypePriority[b.matchType] - matchTypePriority[a.matchType];
        if (priorityDiff !== 0) {
          return priorityDiff;
        }

        const confidenceDiff = b.confidence - a.confidence;
        if (confidenceDiff !== 0) {
          return confidenceDiff;
        }

        return a.order - b.order;
      });

      const best = allCandidates[0];
      const bestIntent = intents.find((intent) => intent.id === best.intentId);

      if (!bestIntent) {
        return null;
      }

      return {
        intent: bestIntent,
        confidence: best.confidence,
        matchType: best.matchType,
        matchedUtterance: best.matchedUtterance,
        allCandidates: allCandidates.map(({ matchedUtterance, order, ...candidate }) => candidate),
      };
    });
  }

  registerIntents(intents: Intent[]): Effect.Effect<void> {
    // Upsert by id so repeated registrations are idempotent and additive.
    return Ref.update(this.intents, (existing) => {
      const merged = new Map(existing.map((intent) => [intent.id, intent]));
      for (const intent of intents) {
        merged.set(intent.id, intent);
      }
      return Array.from(merged.values());
    });
  }

  getIntents(): Effect.Effect<Intent[]> {
    return Ref.get(this.intents);
  }

  clear(): Effect.Effect<void> {
    return Ref.set(this.intents, []);
  }
}

/**
 * Live layer for IntentMatcherService
 */
export const IntentMatcherServiceLive = Layer.effect(
  IntentMatcherService,
  Effect.gen(function* () {
    const intentsRef = yield* Ref.make<Intent[]>([]);
    return new IntentMatcherServiceImpl(intentsRef);
  })
);

/**
 * IntentRouterService interface
 */
export interface IntentRouterService {
  routeIntent(
    match: IntentMatch,
    userMessage: string
  ): Effect.Effect<AgentResponse, ActionHandlerNotFoundError | IntentRouteError>;

  routeToDefaultAgent(
    userMessage: string,
    previousMessages?: AgentMessage[]
  ): Effect.Effect<AgentResponse, DefaultAgentNotConfiguredError | IntentRouteError>;

  setDefaultAgent(agentId: string): Effect.Effect<void>;
}

export const IntentRouterService = Context.GenericTag<IntentRouterService>(
  'IntentRouterService'
);

/**
 * IntentRouterService implementation using IntentRouter
 */
type ActionHandler = (action: Action, payload: Record<string, unknown>) => Effect.Effect<AgentResponse, IntentRouteError>;

class IntentRouterServiceImpl implements IntentRouterService {
  constructor(
    private actionHandlers: Ref.Ref<Map<string, ActionHandler>>,
    private defaultAgentId: Ref.Ref<string | undefined>,
    private agentService: typeof AgentService.Service
  ) {}

  routeIntent(
    match: IntentMatch,
    userMessage: string
  ): Effect.Effect<AgentResponse, ActionHandlerNotFoundError | IntentRouteError> {
    const self = this;

    return Effect.gen(function* () {
      const handlers = yield* Ref.get(self.actionHandlers);
      const handler = handlers.get(match.intent.action.type);

      if (!handler) {
        return yield* Effect.fail(
          new ActionHandlerNotFoundErrorType({
            actionType: match.intent.action.type,
            message: getActionHandlerNotFoundMessage(match.intent.action.type),
          })
        );
      }

      return yield* handler(match.intent.action, {
        userMessage,
        match,
        ...(match.intent.action.payload ?? {}),
      });
    });
  }

  routeToDefaultAgent(
    userMessage: string,
    previousMessages?: AgentMessage[]
  ): Effect.Effect<AgentResponse, DefaultAgentNotConfiguredError | IntentRouteError> {
    const self = this;

    return Effect.gen(function* () {
      const defaultAgentId = yield* Ref.get(self.defaultAgentId);

      if (!defaultAgentId) {
        return yield* Effect.fail(
          new DefaultAgentNotConfiguredErrorType({
            message: getDefaultAgentNotConfiguredMessage(),
          })
        );
      }

      return yield* self.executeAgentRoute(defaultAgentId, userMessage, previousMessages ?? [], 'default');
    });
  }

  setDefaultAgent(agentId: string): Effect.Effect<void> {
    return Ref.set(this.defaultAgentId, agentId);
  }

  registerActionHandler(type: string, handler: ActionHandler): Effect.Effect<void> {
    const self = this;

    return Effect.gen(function* () {
      const handlers = yield* Ref.get(self.actionHandlers);
      const updated = new Map(handlers);
      updated.set(type, handler);
      yield* Ref.set(self.actionHandlers, updated);
    });
  }

  initializeDefaultHandlers(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* self.registerActionHandler('agent', (action, payload) =>
        self.handleAgentAction(action, payload)
      );
      yield* self.registerActionHandler('function', (action, payload) =>
        self.handleFunctionAction(action, payload)
      );
    });
  }

  private handleAgentAction(action: Action, payload: Record<string, unknown>): Effect.Effect<AgentResponse, IntentRouteError> {
    const userMessage = typeof payload.userMessage === 'string' ? payload.userMessage : '';
    const messages = Array.isArray(payload.previousMessages) ? (payload.previousMessages as AgentMessage[]) : [];
    const match = payload.match as IntentMatch | undefined;
    return this.executeAgentRoute(action.target, userMessage, messages, match?.intent.id ?? 'unknown');
  }

  private handleFunctionAction(action: Action, payload: Record<string, unknown>): Effect.Effect<AgentResponse, IntentRouteError> {
    const match = payload.match as IntentMatch | undefined;

    return Effect.fail(
      new IntentRouteErrorType({
        intentId: match?.intent.id ?? 'unknown',
        message: getIntentRouteErrorMessage(match?.intent.id ?? 'unknown'),
        cause: new Error(`Function action handler not implemented. Function: ${action.target}`),
      })
    );
  }

  private executeAgentRoute(
    agentId: string,
    userMessage: string,
    previousMessages: AgentMessage[],
    intentId: string
  ): Effect.Effect<AgentResponse, IntentRouteError> {
    const self = this;

    return Effect.gen(function* () {
      const agent = yield* self.agentService.getAgentOptional(agentId);

      if (!agent) {
        return yield* Effect.fail(
          new IntentRouteErrorType({
            intentId,
            message: getIntentRouteErrorMessage(intentId),
            cause: new Error(`Agent not found: ${agentId}`),
          })
        );
      }

      return yield* Effect.tryPromise({
        try: () => agent.processMessage(userMessage, previousMessages),
        catch: (cause) =>
          new IntentRouteErrorType({
            intentId,
            message: getIntentRouteErrorMessage(intentId),
            cause: cause instanceof Error ? cause : new Error(String(cause)),
          }),
      });
    });
  }
}

/**
 * Live layer for IntentRouterService
 * Depends on AgentService
 */
export const IntentRouterServiceLive = Layer.effect(
  IntentRouterService,
  Effect.gen(function* () {
    const actionHandlers = yield* Ref.make(new Map<string, ActionHandler>());
    const defaultAgentId = yield* Ref.make<string | undefined>(undefined);
    const agentService = yield* AgentService;
    const service = new IntentRouterServiceImpl(actionHandlers, defaultAgentId, agentService);

    yield* service.initializeDefaultHandlers();

    return service;
  })
);
