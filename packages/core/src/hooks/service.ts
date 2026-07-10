import { Context, Data, Effect, Layer, Ref, Runtime } from 'effect';
import type { HookType, HookEvent, HookResult, HookHandler } from './types';
import { ObservabilityService } from '../observability/service';
import {
  AgentStatusService,
  type AgentRunState,
} from '../observability/status';

/**
 * Error thrown when hook execution encounters catastrophic failure
 */
export class HookExecutionError extends Data.TaggedError("HookExecutionError")<{
  readonly hookType: HookType;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Hook execution outcome for telemetry
 */
type HookOutcome = 'executed' | 'skipped' | 'aborted' | 'modified' | 'error';

const stateForHook = (
  type: HookType,
  event: HookEvent
): AgentRunState | undefined => {
  switch (type) {
    case 'beforeMessageReceived':
    case 'beforeAgentSelected':
    case 'afterAgentSelected':
    case 'beforePipeline':
    case 'beforeStep':
      return 'starting';
    case 'beforeResponseGenerated':
      return 'calling_model';
    case 'afterResponseGenerated':
      return 'streaming';
    case 'beforeToolCalled':
      return 'running_tool';
    case 'afterToolCalled':
      return 'calling_model';
    case 'afterPolicyDecision':
      return typeof event.data === 'object'
          && event.data !== null
          && 'outcome' in event.data
          && event.data.outcome === 'requireApproval'
        ? 'paused'
        : undefined;
    default:
      return undefined;
  }
};

/**
 * HookManagerService interface for Effect-based hook management
 */
export interface HookManagerService {
  /**
   * Register a hook handler for a specific hook type
   */
  registerHook(type: HookType, handler: HookHandler): Effect.Effect<void>;

  /**
   * Unregister a hook handler
   */
  unregisterHook(type: HookType, handler: HookHandler): Effect.Effect<boolean>;

  /**
   * Execute all hooks of a given type
   * Returns results from all handlers, continues even if one fails
   */
  executeHooks(type: HookType, event: HookEvent): Effect.Effect<HookResult[], HookExecutionError>;

  /**
   * Execute hooks and merge results into single context/data object
   */
  executeHooksAndMerge(type: HookType, event: HookEvent): Effect.Effect<{
    context?: Record<string, unknown>;
    data?: unknown;
    skip?: boolean;
    metadata?: Record<string, unknown>;
  }, HookExecutionError>;

  /**
   * Clear all hooks of a specific type
   */
  clearHooks(type: HookType): Effect.Effect<void>;

  /**
   * Clear all hooks
   */
  clearAllHooks(): Effect.Effect<void>;

  /**
   * Get all registered hook types
   */
  getRegisteredHookTypes(): Effect.Effect<HookType[]>;

  /**
   * Get count of handlers for a hook type
   */
  getHookCount(type: HookType): Effect.Effect<number>;
}

export const HookManagerService = Context.GenericTag<HookManagerService>(
  'HookManagerService'
);

/**
 * Implementation of HookManagerService
 */
class HookManagerServiceImpl implements HookManagerService {
  constructor(
    private hooks: Ref.Ref<Map<HookType, HookHandler[]>>,
    private observability?: Context.Tag.Service<typeof ObservabilityService>,
    private agentStatus?: Context.Tag.Service<typeof AgentStatusService>
  ) {}

  registerHook(type: HookType, handler: HookHandler): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      const newHooks = new Map(hooks);
      const handlers = newHooks.get(type) || [];
      newHooks.set(type, [...handlers, handler]);
      yield* Ref.set(self.hooks, newHooks);
    });
  }

  unregisterHook(type: HookType, handler: HookHandler): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      const handlers = hooks.get(type);
      if (!handlers) return false;

      const index = handlers.indexOf(handler);
      if (index === -1) return false;

      const newHooks = new Map(hooks);
      const newHandlers = [...handlers];
      newHandlers.splice(index, 1);
      newHooks.set(type, newHandlers);
      yield* Ref.set(self.hooks, newHooks);
      return true;
    });
  }

  executeHooks(type: HookType, event: HookEvent): Effect.Effect<HookResult[], HookExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      const startTime = Date.now();
      const runtime = yield* Effect.runtime<never>();

      const nextState = stateForHook(type, event);
      if (self.agentStatus && nextState) {
        yield* self.agentStatus.transition(nextState);
      }

      const hooks = yield* Ref.get(self.hooks);
      const handlers = hooks.get(type);
      if (!handlers || handlers.length === 0) return [];

      // Wire exportTrace function into hook correlation context
      if (self.observability && event.runId) {
        const exportTraceFn = async (traceIdOverride?: string) => {
          if (traceIdOverride !== undefined && traceIdOverride !== event.traceId) {
            return undefined;
          }

          return Runtime.runPromise(runtime)(self.observability!.exportTrace(event.runId!));
        };

        event.correlation = {
          runId: event.runId,
          conversationId: event.conversationId,
          intentId: event.intentId,
          agentId: event.agentId,
          timestamp: event.timestamp,
          traceId: event.traceId,
          spanId: event.spanId,
          parentSpanId: event.parentSpanId,
          pipelineId: event.pipelineId,
          stepName: event.stepName,
          exportTrace: exportTraceFn,
        };
      }

      // Log hook execution start
      if (self.observability) {
        yield* self.observability.logStructured({
          level: 'debug',
          message: `Executing hooks: ${type}`,
          metadata: {
            'hook.type': type,
            'hook.handlerCount': handlers.length,
            runId: event.runId,
            conversationId: event.conversationId,
            intentId: event.intentId,
            agentId: event.agentId,
            pipelineId: event.pipelineId,
            stepName: event.stepName,
          },
        });
      }

      const results: HookResult[] = [];
      const outcomes: Record<HookOutcome, number> = {
        executed: 0,
        skipped: 0,
        aborted: 0,
        modified: 0,
        error: 0,
      };

      for (let i = 0; i < handlers.length; i++) {
        const handler = handlers[i];

        // Execute the handler (may return Promise or value) with error catching
        const resultOrPromise = handler(event);
        const handlerEffect = resultOrPromise instanceof Promise
          ? Effect.tryPromise({
              try: () => resultOrPromise,
              catch: (error) => error,
            })
          : Effect.try({
              try: () => resultOrPromise,
              catch: (error) => error,
            });

        const result = yield* handlerEffect.pipe(
          Effect.catchAll((error) => {
            outcomes.error++;
            return self.logHandlerFailure(type, i, error, event).pipe(Effect.as(undefined));
          })
        );

        if (result) {
          results.push(result);

          // Classify outcome
          let outcome: HookOutcome = 'executed';
          if (result.skip) {
            outcome = 'skipped';
          } else if (result.abort) {
            outcome = 'aborted';
          } else if (result.data !== undefined || result.context !== undefined || result.metadata !== undefined) {
            outcome = 'modified';
          }
          outcomes[outcome]++;
        } else {
          outcomes.executed++;
        }
      }

      const endTime = Date.now();
      const durationMs = endTime - startTime;

      // Log hook execution completion
      if (self.observability) {
        yield* self.observability.logStructured({
          level: 'debug',
          message: `Completed hooks: ${type}`,
          metadata: {
            'hook.type': type,
            'hook.durationMs': durationMs,
            'hook.resultsCount': results.length,
            'hook.outcomes': outcomes,
            runId: event.runId,
            conversationId: event.conversationId,
            intentId: event.intentId,
            agentId: event.agentId,
            pipelineId: event.pipelineId,
            stepName: event.stepName,
          },
        });

        // Record hook event metric
        yield* self.observability.recordHookEvent(type);
      }

      return results;
    }).pipe(
      Effect.mapError((cause) => new HookExecutionError({
        hookType: type,
        message: `Failed to execute hooks for type: ${type}`,
        cause,
      }))
    );
  }

  executeHooksAndMerge(type: HookType, event: HookEvent): Effect.Effect<{
    context?: Record<string, unknown>;
    data?: unknown;
    skip?: boolean;
    metadata?: Record<string, unknown>;
  }, HookExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      const results = yield* self.executeHooks(type, event);

      const merged: {
        context?: Record<string, unknown>;
        data?: unknown;
        skip?: boolean;
        metadata?: Record<string, unknown>;
      } = {};

      for (const result of results) {
        if (result.context) {
          merged.context = { ...merged.context, ...result.context };
        }
        if (result.data !== undefined) {
          merged.data = result.data;
        }
        if (result.skip) {
          merged.skip = true;
        }
        if (result.metadata) {
          merged.metadata = { ...merged.metadata, ...result.metadata };
        }
      }

      return merged;
    }).pipe(
      Effect.mapError((cause) => new HookExecutionError({
        hookType: type,
        message: `Failed to merge hook results for type: ${type}`,
        cause,
      }))
    );
  }

  private logHandlerFailure(
    type: HookType,
    index: number,
    error: unknown,
    event: HookEvent
  ): Effect.Effect<void> {
    if (!this.observability) {
      return Effect.void;
    }

    return this.observability.logStructured({
      level: 'error',
      message: `Hook handler failed: ${type}`,
      metadata: {
        'hook.type': type,
        'hook.handlerIndex': index,
        'hook.error': error instanceof Error ? error.message : String(error),
        runId: event.runId,
        conversationId: event.conversationId,
        intentId: event.intentId,
        agentId: event.agentId,
        pipelineId: event.pipelineId,
        stepName: event.stepName,
      },
    }).pipe(Effect.orElseSucceed(() => undefined));
  }

  clearHooks(type: HookType): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      const newHooks = new Map(hooks);
      newHooks.delete(type);
      yield* Ref.set(self.hooks, newHooks);
    });
  }

  clearAllHooks(): Effect.Effect<void> {
    return Ref.set(this.hooks, new Map());
  }

  getRegisteredHookTypes(): Effect.Effect<HookType[]> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      return Array.from(hooks.keys());
    });
  }

  getHookCount(type: HookType): Effect.Effect<number> {
    const self = this;
    return Effect.gen(function* () {
      const hooks = yield* Ref.get(self.hooks);
      return hooks.get(type)?.length || 0;
    });
  }
}

/**
 * Live layer providing HookManagerService
 */
export const HookManagerServiceLive = Layer.effect(
  HookManagerService,
  Effect.gen(function* () {
    const hooks = yield* Ref.make(new Map<HookType, HookHandler[]>());

    // Optionally inject ObservabilityService if available
    const observability = yield* Effect.serviceOption(ObservabilityService);
    const agentStatus = yield* Effect.serviceOption(AgentStatusService);

    return new HookManagerServiceImpl(
      hooks,
      observability._tag === 'Some' ? observability.value : undefined,
      agentStatus._tag === 'Some' ? agentStatus.value : undefined
    );
  })
);
