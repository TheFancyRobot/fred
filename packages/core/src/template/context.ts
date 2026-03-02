import type { AgentConfig } from '../agent/agent';
import type { FrameworkConfig } from '../config/types';

export type VariableValue = string | number | boolean;

type TemplateConfigContext = {
  defaultSystemMessage?: string;
  agentDirs?: string[];
};

type AgentTemplateContext = {
  id: string;
  model: string;
  platform: string;
  temperature?: number;
  maxTokens?: number;
};

export type FrontmatterContext = {
  vars: Record<string, VariableValue>;
  env: Record<string, string>;
  config: TemplateConfigContext;
};

export type BodyContext = FrontmatterContext & {
  agent: AgentTemplateContext;
} & Record<string, unknown>;

const buildConfigNamespace = (fredConfig: Partial<FrameworkConfig>): TemplateConfigContext => ({
  defaultSystemMessage: fredConfig.defaultSystemMessage,
  agentDirs: fredConfig.agentDirs ? [...fredConfig.agentDirs] : undefined,
});

export const buildFrontmatterContext = (
  globalVars: Record<string, VariableValue>,
  filteredEnv: Record<string, string>,
  fredConfig: Partial<FrameworkConfig>
): FrontmatterContext => ({
  vars: { ...globalVars },
  env: { ...filteredEnv },
  config: buildConfigNamespace(fredConfig),
});

export const buildBodyContext = (
  globalVars: Record<string, VariableValue>,
  filteredEnv: Record<string, string>,
  agentConfig: AgentConfig,
  fredConfig: Partial<FrameworkConfig>,
  customNamespaces: Record<string, unknown> = {}
): BodyContext => ({
  vars: { ...globalVars },
  env: { ...filteredEnv },
  config: buildConfigNamespace(fredConfig),
  agent: {
    id: agentConfig.id,
    model: agentConfig.model,
    platform: agentConfig.platform,
    temperature: agentConfig.temperature,
    maxTokens: agentConfig.maxTokens,
  },
  ...customNamespaces,
});
