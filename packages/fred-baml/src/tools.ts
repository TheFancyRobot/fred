import { Schema } from 'effect';
import type { Tool, ToolSchemaMetadata } from '@fancyrobot/fred';
import { BamlToolExecutionError } from './errors';
import { initFredBamlRuntime, type FredBamlRuntime } from './runtime';

export interface CreateBamlToolOptions<Input, Output> {
  readonly id: string;
  readonly name?: string;
  readonly description: string;
  readonly inputSchema: Schema.Schema<Input>;
  readonly successSchema: Schema.Schema<Output>;
  readonly metadata?: ToolSchemaMetadata;
  readonly strict?: boolean;
  readonly runtime?: FredBamlRuntime;
  readonly execute: (input: Input, runtime: FredBamlRuntime) => Promise<Output> | Output;
}

export function createBamlTool<Input, Output>(
  options: CreateBamlToolOptions<Input, Output>,
): Tool<Input, Output, never> {
  const runtime = options.runtime ?? initFredBamlRuntime();

  return {
    id: options.id,
    name: options.name ?? options.id,
    description: options.description,
    schema: {
      input: options.inputSchema,
      success: options.successSchema,
      metadata: options.metadata,
    },
    strict: options.strict ?? true,
    execute: async (input: Input): Promise<Output> => {
      try {
        return await options.execute(input, runtime);
      } catch (cause) {
        if (cause instanceof BamlToolExecutionError) {
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
}
