import type { AgentConfig } from '@fancyrobot/fred';

export type BamlAgentConfigOptions = Omit<AgentConfig, 'tools'> & {
  readonly tools: ReadonlyArray<string>;
};

function dedupeTools(tools: ReadonlyArray<string>): string[] {
  return [...new Set(tools)];
}

function createConfig(options: BamlAgentConfigOptions): AgentConfig {
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
