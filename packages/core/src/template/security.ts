import { Effect } from 'effect';
import { TemplateResolutionError } from './errors';

export const SECURITY_HEADER = [
  'var require = undefined;',
  'var process = undefined;',
  'var __dirname = undefined;',
  'var __filename = undefined;',
  'var globalThis = undefined;',
  'var global = undefined;',
  'var Bun = undefined;',
  'var Deno = undefined;',
  'var eval = undefined;',
  'var Function = undefined;',
].join('\n');

export const DEFAULT_ENV_ALLOWLIST = ['NODE_ENV', 'FRED_*', 'LOG_LEVEL', 'DEBUG', 'TZ'] as const;

const matchesAllowPattern = (key: string, pattern: string): boolean => {
  if (pattern.endsWith('*')) {
    return key.startsWith(pattern.slice(0, -1));
  }

  return key === pattern;
};

export const filterEnvVars = (
  env: Record<string, string | undefined>,
  allowlist: readonly string[] = DEFAULT_ENV_ALLOWLIST
): Record<string, string> => {
  const filtered: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      continue;
    }

    if (allowlist.some((pattern) => matchesAllowPattern(key, pattern))) {
      filtered[key] = value;
    }
  }

  return filtered;
};

export const checkOutputSize = (
  output: string,
  maxBytes: number,
  filePath = '<template>'
): Effect.Effect<string, TemplateResolutionError> =>
  Effect.gen(function* () {
    const bytes = Buffer.byteLength(output, 'utf8');

    if (bytes > maxBytes) {
      return yield* Effect.fail(
        new TemplateResolutionError({
          filePath,
          expression: 'output-size',
          message: `Rendered template output exceeds max size (${bytes} > ${maxBytes} bytes)`,
        })
      );
    }

    return output;
  });
