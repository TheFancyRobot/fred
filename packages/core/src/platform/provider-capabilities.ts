/**
 * Provider capability types for multi-modality provider support.
 *
 * Extends the provider contract so a provider can expose typed optional
 * capability adapters beyond the language-only `getModel(...)` path.
 *
 * Design:
 * - Backward-compatible: existing providers remain valid with language-only
 *   implementations. The `capabilities` field is optional.
 * - Future-proof: MiniMax and other multi-modality providers can declare
 *   all six supported capabilities under a single provider ID.
 * - Explicit failure: callers get a typed `UnsupportedProviderCapabilityError`
 *   instead of having to probe arbitrarily.
 */

import { Data, Effect } from 'effect';
import type { ProviderDefinition } from './provider';

// ─── Capability Keys ────────────────────────────────────────────────────────

/**
 * The six provider capability modalities.
 *
 * Each key maps to a distinct adapter surface on a provider definition.
 */
export type ProviderCapabilityKey =
  | 'language'
  | 'image'
  | 'video'
  | 'speech'
  | 'voice'
  | 'music';

/**
 * Runtime array of all capability keys.
 *
 * Useful for iteration, validation, and display.
 */
export const ProviderCapabilityKeys: readonly ProviderCapabilityKey[] = [
  'language',
  'image',
  'video',
  'speech',
  'voice',
  'music',
] as const;

// ─── Unsupported Capability Error ────────────────────────────────────────────

/**
 * Error thrown when a caller requests a capability the provider does not support.
 *
 * This is a typed, catchable error so callers can use `Effect.catchTag`
 * to handle unsupported-capability paths gracefully.
 */
export class UnsupportedProviderCapabilityError extends Data.TaggedError(
  'UnsupportedProviderCapabilityError'
)<{
  readonly providerId: string;
  readonly capability: string;
}> {
  get message(): string {
    return `Provider "${this.providerId}" does not support capability "${this.capability}"`;
  }
}

// ─── Capability Access Helper ────────────────────────────────────────────────

/**
 * Check whether a provider definition supports a given capability.
 *
 * If the provider definition does not declare a `capabilities` set,
 * it is treated as language-only (backward-compatible default).
 *
 * @returns `true` if the capability is supported, `false` otherwise.
 */
export function hasCapability(
  definition: ProviderDefinition,
  capability: ProviderCapabilityKey
): boolean {
  const capabilities = resolveCapabilities(definition);
  return capabilities.has(capability);
}

/**
 * Get a capability from a provider definition as an Effect.
 *
 * - Returns `Effect.succeed(definition)` when the capability is supported.
 * - Returns `Effect.fail(new UnsupportedProviderCapabilityError(...))` when not.
 *
 * This gives callers a composable, typed failure path instead of
 * requiring arbitrary probing.
 */
export function getCapability(
  definition: ProviderDefinition,
  capability: ProviderCapabilityKey
): Effect.Effect<ProviderDefinition, UnsupportedProviderCapabilityError> {
  const capabilities = resolveCapabilities(definition);

  if (capabilities.has(capability)) {
    return Effect.succeed(definition);
  }

  return Effect.fail(
    new UnsupportedProviderCapabilityError({
      providerId: definition.id,
      capability,
    })
  );
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Resolve the effective capability set from a provider definition.
 *
 * When `capabilities` is not declared, the provider is treated as
 * language-only for backward compatibility.
 */
function resolveCapabilities(
  definition: ProviderDefinition
): Set<ProviderCapabilityKey> {
  const declared = (definition as any).capabilities;
  if (declared instanceof Set) {
    return declared as Set<ProviderCapabilityKey>;
  }
  // Backward-compatible default: language-only
  return new Set<ProviderCapabilityKey>(['language']);
}
