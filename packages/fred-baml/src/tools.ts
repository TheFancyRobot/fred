import type { Schema } from 'effect';
import type { Tool } from '@fancyrobot/fred';
import { BamlRuntimeLoadError, BamlToolExecutionError, MissingBamlClientError } from './errors';
import { initFredBamlRuntime, type FredBamlRuntime } from './runtime';

/**
 * Public schema boundary for local file: consumers.
 *
 * Effect Schema carries nominal symbols, so exposing `Schema.Schema<T>` in
 * generated declarations can bind local consumers to Fred's realpath-resolved
 * `effect` install. The structural `Type` member preserves useful inference
 * from Effect Schema values without leaking the nominal peer type.
 */
export interface BamlToolSchema<Type = unknown> {
  readonly Type: Type;
  readonly Encoded: unknown;
  readonly Context: unknown;
  readonly ast: unknown;
  annotations(...args: ReadonlyArray<unknown>): unknown;
  pipe(...args: ReadonlyArray<unknown>): unknown;
}

/**
 * Tool schema metadata compatible with Fred's tool schema metadata.
 */
export interface BamlToolSchemaMetadata {
  readonly type: 'object';
  readonly properties: Record<string, unknown>;
  readonly required?: string[];
  readonly description?: string;
  readonly additionalProperties?: boolean;
}

export interface BamlTool<Input = unknown, Output = unknown> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: {
    /** Type-erased to keep local file: consumers from binding to Fred's realpath-resolved Effect Schema peer. */
    readonly input: any;
    /** Type-erased to keep local file: consumers from binding to Fred's realpath-resolved Effect Schema peer. */
    readonly success: any;
    readonly metadata?: BamlToolSchemaMetadata;
  };
  readonly strict: boolean;
  execute(input: Input): Promise<Output> | Output;
}

export interface CreateBamlToolOptions<Input, Output> {
  readonly id: string;
  readonly name?: string;
  readonly description: string;
  readonly inputSchema: BamlToolSchema<Input>;
  readonly successSchema: BamlToolSchema<Output>;
  readonly metadata?: BamlToolSchemaMetadata;
  readonly strict?: boolean;
  readonly runtime?: FredBamlRuntime;
  readonly execute: (input: Input, runtime: FredBamlRuntime) => Promise<Output> | Output;
}

export function createBamlTool<Input, Output>(
  options: CreateBamlToolOptions<Input, Output>,
): BamlTool<Input, Output> {
  const runtime = options.runtime ?? initFredBamlRuntime();

  const tool: Tool<Input, Output, never> = {
    id: options.id,
    name: options.name ?? options.id,
    description: options.description,
    schema: {
      input: options.inputSchema as Schema.Schema<Input>,
      success: options.successSchema as Schema.Schema<Output>,
      metadata: options.metadata,
    },
    strict: options.strict ?? true,
    execute: async (input: Input): Promise<Output> => {
      try {
        return await options.execute(input, runtime);
      } catch (cause) {
        if (
          cause instanceof BamlToolExecutionError ||
          cause instanceof MissingBamlClientError ||
          cause instanceof BamlRuntimeLoadError
        ) {
          throw cause;
        }

        const message = cause instanceof Error ? cause.message : 'Unknown BAML tool execution failure';
        throw new BamlToolExecutionError({
          toolId: options.id,
          message: `BAML tool \`${options.id}\` failed: ${message}`,
          cause,
        });
      }
    },
  };

  return tool as BamlTool<Input, Output>;
}
