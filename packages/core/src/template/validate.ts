import { readFileSync } from 'fs';
import { dirname } from 'path';
import { Cause, Effect } from 'effect';
import { discoverAgentFiles, parseAgentFile } from '../agent/file-loader';
import type { BodyContext, FrontmatterContext } from './context';
import { TemplateCompileError, TemplateResolutionError } from './errors';
import { TemplateEngine, TemplateEngineLive } from './engine';
import { DEFAULT_ENV_ALLOWLIST } from './security';

export interface ValidationResult {
  filePath: string;
  valid: boolean;
  error?: string;
  warnings?: string[];
}

interface TemplateValidationOptions {
  partialDirs?: string[];
  envAllowlist?: readonly string[];
}

const extractRawFrontmatter = (content: string): string | null => {
  if (!content.startsWith('---\n') && !content.startsWith('---\r\n')) {
    return null;
  }

  const delimiter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  return delimiter?.[1] ?? null;
};

const withTemplateEngine = <A, E>(
  effect: Effect.Effect<A, E, TemplateEngine>,
  options: { basePath: string; partialDirs?: string[] }
): Effect.Effect<A, E> =>
  effect.pipe(
    Effect.provide(TemplateEngineLive({
      basePath: options.basePath,
      partialDirs: options.partialDirs,
    }))
  );

export const validateAllTemplates = (
  agentDirs: string[],
  basePath: string,
  options: TemplateValidationOptions = {}
): Effect.Effect<ValidationResult[]> =>
  Effect.gen(function* () {
    const files = discoverAgentFiles(agentDirs, basePath);
    const results: ValidationResult[] = [];

    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      const warnings = securityLintTemplate(content, filePath, options.envAllowlist);

      try {
        const parsed = parseAgentFile(content, filePath);
        if (parsed === null) {
          continue;
        }

        const rawFrontmatter = extractRawFrontmatter(content);
        const exit = yield* Effect.exit(withTemplateEngine(
          Effect.gen(function* () {
            const engine = yield* TemplateEngine;
            if (rawFrontmatter !== null) {
              yield* engine.validate(rawFrontmatter, filePath);
            }
            yield* engine.validate(parsed.body, filePath);
          }),
          {
            basePath,
            partialDirs: options.partialDirs,
          }
        ));

        if (exit._tag === 'Success') {
          results.push({
            filePath,
            valid: true,
            warnings,
          });
          continue;
        }

        results.push({
          filePath,
          valid: false,
          error: Cause.pretty(exit.cause),
          warnings,
        });
      } catch (error) {
        results.push({
          filePath,
          valid: false,
          error: error instanceof Error ? error.message : String(error),
          warnings,
        });
      }
    }

    return results;
  });

export const previewTemplate = (
  filePath: string,
  context: BodyContext,
  options: TemplateValidationOptions = {}
): Effect.Effect<string, TemplateCompileError | TemplateResolutionError | Error> => {
  const content = readFileSync(filePath, 'utf-8');
  const parsed = parseAgentFile(content, filePath);
  if (parsed === null) {
    return Effect.fail(new Error(`Template preview requires a markdown agent file with frontmatter: ${filePath}`));
  }

  const rawFrontmatter = extractRawFrontmatter(content);
  const frontmatterContext: FrontmatterContext = {
    vars: context.vars,
    env: context.env,
    config: context.config,
  };

  return withTemplateEngine(
    Effect.gen(function* () {
      const engine = yield* TemplateEngine;

      const resolvedFrontmatter = rawFrontmatter === null
        ? ''
        : yield* engine.compileFrontmatter(rawFrontmatter, frontmatterContext, filePath);
      const resolvedBody = yield* engine.resolveBody(parsed.body, context, filePath);

      if (resolvedFrontmatter.length === 0) {
        return resolvedBody;
      }

      return `---\n${resolvedFrontmatter}\n---\n\n${resolvedBody}`;
    }),
    {
      basePath: dirname(filePath),
      partialDirs: options.partialDirs,
    }
  );
};

const RESTRICTED_GLOBAL_PATTERN = /\b(require|process|__dirname|__filename|globalThis|global|Bun|Deno|eval|Function)\b/g;
const ENV_REFERENCE_PATTERN = /\benv\.([A-Z0-9_]+)\b/g;

const getLineColumn = (text: string, index: number): { line: number; column: number } => {
  const preceding = text.slice(0, index);
  const lines = preceding.split(/\r?\n/);
  const line = lines.length;
  const column = (lines[lines.length - 1]?.length ?? 0) + 1;
  return { line, column };
};

const envAllowed = (key: string, allowlist: readonly string[]): boolean =>
  allowlist.some((entry) => {
    if (entry.endsWith('*')) {
      return key.startsWith(entry.slice(0, -1));
    }

    return entry === key;
  });

export const securityLintTemplate = (
  template: string,
  filePath: string,
  allowlist: readonly string[] = DEFAULT_ENV_ALLOWLIST
): string[] => {
  const warnings: string[] = [];

  for (const match of template.matchAll(RESTRICTED_GLOBAL_PATTERN)) {
    const index = match.index ?? 0;
    const { line, column } = getLineColumn(template, index);
    warnings.push(`${filePath}:${line}:${column} references restricted global "${match[0]}"`);
  }

  for (const match of template.matchAll(ENV_REFERENCE_PATTERN)) {
    const envKey = match[1];
    if (!envKey || envAllowed(envKey, allowlist)) {
      continue;
    }

    const index = match.index ?? 0;
    const { line, column } = getLineColumn(template, index);
    warnings.push(`${filePath}:${line}:${column} references env.${envKey} outside configured allowlist`);
  }

  return warnings;
};

export const compileTemplate = (
  source: string
): Effect.Effect<void, TemplateCompileError> =>
  withTemplateEngine(
    Effect.gen(function* () {
      const engine = yield* TemplateEngine;
      return yield* engine.validate(source, '<template>');
    }),
    {
      basePath: process.cwd(),
    }
  );

export const resolveAgentTemplate = (
  source: string,
  context: BodyContext
): Effect.Effect<string, TemplateResolutionError> =>
  withTemplateEngine(
    Effect.gen(function* () {
      const engine = yield* TemplateEngine;
      return yield* engine.resolveBody(source, context, '<template>');
    }),
    {
      basePath: process.cwd(),
    }
  );
