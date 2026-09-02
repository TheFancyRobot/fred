import { Context, Deferred, Effect, Layer, Ref } from 'effect';
import type * as AiModel from '@effect/ai/Model';
import type { ProviderDefinition, ProviderConfig, ProviderModelDefaults } from './provider';
import type { EffectProviderFactory } from './base';
import { ProviderNotFoundError, ProviderRegistrationError, ProviderModelError } from './errors';
import { loadProviderPackEffect } from './loader';
import { createProviderDefinitionEffect, resolveFactoryIdentity } from './base';

/**
 * ProviderRegistryService interface for Effect-based provider management
 */
export interface ProviderRegistryService {
  /**
   * Register a provider pack by id/package name.
   * Loads the pack dynamically and validates exports.
   *
   * Returns the registered definition, since the pack's declared `id` (or
   * an alias) often differs from `idOrPackage` when it is a package
   * specifier (e.g. `"@fancyrobot/fred-openai"` registers under `"openai"`)
   * — callers that need to look the definition back up should use the
   * returned value rather than re-querying by `idOrPackage`.
   */
  register(idOrPackage: string, config?: ProviderConfig): Effect.Effect<ProviderDefinition, ProviderRegistrationError>;

  /**
   * Register a pre-created factory (for programmatic use)
   */
  registerFactory(factory: EffectProviderFactory, config?: ProviderConfig): Effect.Effect<void, ProviderRegistrationError>;

  /**
   * Register a pre-built provider definition directly
   */
  registerDefinition(definition: ProviderDefinition): Effect.Effect<void, ProviderRegistrationError>;

  /**
   * Get a model from a registered provider
   */
  getModel(
    providerId: string,
    modelId?: string,
    overrides?: ProviderModelDefaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Effect.Effect<AiModel.Model<any, any, any>, ProviderNotFoundError | ProviderModelError>;

  /**
   * List unique provider IDs (not aliases)
   */
  listProviders(): Effect.Effect<string[]>;

  /**
   * Get a provider definition by id or alias
   */
  getDefinition(id: string): Effect.Effect<ProviderDefinition, ProviderNotFoundError>;

  /**
   * Get all unique provider definitions
   */
  getDefinitions(): Effect.Effect<ProviderDefinition[]>;

  /**
   * Check if a provider is registered
   */
  hasProvider(id: string): Effect.Effect<boolean>;

  /**
   * Get merged Effect Layer for all providers
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLayer(): Effect.Effect<Layer.Layer<any, any, any>>;

  /**
   * Mark registry as initialized (after startup loading)
   */
  markInitialized(): Effect.Effect<void>;

  /**
   * Check if registry is initialized
   */
  isInitialized(): Effect.Effect<boolean>;
}

export const ProviderRegistryService = Context.GenericTag<ProviderRegistryService>(
  'ProviderRegistryService'
);
/**
 * Result of an atomic registration transition (see registerDefinition).
 */
type RegisterOutcome =
  | { _tag: 'registered' }
  | { _tag: 'noop' }
  | { _tag: 'conflict'; error: ProviderRegistrationError };

/**
 * Outcome of the in-flight registration claim in registerFactory: 'Wait'
 * means another caller is already building this provider id, 'Build' means
 * we won the race and must run the build and settle the deferred.
 */
type InFlightSlot =
  | { _tag: 'Wait'; deferred: Deferred.Deferred<ProviderDefinition, ProviderRegistrationError> }
  | { _tag: 'Build'; deferred: Deferred.Deferred<ProviderDefinition, ProviderRegistrationError> };

/**
 * Two definitions are the same registration when the provider id matches and
 * the factory instance matches. A definition registered without a factory
 * (hand-built, via registerDefinition) never conflicts.
 */
function isSameRegistration(
  existingFactory: EffectProviderFactory | undefined,
  incomingFactory: EffectProviderFactory | undefined
): boolean {
  return (
    existingFactory === undefined
    || incomingFactory === undefined
    || resolveFactoryIdentity(existingFactory) === resolveFactoryIdentity(incomingFactory)
  );
}

/**
 * Implementation of ProviderRegistryService
 */
class ProviderRegistryServiceImpl implements ProviderRegistryService {
  constructor(
    private providers: Ref.Ref<Map<string, ProviderDefinition>>,
    private initialized: Ref.Ref<boolean>,
    private inFlight: Ref.Ref<Map<string, Deferred.Deferred<ProviderDefinition, ProviderRegistrationError>>>
  ) {}

  register(idOrPackage: string, config: ProviderConfig = {}): Effect.Effect<ProviderDefinition, ProviderRegistrationError> {
    const self = this;
    return Effect.gen(function* () {
      // Load factory with proper Effect error channel
      const factory = yield* loadProviderPackEffect(idOrPackage).pipe(
        Effect.mapError((error) => new ProviderRegistrationError({
          providerId: idOrPackage,
          cause: error
        }))
      );

      // Create definition with proper Effect error channel
      const definition = yield* createProviderDefinitionEffect(factory, config);

      yield* self.registerDefinition(definition);
      return definition;
    });
  }

  registerFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Effect.Effect<void, ProviderRegistrationError> {
    const self = this;
    return Effect.gen(function* () {
      // Idempotent fast path: re-registering the same caller factory is a
      // no-op and must not re-run factory.load (which may have side effects).
      const existing = yield* self.getDefinition(factory.id).pipe(Effect.orElseSucceed(() => null));
      if (existing !== null && isSameRegistration(existing.factory, factory)) {
        return;
      }

      // Concurrent dedup: two callers registering the same not-yet-registered
      // factory must share one build instead of both peeking an empty registry
      // and both running factory.load (duplicate side effects). The first
      // caller claims a slot atomically; the rest await the builder's
      // deferred and observe its outcome.
      const key = factory.id.toLowerCase();
      const myDeferred = yield* Deferred.make<ProviderDefinition, ProviderRegistrationError>();
      const slot = yield* Ref.modify(
        self.inFlight,
        (inFlight): readonly [InFlightSlot, Map<string, Deferred.Deferred<ProviderDefinition, ProviderRegistrationError>>] => {
          const pending = inFlight.get(key);
          if (pending) {
            return [{ _tag: 'Wait', deferred: pending }, inFlight] as const;
          }
          const next = new Map(inFlight);
          next.set(key, myDeferred);
          return [{ _tag: 'Build', deferred: myDeferred }, next] as const;
        }
      );

      if (slot._tag === 'Wait') {
        yield* Deferred.await(slot.deferred);
        return;
      }

      // Build path: the inFlight slot stays claimed across the whole build so
      // concurrent callers wait instead of re-running factory.load. On any
      // exit (success, failure, defect, interrupt) the slot is released (if
      // still ours) and the deferred is settled so waiters receive the
      // builder's definition or failure; failures, defects, and interrupts
      // propagate unchanged to the builder's caller.
      yield* Effect.gen(function* () {
        // Create definition with proper Effect error channel
        const definition = yield* createProviderDefinitionEffect(factory, config);

        yield* self.registerDefinition(definition);
        return definition;
      }).pipe(
        Effect.onExit((buildExit) =>
          Effect.gen(function* () {
            yield* Ref.update(self.inFlight, (inFlight) => {
              const next = new Map(inFlight);
              if (next.get(key) === slot.deferred) {
                next.delete(key);
              }
              return next;
            });
            yield* Deferred.done(slot.deferred, buildExit);
          })
        )
      );
    });
  }

  registerDefinition(definition: ProviderDefinition): Effect.Effect<void, ProviderRegistrationError> {
    const self = this;
    const normalizedId = definition.id.toLowerCase();
    const normalizedAliases = definition.aliases.map((alias) => alias.toLowerCase());
    // Deduplicate: aliases matching the id are harmless
    const keysToRegister = [...new Set([normalizedId, ...normalizedAliases])];

    // Atomic check-and-set (BUG-0002): conflict validation and insertion must
    // happen in a single Ref.modify transition so concurrent registrations can
    // never build from the same stale snapshot and overwrite each other.
    return Effect.gen(function* () {
      const outcome = yield* Ref.modify(
        self.providers,
        (providers): readonly [RegisterOutcome, Map<string, ProviderDefinition>] => {
          for (const key of keysToRegister) {
            const existing = providers.get(key);
            if (existing) {
              const sameId = existing.id.toLowerCase() === normalizedId;
              if (sameId && isSameRegistration(existing.factory, definition.factory)) {
                // Idempotent: re-registering the same provider is a no-op
                return [{ _tag: 'noop' }, providers];
              }
              const error = sameId
                ? new ProviderRegistrationError({
                    providerId: definition.id,
                    cause: new Error(
                      `Cannot register provider "${definition.id}": id "${normalizedId}" is already registered to a different factory`
                    )
                  })
                : new ProviderRegistrationError({
                    providerId: definition.id,
                    cause: new Error(
                      `Cannot register provider "${definition.id}": ${key === normalizedId ? 'id' : 'alias'} "${key}" is already registered to provider "${existing.id}"`
                    )
                  });
              return [{ _tag: 'conflict', error }, providers];
            }
          }
          const newProviders = new Map(providers);
          // Store with lowercase keys for case-insensitive lookup
          newProviders.set(normalizedId, definition);
          for (const alias of definition.aliases) {
            newProviders.set(alias.toLowerCase(), definition);
          }
          return [{ _tag: 'registered' }, newProviders];
        }
      );

      if (outcome._tag === 'conflict') {
        return yield* Effect.fail(outcome.error);
      }
    });
  }

  getModel(
    providerId: string,
    modelId?: string,
    overrides?: ProviderModelDefaults
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Effect.Effect<AiModel.Model<any, any, any>, ProviderNotFoundError | ProviderModelError> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      const definition = providers.get(providerId.toLowerCase());

      if (!definition) {
        return yield* Effect.fail(new ProviderNotFoundError({
          providerId,
          availableProviders: yield* self.listProviders(),
          suggestion: self.findClosestMatch(providerId, providers)
        }));
      }

      const selectedModel = modelId ?? definition.config.modelDefaults?.model;
      if (!selectedModel) {
        return yield* Effect.fail(new ProviderModelError({
          providerId,
          modelId: 'undefined',
          cause: new Error(`No model configured for provider ${providerId}`)
        }));
      }

      const merged = { ...definition.config.modelDefaults, ...overrides };

      // definition.getModel returns Effect<LanguageModel, Error>
      return yield* definition.getModel(selectedModel, merged).pipe(
        Effect.mapError((error) => new ProviderModelError({
          providerId,
          modelId: selectedModel,
          cause: error
        }))
      );
    });
  }

  listProviders(): Effect.Effect<string[]> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      const unique = new Set(
        Array.from(providers.values()).map((def) => def.id)
      );
      return Array.from(unique);
    });
  }

  getDefinition(id: string): Effect.Effect<ProviderDefinition, ProviderNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      const definition = providers.get(id.toLowerCase());
      if (!definition) {
        return yield* Effect.fail(new ProviderNotFoundError({
          providerId: id,
          availableProviders: yield* self.listProviders(),
          suggestion: self.findClosestMatch(id, providers)
        }));
      }
      return definition;
    });
  }

  getDefinitions(): Effect.Effect<ProviderDefinition[]> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      return Array.from(new Set(providers.values()));
    });
  }

  hasProvider(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const providers = yield* Ref.get(self.providers);
      return providers.has(id.toLowerCase());
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getLayer(): Effect.Effect<Layer.Layer<any, any, any>> {
    const self = this;
    return Effect.gen(function* () {
      const definitions = yield* self.getDefinitions();
      return definitions.reduce(
        (acc, definition) => Layer.merge(acc, definition.layer),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        Layer.empty as unknown as Layer.Layer<any, any, any>
      );
    });
  }

  markInitialized(): Effect.Effect<void> {
    return Ref.set(this.initialized, true);
  }

  isInitialized(): Effect.Effect<boolean> {
    return Ref.get(this.initialized);
  }

  private findClosestMatch(input: string, providers: Map<string, ProviderDefinition>): string | undefined {
    const lower = input.toLowerCase();
    const ids = Array.from(new Set(Array.from(providers.values()).map(d => d.id)));
    return ids.find(
      (id) => id.toLowerCase().startsWith(lower) || id.toLowerCase().includes(lower)
    );
  }
}

/**
 * Live layer providing ProviderRegistryService
 */
export const ProviderRegistryServiceLive = Layer.effect(
  ProviderRegistryService,
  Effect.gen(function* () {
    const providers = yield* Ref.make(new Map<string, ProviderDefinition>());
    const initialized = yield* Ref.make(false);
    const inFlight = yield* Ref.make(new Map<string, Deferred.Deferred<ProviderDefinition, ProviderRegistrationError>>());
    return new ProviderRegistryServiceImpl(providers, initialized, inFlight);
  })
);
