/**
 * Effect service for MessageRouter
 *
 * This service owns routing logic directly and does not delegate to the
 * imperative MessageRouter class.
 */

import { Context, Effect, Layer, Option, Ref } from 'effect';
import {
  type RoutingDecision,
  type RoutingConfig,
  type RoutingRule,
  type RouteMatch,
  type MatchType,
  type RoutingAlternative,
  type CalibrationMetadata,
} from './types';
import { NoAgentsAvailableError } from './errors';
import { generateRoutingExplanation } from './explainer';

/**
 * MessageRouterService interface
 */
export interface MessageRouterService {
  route(
    message: string,
    metadata?: Record<string, unknown>
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError>;

  testRoute(
    message: string,
    metadata?: Record<string, unknown>
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError>;

  /**
   * Replace the active routing configuration on the live runtime.
   *
   * Routing config is mutable at the service level so changing it never
   * requires rebuilding the Effect runtime.
   */
  setConfig(config: RoutingConfig): Effect.Effect<void>;
}

export const MessageRouterService = Context.GenericTag<MessageRouterService>(
  'MessageRouterService'
);

/**
 * Config tag for MessageRouterService layer construction.
 */
export const MessageRouterConfig = Context.GenericTag<RoutingConfig>(
  'MessageRouterConfig'
);

const MATCH_TYPE_SCORES: Record<MatchType, number> = {
  exact: 1000,
  regex: 800,
  keyword: 700,
  function: 600,
  'metadata-only': 500,
};

type RouteMatchWithOrder = RouteMatch & { order: number };

class StandaloneRoutingServiceImpl {
  constructor(private readonly config: RoutingConfig) {}

  route(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError> {
    const self = this;

    return Effect.gen(function* () {
      const { best, allMatches } = yield* self.findBestMatch(message, metadata);
      const decision = yield* self.makeDecision(best, allMatches, true);

      if (self.config.debug) {
        yield* Effect.logDebug('Routing decision').pipe(
          Effect.annotateLogs({
            agent: decision.agent,
            fallback: decision.fallback,
            matchType: decision.matchType,
            ruleId: decision.rule?.id,
            specificity: decision.specificity,
          })
        );
      }

      return decision;
    });
  }

  testRoute(
    message: string,
    metadata: Record<string, unknown> = {}
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError> {
    const self = this;

    return Effect.gen(function* () {
      const { best, allMatches } = yield* self.findBestMatch(message, metadata);
      return yield* self.makeDecision(best, allMatches, false);
    });
  }

  private makeDecision(
    best: RouteMatchWithOrder | null,
    allMatches: RouteMatchWithOrder[],
    includeClarification: boolean
  ): Effect.Effect<RoutingDecision, NoAgentsAvailableError> {
    const self = this;

    return Effect.gen(function* () {
      if (best) {
        const alternatives: RoutingAlternative[] = allMatches.map((match) => ({
          targetId: match.rule.agent,
          targetName: match.rule.agent,
          confidence: match.confidence,
          matchType: match.matchType,
        }));

        const calibrationMetadata: CalibrationMetadata = {
          rawScore: best.confidence,
          calibratedScore: best.confidence,
          calibrated: false,
        };

        const winner: RoutingAlternative = {
          targetId: best.rule.agent,
          targetName: best.rule.agent,
          confidence: best.confidence,
          matchType: best.matchType,
        };

        const explanation = generateRoutingExplanation(
          winner,
          alternatives,
          calibrationMetadata,
          best.matchType
        );

        let clarificationNeeded: import('../pipeline/pause/types').PauseSignal | undefined;
        if (includeClarification) {
          const topAlternative = explanation.alternatives[0];
          const hasCloseAlternative =
            topAlternative !== undefined &&
            best.confidence - topAlternative.confidence < 0.1;

          if (best.confidence < 0.6 || hasCloseAlternative) {
            const reason =
              best.confidence < 0.6
                ? `Low confidence (${(best.confidence * 100).toFixed(1)}%)`
                : `Close alternatives (gap: ${((best.confidence - topAlternative!.confidence) * 100).toFixed(1)}%)`;

            clarificationNeeded = {
              __pause: true,
              prompt: `Routing confidence is low. ${reason}. Please clarify your intent.\n\nSelected: ${best.rule.agent}\nAlternatives: ${explanation.alternatives.map((alt) => `${alt.targetName} (${(alt.confidence * 100).toFixed(1)}%)`).join(', ')}`,
              resumeBehavior: 'continue',
            };
          }
        }

        return {
          agent: best.rule.agent,
          rule: best.rule,
          matchType: best.matchType,
          fallback: false,
          specificity: best.specificity,
          explanation,
          clarificationNeeded,
        };
      }

      const fallbackAgent = yield* self.resolveFallbackAgent();

      const winner: RoutingAlternative = {
        targetId: fallbackAgent,
        targetName: fallbackAgent,
        confidence: 0.5,
      };

      const calibrationMetadata: CalibrationMetadata = {
        rawScore: 0.5,
        calibratedScore: 0.5,
        calibrated: false,
      };

      const explanation = generateRoutingExplanation(
        winner,
        [],
        calibrationMetadata,
        'metadata-only'
      );

      return {
        agent: fallbackAgent,
        fallback: true,
        explanation,
      };
    });
  }

  private resolveFallbackAgent(): Effect.Effect<string, NoAgentsAvailableError> {
    const configuredDefault = this.config.defaultAgent?.trim();
    if (configuredDefault) {
      return Effect.succeed(configuredDefault);
    }

    const configuredFallback = this.config.fallbackAgents?.find(
      (agent) => agent.trim().length > 0
    );
    if (configuredFallback) {
      return Effect.succeed(configuredFallback);
    }

    const firstRuleAgent = this.config.rules.find(
      (rule) => rule.agent.trim().length > 0
    )?.agent;
    if (firstRuleAgent) {
      return Effect.succeed(firstRuleAgent);
    }

    return Effect.fail(
      new NoAgentsAvailableError({
        message: 'No agents available for routing. Register at least one agent.',
      })
    );
  }

  private findBestMatch(
    message: string,
    metadata: Record<string, unknown>
  ): Effect.Effect<{ best: RouteMatchWithOrder | null; allMatches: RouteMatchWithOrder[] }> {
    const self = this;

    return Effect.gen(function* () {
      const matches: RouteMatchWithOrder[] = [];

      const sortedRules = [...self.config.rules]
        .map((rule, index) => ({ rule, index }))
        .sort((a, b) => {
          const priorityDiff = (b.rule.priority ?? 0) - (a.rule.priority ?? 0);
          if (priorityDiff !== 0) {
            return priorityDiff;
          }
          return a.index - b.index;
        });

      for (let index = 0; index < sortedRules.length; index++) {
        const matched = yield* self.matchRule(message, metadata, sortedRules[index].rule);
        if (matched) {
          matches.push({ ...matched, order: index });
        }
      }

      if (matches.length === 0) {
        return { best: null, allMatches: [] };
      }

      matches.sort((a, b) => {
        const specificityDiff = b.specificity - a.specificity;
        if (specificityDiff !== 0) {
          return specificityDiff;
        }
        return a.order - b.order;
      });

      return {
        best: matches[0],
        allMatches: matches,
      };
    });
  }

  private matchRule(
    message: string,
    metadata: Record<string, unknown>,
    rule: RoutingRule
  ): Effect.Effect<RouteMatch | null> {
    const self = this;

    return Effect.gen(function* () {
      if (rule.metadata && !self.matchMetadata(metadata, rule.metadata)) {
        return null;
      }

      if (rule.matcher) {
        const matcherResult = yield* Effect.tryPromise({
          try: () => Promise.resolve(rule.matcher!(message, metadata)),
          catch: () => null,
        }).pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (matcherResult === true) {
          return {
            rule,
            matchType: 'function',
            confidence: 0.8,
            specificity: self.calculateSpecificity(rule, 'function'),
          };
        }
        if (matcherResult === false || matcherResult === null) {
          return null;
        }
      }

      if (rule.patterns && rule.patterns.length > 0) {
        for (const pattern of rule.patterns) {
          const patternMatch = yield* Effect.try({
            try: () => {
              const regex = new RegExp(pattern, 'i');
              if (!regex.test(message)) {
                return null;
              }

              const isExact = pattern.startsWith('^') && pattern.endsWith('$');
              const matchType: MatchType = isExact ? 'exact' : 'regex';

              return {
                rule,
                matchType,
                confidence: isExact ? 1.0 : 0.8,
                specificity: self.calculateSpecificity(rule, matchType, pattern),
                matchedPattern: pattern,
              } satisfies RouteMatch;
            },
            catch: () => null,
          }).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (patternMatch) {
            return patternMatch;
          }
        }
      }

      if (rule.keywords && rule.keywords.length > 0) {
        for (const keyword of rule.keywords) {
          if (self.matchKeyword(message, keyword)) {
            return {
              rule,
              matchType: 'keyword',
              confidence: 0.7,
              specificity: self.calculateSpecificity(rule, 'keyword', keyword),
              matchedPattern: keyword,
            };
          }
        }
      }

      if (
        rule.metadata &&
        Object.keys(rule.metadata).length > 0 &&
        !rule.patterns &&
        !rule.keywords &&
        !rule.matcher
      ) {
        return {
          rule,
          matchType: 'metadata-only',
          confidence: 0.6,
          specificity: self.calculateSpecificity(rule, 'metadata-only'),
        };
      }

      return null;
    });
  }

  private calculateSpecificity(
    rule: RoutingRule,
    matchType: MatchType,
    matchedPattern?: string
  ): number {
    let score = MATCH_TYPE_SCORES[matchType];

    if (matchedPattern) {
      score += matchedPattern.length;
    }

    if (rule.metadata) {
      score += Object.keys(rule.metadata).length * 100;
    }

    if (rule.priority !== undefined) {
      score += rule.priority;
    }

    return score;
  }

  private matchKeyword(message: string, keyword: string): boolean {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(message);
  }

  private matchMetadata(
    provided: Record<string, unknown>,
    required: Record<string, unknown>
  ): boolean {
    for (const [key, value] of Object.entries(required)) {
      if (provided[key] !== value) {
        return false;
      }
    }
    return true;
  }
}

export const MessageRouterServiceLive = Layer.effect(
  MessageRouterService,
  Effect.gen(function* () {
    const initialConfig = yield* Effect.serviceOption(MessageRouterConfig);
    const routerRef = yield* Ref.make<Option.Option<StandaloneRoutingServiceImpl>>(
      Option.map(initialConfig, (config) => new StandaloneRoutingServiceImpl(config))
    );

    const withRouter = <A>(
      run: (router: StandaloneRoutingServiceImpl) => Effect.Effect<A, NoAgentsAvailableError>
    ): Effect.Effect<A, NoAgentsAvailableError> =>
      Ref.get(routerRef).pipe(
        Effect.flatMap(
          Option.match({
            onNone: () =>
              Effect.fail(new NoAgentsAvailableError({ message: 'No routing rules configured' })),
            onSome: run,
          })
        )
      );

    const service: MessageRouterService = {
      route: (message, metadata) => withRouter((router) => router.route(message, metadata)),
      testRoute: (message, metadata) => withRouter((router) => router.testRoute(message, metadata)),
      setConfig: (config) =>
        Ref.set(routerRef, Option.some(new StandaloneRoutingServiceImpl(config))),
    };

    return service;
  })
);

export const MessageRouterServiceLiveWithConfig = (config: RoutingConfig) =>
  MessageRouterServiceLive.pipe(
    Layer.provide(Layer.succeed(MessageRouterConfig, config))
  );
