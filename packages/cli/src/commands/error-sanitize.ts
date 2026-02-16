/**
 * CLI Error Sanitization
 *
 * Prevents leaking sensitive system information (stack traces, file paths,
 * provider-specific diagnostics) through user-facing error messages.
 *
 * All CLI error messages that originate from caught exceptions should pass
 * through {@link sanitizeErrorForCli} before being written to stderr or
 * included in JSON error payloads.
 */

/**
 * Maximum character length for user-facing error messages.
 * Long messages are truncated with an ellipsis.
 */
const MAX_ERROR_LENGTH = 200;

/**
 * Pattern matching absolute filesystem paths (Unix and Windows).
 *
 * Examples matched:
 *   /home/user/project/src/foo.ts
 *   C:\Users\user\project\src\foo.ts
 *   /usr/local/lib/node_modules/...
 */
const FILE_PATH_PATTERN = /(?:\/[\w.-]+){2,}|[A-Z]:\\(?:[\w.-]+\\){1,}[\w.-]*/g;

/**
 * Sanitize an error value for safe CLI output.
 *
 * 1. Extracts the message string (first line only — strips stack traces).
 * 2. Redacts absolute filesystem paths to `<path>`.
 * 3. Caps the result at {@link MAX_ERROR_LENGTH} characters.
 *
 * @param error - The caught error value (Error instance, string, or unknown).
 * @returns A safe, single-line, length-capped error message.
 */
export function sanitizeErrorForCli(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const firstLine = raw.split('\n')[0];
  const redacted = firstLine.replace(FILE_PATH_PATTERN, '<path>');
  if (redacted.length <= MAX_ERROR_LENGTH) return redacted;
  return redacted.slice(0, MAX_ERROR_LENGTH - 3) + '...';
}
