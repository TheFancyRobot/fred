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
 * This is the canonical config boundary. Promise and Effect-facing runtime
 * initializers both enter through this module before compiling the validated
 * value into layers or applying live service configuration.
 */
import { Schema } from 'effect';
import { parseConfigFile } from './parser';
import { FrameworkConfigSchema } from './schema';
import { emitFrameworkConfigWarnings, validateFrameworkConfig } from './validate';
import { ConfigError, configValidationError, formatConfigIssues } from './errors';
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
  if (
    typeof config === 'object' &&
    config !== null &&
    Object.prototype.hasOwnProperty.call(config, 'pipelines')
  ) {
    throw configValidationError([
      new ConfigError({
        path: 'pipelines',
        issue: 'legacy V1 pipeline configuration is no longer supported',
        message: 'pipelines: legacy V1 pipeline configuration is no longer supported',
        remediation: 'Migrate the configuration to "pipelinesV2" or define a native workflow.',
      }),
    ]);
  }

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
  const config = validateParsedConfig(parseConfigFile(filePath));
  emitFrameworkConfigWarnings(config);
  return config;
}
