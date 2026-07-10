import type { AgentConfig } from '@fancyrobot/fred';
import type * as Schema from 'effect/Schema';

export type BamlAgentConfigOptions<
  InputSchema extends Schema.Schema.AnyNoContext = typeof Schema.String,
  OutputSchema extends Schema.Schema.AnyNoContext = typeof Schema.Unknown,
> = Omit<AgentConfig<InputSchema, OutputSchema>, 'tools'> & {
  readonly tools: ReadonlyArray<string>;
};

function dedupeTools(tools: ReadonlyArray<string>): string[] {
  return [...new Set(tools)];
}

function createConfig<
  InputSchema extends Schema.Schema.AnyNoContext = typeof Schema.String,
  OutputSchema extends Schema.Schema.AnyNoContext = typeof Schema.Unknown,
>(
  options: BamlAgentConfigOptions<InputSchema, OutputSchema>
): AgentConfig<InputSchema, OutputSchema> {
  return {
    ...options,
    tools: dedupeTools(options.tools),
  };
}

function toolId(functionName: string, prefix = 'baml'): string {
  return `${prefix}.${functionName}`;
}

export const BamlAgent = {
  createConfig,
  toolId,
} as const;
