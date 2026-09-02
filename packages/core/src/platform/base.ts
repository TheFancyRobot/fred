import { Effect, Layer } from 'effect';
import type * as AiModel from '@effect/ai/Model';
import type { ProviderConfig, ProviderDefinition, ProviderModelDefaults } from './provider';
import type {
  ProviderConnectionCapabilities,
  ProviderConnectionPrepareFactory,
  ProviderConnectionTestHook,
} from './connections';
import type { ProviderCapabilityKey } from './provider-capabilities';
import { validatePackExports, isProviderFactory } from './pack-schema';
import { ProviderPackLoadError, ProviderRegistrationError } from './errors';

// Re-export validation utilities for external use
export { validatePackExports, isProviderFactory } from './pack-schema';
export { ProviderPackLoadError, ProviderNotFoundError, ProviderRuntimeError } from './errors';

export interface EffectProviderFactory {
  id: string;
  aliases?: string[];
  capabilities?: ReadonlySet<ProviderCapabilityKey>;
  connectionCapabilities?: ProviderConnectionCapabilities;
  connectionTest?: ProviderConnectionTestHook;
  makeConnectionPrepare?: ProviderConnectionPrepareFactory;
  load: (config: ProviderConfig) => Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    layer: Layer.Layer<any, any, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getModel: (modelId: string, options?: ProviderModelDefaults) => Effect.Effect<AiModel.Model<any, any, any>, Error>;
  }>;
}

/**
 * Symbol to mark factories that have already been validated.
 * Prevents redundant validation on repeated calls.
 */
const VALIDATED_FACTORY = Symbol('ValidatedFactory');

interface ValidatedFactory extends EffectProviderFactory {
  [VALIDATED_FACTORY]: true;
}

/**
 * Check if a factory has already been validated.
 */
function isAlreadyValidated(factory: EffectProviderFactory): factory is ValidatedFactory {
  return VALIDATED_FACTORY in factory;
}

/**
 * Mark a factory as validated.
 */
function markValidated(factory: EffectProviderFactory): ValidatedFactory {
  (factory as ValidatedFactory)[VALIDATED_FACTORY] = true;
  return factory as ValidatedFactory;
}

/**
 * Maps a caller's original factory object to the validated clone produced by
 * Schema decoding. The decode returns a clone, so without this map a
 * re-registration of the same caller object would look like a different
 * factory and be rejected as a conflict.
 */
const validatedOriginals = new WeakMap<object, EffectProviderFactory>();

/**
 * Resolve the identity used for registration comparison: an original caller
 * object maps back to its validated clone, so re-registering the same object
 * compares equal even when the stored definition holds the clone.
 */
export function resolveFactoryIdentity(
  factory: EffectProviderFactory | undefined
): EffectProviderFactory | undefined {
  return factory === undefined ? undefined : validatedOriginals.get(factory) ?? factory;
}

/**
 * Create a ProviderDefinition from an EffectProviderFactory.
 *
 * Validates the factory structure before use and wraps load() failures
 * in ProviderPackLoadError with clear remediation hints.
 *
 * @param factory - The provider factory (from pack or built-in)
 * @param config - Provider configuration
 * @returns Promise<ProviderDefinition> on success
 * @throws ProviderPackLoadError if factory validation or load() fails
 */
export async function createProviderDefinition(
  factory: EffectProviderFactory,
  config: ProviderConfig
): Promise<ProviderDefinition> {
  // Validate factory structure if not already validated
  const validatedFactory = isAlreadyValidated(factory)
    ? factory
    : markValidated(validatePackExports(factory, factory.id ?? 'unknown'));

  // Wrap load() call in try/catch to provide helpful error context
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let loadResult: { layer: Layer.Layer<any, any, any>; getModel: EffectProviderFactory['load'] extends (config: ProviderConfig) => Promise<infer R> ? R extends { getModel: infer G } ? G : never : never };

  try {
    loadResult = await validatedFactory.load(config);
  } catch (error) {
    // If it's already a ProviderPackLoadError, preserve it
    if (error instanceof ProviderPackLoadError) {
      throw error;
    }

    // Wrap unknown errors in ProviderPackLoadError
    const message = error instanceof Error ? error.message : String(error);
    throw new ProviderPackLoadError({
      packageName: validatedFactory.id,
      reason: `Provider load() failed: ${message}`,
      remediation: [
        'Check the provider pack configuration:',
        '  - Is the API key environment variable set?',
        '  - Is the baseUrl correct (if specified)?',
        '  - Are required dependencies installed?',
      ].join('\n'),
      cause: error,
    });
  }

  return {
    id: validatedFactory.id,
    aliases: validatedFactory.aliases ?? [],
    config,
    getModel: loadResult.getModel,
    layer: loadResult.layer,
    factory: validatedFactory,
    capabilities: validatedFactory.capabilities
      ? new Set(validatedFactory.capabilities)
      : undefined,
    connectionCapabilities: validatedFactory.connectionCapabilities,
    connectionTest: validatedFactory.connectionTest,
    connectionPrepare: validatedFactory.makeConnectionPrepare?.(config),
  };
}

/**
 * Deep snapshot of a caller config (BUG-0009): copies the top level plus each
 * nested mutable field so later caller mutation cannot reach the stored
 * definition. Absent fields stay absent (no explicit undefined keys).
 */
function snapshotConfig(config: ProviderConfig): ProviderConfig {
  const snapshot: ProviderConfig = { ...config };
  if (config.aliases !== undefined) snapshot.aliases = [...config.aliases];
  if (config.headers !== undefined) snapshot.headers = { ...config.headers };
  if (config.credentials !== undefined) snapshot.credentials = { ...config.credentials };
  if (config.modelDefaults !== undefined) snapshot.modelDefaults = { ...config.modelDefaults };
  return snapshot;
}

/**
 * Effect-based version of createProviderDefinition.
 *
 * Returns an Effect with proper error channel instead of throwing.
 */
export const createProviderDefinitionEffect = (
  factory: EffectProviderFactory,
  config: ProviderConfig
): Effect.Effect<ProviderDefinition, ProviderRegistrationError> => {
  // Deep snapshot (BUG-0009): created before factory.load runs so the caller
  // cannot mutate the stored definition by mutating their config object after
  // registration.
  const storedConfig = snapshotConfig(config);

  // Validate factory structure
  const validateFactory = Effect.try({
    try: () => {
      if (isAlreadyValidated(factory)) {
        return factory;
      }
      const validated = markValidated(validatePackExports(factory, factory.id ?? 'unknown'));
      if (!validatedOriginals.has(factory)) {
        validatedOriginals.set(factory, validated);
      }
      return validated;
    },
    catch: (error) => new ProviderRegistrationError({
      providerId: factory.id ?? 'unknown',
      cause: error
    })
  });

  return Effect.gen(function* () {
    const validatedFactory = yield* validateFactory;

    // Merge factory aliases with config aliases (BUG-0003) only after schema
    // validation: validatedFactory.aliases is schema-decoded (or already
    // accepted as validated) and config aliases are checked here, so no
    // unvalidated input is ever spread or iterated.
    // Omitted aliases (schema-optional) normalize to an empty array;
    // present-but-malformed values are still rejected below.
    const factoryAliases = validatedFactory.aliases ?? [];
    if (!Array.isArray(factoryAliases) || factoryAliases.some((alias) => typeof alias !== 'string')) {
      return yield* Effect.fail(new ProviderRegistrationError({
        providerId: validatedFactory.id,
        cause: new Error(
          `Provider "${validatedFactory.id}" declares malformed aliases: expected an array of strings`
        )
      }));
    }
    const configAliases = config.aliases;
    if (configAliases !== undefined && (!Array.isArray(configAliases) || configAliases.some((alias) => typeof alias !== 'string'))) {
      return yield* Effect.fail(new ProviderRegistrationError({
        providerId: validatedFactory.id,
        cause: new Error(
          `Provider "${validatedFactory.id}" has malformed config aliases: expected an array of strings`
        )
      }));
    }

    const aliases = [...factoryAliases];
    for (const alias of configAliases ?? []) {
      if (!aliases.some((existing) => existing.toLowerCase() === alias.toLowerCase())) {
        aliases.push(alias);
      }
    }

    // Load the provider
    const loadResult = yield* Effect.tryPromise({
      try: () => validatedFactory.load(storedConfig),
      catch: (error) => {
        if (error instanceof ProviderPackLoadError) {
          return new ProviderRegistrationError({
            providerId: validatedFactory.id,
            cause: error
          });
        }
        const message = error instanceof Error ? error.message : String(error);
        return new ProviderRegistrationError({
          providerId: validatedFactory.id,
          cause: new Error(`Provider load() failed: ${message}`)
        });
      }
    });

    return {
      id: validatedFactory.id,
      aliases,
      config: storedConfig,
      getModel: loadResult.getModel,
      layer: loadResult.layer,
      factory: validatedFactory,
      capabilities: validatedFactory.capabilities
        ? new Set(validatedFactory.capabilities)
        : undefined,
      connectionCapabilities: validatedFactory.connectionCapabilities,
      connectionTest: validatedFactory.connectionTest,
      connectionPrepare: validatedFactory.makeConnectionPrepare?.(storedConfig),
    };
  });
};
