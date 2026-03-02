import { Context, Effect, Layer } from 'effect';
import { Eta, EtaParseError, EtaRuntimeError } from 'eta';
import { resolve } from 'path';
import type { BodyContext, FrontmatterContext } from './context';
import { TemplateCompileError, TemplateResolutionError } from './errors';
import { SECURITY_HEADER, checkOutputSize } from './security';

export interface TemplateEngineConfig {
  partialDirs?: string[];
  basePath?: string;
  envAllowlist?: string[];
  strict?: boolean;
  maxOutputSize?: number;
}

export interface TemplateEngine {
  compileFrontmatter(
    raw: string,
    context: FrontmatterContext,
    filePath: string
  ): Effect.Effect<string, TemplateCompileError | TemplateResolutionError>;

  resolveBody(
    template: string,
    context: BodyContext,
    filePath: string
  ): Effect.Effect<string, TemplateResolutionError>;

  validate(template: string, filePath: string): Effect.Effect<void, TemplateCompileError>;
  registerPartial(name: string, content: string): Effect.Effect<void>;
  invalidateCache(): Effect.Effect<void>;
}

export const TemplateEngine = Context.GenericTag<TemplateEngine>('TemplateEngine');

const DEFAULT_MAX_OUTPUT_SIZE = 1_048_576;

export const containsEtaSyntax = (text: string): boolean => /<%[\s\S]*?%>/.test(text);

const parseLineFromMessage = (message: string): number | undefined => {
  const match = message.match(/line\s+(\d+)/i);
  if (!match) {
    return undefined;
  }

  const line = Number(match[1]);
  return Number.isFinite(line) ? line : undefined;
};

const toCompileError = (error: unknown, filePath: string): TemplateCompileError => {
  const message = error instanceof Error ? error.message : String(error);

  return new TemplateCompileError({
    filePath,
    message,
    line: parseLineFromMessage(message),
    cause: error,
  });
};

const toResolutionError = (error: unknown, filePath: string): TemplateResolutionError => {
  const message = error instanceof Error ? error.message : String(error);
  const expression = error instanceof Error && error.message.startsWith('Undefined template value:')
    ? error.message.replace('Undefined template value:', '').trim()
    : undefined;

  return new TemplateResolutionError({
    filePath,
    expression,
    message,
    cause: error,
  });
};

const toProxyObject = (value: unknown, mode: 'strict' | 'lenient', path: string): unknown => {
  if (value === null || value === undefined) {
    return mode === 'strict'
      ? new Proxy(
          {},
          {
            get: (_, property) => {
              if (typeof property === 'symbol') {
                return undefined;
              }

              throw new Error(`Undefined template value: ${path}.${String(property)}`);
            },
          }
        )
      : '';
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => toProxyObject(item, mode, `${path}[${index}]`));
  }

  if (typeof value !== 'object') {
    return value;
  }

  const source = value as Record<string, unknown>;

  return new Proxy(source, {
    get: (target, property) => {
      if (typeof property === 'symbol') {
        return Reflect.get(target, property);
      }

      if (Object.prototype.hasOwnProperty.call(target, property)) {
        const nextPath = path ? `${path}.${String(property)}` : String(property);
        return toProxyObject(target[property], mode, nextPath);
      }

      if (mode === 'strict') {
        throw new Error(`Undefined template value: ${path ? `${path}.` : ''}${String(property)}`);
      }

      return '';
    },
  });
};

const prepareContext = <T extends Record<string, unknown>>(context: T, strict: boolean): T => {
  const mode = strict ? 'strict' : 'lenient';
  const prepared = Object.fromEntries(
    Object.entries(context).map(([key, value]) => [key, toProxyObject(value, mode, key)])
  );

  return prepared as T;
};

const createEta = (config: TemplateEngineConfig): Eta => {
  const eta = new Eta({
    autoEscape: false,
    useWith: true,
    cache: true,
    defaultExtension: '.md',
    debug: true,
    tags: ['<%', '%>'],
    autoTrim: [false, false],
    functionHeader: SECURITY_HEADER,
  });

  if (config.basePath && config.partialDirs && config.partialDirs.length > 0) {
    eta.configure({
      views: resolve(config.basePath, config.partialDirs[0]),
    });
  }

  return eta;
};

export const TemplateEngineLive = (config: TemplateEngineConfig = {}): Layer.Layer<TemplateEngine> =>
  Layer.effect(
    TemplateEngine,
    Effect.gen(function* () {
      const strict = config.strict ?? true;
      const maxOutputSize = config.maxOutputSize ?? DEFAULT_MAX_OUTPUT_SIZE;
      const eta = createEta(config);

      const renderWithEta = <TContext extends Record<string, unknown>>(
        template: string,
        context: TContext,
        filePath: string
      ): Effect.Effect<string, TemplateResolutionError> =>
        Effect.try({
          try: () => {
            const renderContext = prepareContext(context, strict);
            return eta.renderString(template, renderContext);
          },
          catch: (error) => toResolutionError(error, filePath),
        }).pipe(Effect.flatMap((output) => checkOutputSize(output, maxOutputSize, filePath)));

      const service: TemplateEngine = {
        compileFrontmatter: (raw, context, filePath) => {
          if (!containsEtaSyntax(raw)) {
            return checkOutputSize(raw, maxOutputSize, filePath);
          }

          return Effect.try({
            try: () => {
              const renderContext = prepareContext(context as Record<string, unknown>, strict);
              return eta.renderString(raw, renderContext);
            },
            catch: (error) => {
              if (error instanceof EtaParseError) {
                return toCompileError(error, filePath);
              }

              if (error instanceof EtaRuntimeError) {
                return toResolutionError(error, filePath);
              }

              return toResolutionError(error, filePath);
            },
          }).pipe(Effect.flatMap((output) => checkOutputSize(output, maxOutputSize, filePath)));
        },

        resolveBody: (template, context, filePath) => {
          if (!containsEtaSyntax(template)) {
            return checkOutputSize(template, maxOutputSize, filePath);
          }

          return renderWithEta(template, context as Record<string, unknown>, filePath);
        },

        validate: (template, filePath) =>
          Effect.try({
            try: () => {
              eta.compile(template, { filepath: filePath });
            },
            catch: (error) => toCompileError(error, filePath),
          }),

        registerPartial: (name, content) =>
          Effect.sync(() => {
            eta.loadTemplate(`@${name}`, content);
          }),

        invalidateCache: () =>
          Effect.sync(() => {
            eta.templatesSync.reset();
            eta.filepathCache = {};
          }),
      };

      return service;
    })
  );
