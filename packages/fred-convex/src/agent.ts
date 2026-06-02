import type { AgentConfig } from '@fancyrobot/fred';

/**
 * Options for creating a Convex-backed Fred agent config.
 */
export type ConvexAgentConfigOptions = Omit<AgentConfig, 'tools'> & {
  readonly tools: ReadonlyArray<string>;
};

function dedupeTools(tools: ReadonlyArray<string>): string[] {
  return [...new Set(tools)];
}

function createConfig(options: ConvexAgentConfigOptions): AgentConfig {
  return {
    ...options,
    tools: dedupeTools(options.tools),
  };
}

function toolId(functionName: string, prefix = 'convex'): string {
  return `${prefix}.${functionName}`;
}

export const ConvexAgent = {
  createConfig,
  toolId,
} as const;
