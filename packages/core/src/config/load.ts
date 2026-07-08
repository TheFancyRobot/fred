/**
 * Schema-first config loading (Phase 61, STEP-61-05).
 *
 * Ties together the pieces built in this phase — the `FrameworkConfigSchema`
 * (structure/types), `validateFrameworkConfig` (semantic rules), and the
 * `ConfigError`/`ConfigValidationError` diagnostics — into one entry point:
 *
 *   parse file -> structural decode -> semantic validation -> typed config
 *
 * On any problem it throws a single `ConfigValidationError` aggregating every
 * `ConfigError` (with remediation), instead of the imperative loader's
 * fail-on-first-`throw`.
 *
 * This is additive: the legacy `loadConfig`/`validateConfig` in `loader.ts`
 * are unchanged, so existing callers and their exact error messages keep
 * working. New/Effect-native callers can adopt this path (and pair it with
 * `configToLayers` from `compile.ts`) for provider-quality config errors.
 */
import { Schema } from 'effect';
import { parseConfigFile } from './parser';
import { FrameworkConfigSchema } from './schema';
import { validateFrameworkConfig } from './validate';
import { ConfigValidationError, configValidationError, formatConfigIssues } from './errors';
import type { FrameworkConfig } from './types';

const decode = Schema.decodeUnknownEither(FrameworkConfigSchema);

/**
 * Validate an already-parsed config object against the schema and semantic
 * rules. Returns the (lossless) input on success; throws
 * `ConfigValidationError` with every problem found otherwise.
 *
 * Structural decoding runs first (in `{ errors: 'all' }` mode); only once the
 * shape is sound do the semantic cross-field rules run, so their assumptions
 * about types hold.
 */
export function validateParsedConfig(config: unknown): FrameworkConfig {
  const decoded = decode(config, { errors: 'all' });
  if (decoded._tag === 'Left') {
    throw configValidationError(formatConfigIssues(decoded.left));
  }

  const semanticErrors = validateFrameworkConfig(decoded.right);
  if (semanticErrors.length > 0) {
    throw configValidationError(semanticErrors);
  }

  // Return the original object (not the decoded copy) so no fields are dropped
  // by structural stripping — decoding here is a validation gate, not a
  // transform.
  return config as FrameworkConfig;
}

/**
 * Load, parse, and validate a config file via the schema-first path.
 * Throws `ConfigValidationError` on any structural or semantic problem.
 */
export function loadValidatedConfig(filePath: string): FrameworkConfig {
  return validateParsedConfig(parseConfigFile(filePath));
}

export { ConfigValidationError };
