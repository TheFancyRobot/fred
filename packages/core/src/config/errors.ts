/**
 * Structured configuration errors for the Effect Schema config pipeline
 * (Phase 61). A `ConfigError` carries the offending path, the decoder's
 * complaint, and — when known — provider-quality remediation guidance and a
 * docs link, so a bad config file reads like a helpful diagnostic instead of
 * an opaque stack trace.
 *
 * `ConfigError` is a `Schema.TaggedError` (rather than the `Data.TaggedError`
 * used elsewhere in core) because config diagnostics are surfaced across the
 * HTTP/OpenAPI boundary in later phases and must be schema-encodable.
 */
import { ParseResult, Schema } from 'effect';

/**
 * A single configuration problem, addressed to one path in the config tree.
 *
 * Multiple `ConfigError`s can result from decoding one config file when the
 * decoder runs in `{ errors: 'all' }` mode — one per distinct issue.
 */
export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  /** Dotted path to the offending value, e.g. `agents[0].platform`. `(root)` for the top level. */
  path: Schema.String,
  /** What is wrong at this path, as reported by the schema decoder. */
  issue: Schema.String,
  /** Human-readable one-line message: `${path}: ${issue}`. */
  message: Schema.String,
  /** How to fix it, when the schema (or a resolver) knows. */
  remediation: Schema.optional(Schema.String),
  /** Link to relevant documentation, when available. */
  docsUrl: Schema.optional(Schema.String),
}) {
  /** Multi-line, CLI-friendly rendering with remediation and docs when present. */
  override toString(): string {
    const lines = [`ConfigError at ${this.path}`, '', `Problem: ${this.issue}`];
    if (this.remediation !== undefined) {
      lines.push('', `How to fix: ${this.remediation}`);
    }
    if (this.docsUrl !== undefined) {
      lines.push('', `Docs: ${this.docsUrl}`);
    }
    return lines.join('\n');
  }
}

/**
 * Aggregate of every `ConfigError` found while loading one config file.
 *
 * Thrown by the validated-load path so a caller sees all structural and
 * semantic problems (with remediation) at once, rather than only the first.
 */
export class ConfigValidationError extends Schema.TaggedError<ConfigValidationError>()(
  'ConfigValidationError',
  {
    message: Schema.String,
    errors: Schema.Array(ConfigError),
  },
) {
  /** Multi-line rendering: a header plus each problem's full diagnostic. */
  override toString(): string {
    const header = `ConfigValidationError: ${this.errors.length} problem(s) found`;
    return [header, ...this.errors.map((e) => e.toString())].join('\n\n');
  }
}

/** Build a `ConfigValidationError` from a list of issues, composing a summary message. */
export const configValidationError = (errors: ReadonlyArray<ConfigError>): ConfigValidationError =>
  new ConfigValidationError({
    errors,
    message:
      errors.length === 1
        ? errors[0]!.message
        : `${errors.length} config problems: ${errors.map((e) => e.message).join('; ')}`,
  });

/** Shape of a single issue as produced by `ParseResult.ArrayFormatter`. */
export interface ConfigIssue {
  readonly path: ReadonlyArray<PropertyKey>;
  readonly message: string;
}

/** Optional enrichment resolved per-issue, keyed off its path/message. */
export interface ConfigIssueContext {
  /**
   * Given a raw decoder issue, optionally supply remediation guidance and a
   * docs link. Returning `undefined` (or omitting a field) leaves it unset.
   */
  readonly resolve?: (issue: ConfigIssue) => { remediation?: string; docsUrl?: string } | undefined;
}

/**
 * Render a `ParseResult.ArrayFormatter` path as a dotted/bracketed string:
 * object keys join with `.`, array indices render as `[n]`. An empty path
 * (a whole-value failure) renders as `(root)`.
 */
const formatPath = (path: ReadonlyArray<PropertyKey>): string => {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((acc, segment) => {
    if (typeof segment === 'number') return `${acc}[${segment}]`;
    const key = String(segment);
    return acc === '' ? key : `${acc}.${key}`;
  }, '');
};

/**
 * Convert a schema `ParseError` into a flat list of `ConfigError`s — one per
 * issue — via `ParseResult.ArrayFormatter`. Pass a `resolve` in `context` to
 * attach remediation/docs to specific paths.
 *
 * Decode with `{ errors: 'all' }` upstream to surface every problem at once
 * rather than only the first.
 */
export const formatConfigIssues = (
  error: ParseResult.ParseError,
  context: ConfigIssueContext = {},
): ConfigError[] => {
  const issues = ParseResult.ArrayFormatter.formatErrorSync(error);
  return issues.map((issue) => {
    const path = formatPath(issue.path);
    const enrichment = context.resolve?.({ path: issue.path, message: issue.message });
    return new ConfigError({
      path,
      issue: issue.message,
      message: `${path}: ${issue.message}`,
      ...(enrichment?.remediation !== undefined ? { remediation: enrichment.remediation } : {}),
      ...(enrichment?.docsUrl !== undefined ? { docsUrl: enrichment.docsUrl } : {}),
    });
  });
};
