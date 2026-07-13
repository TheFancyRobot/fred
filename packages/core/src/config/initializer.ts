import { Context, Schema } from 'effect';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { Tool } from '../tool/tool';
import type { ProviderConfigInput } from '../platform/provider';
import {
  extractIntents,
  extractAgents,
  validateNoAmbiguousPromptFiles,
  extractPipelinesV2,
  extractWorkflows,
  extractProviders,
  extractToolPolicies,
  extractMCPServers,
} from './loader';
import { loadValidatedConfig } from './load';
import { emitFrameworkConfigWarnings } from './validate';
import { loadPromptFile } from '../utils/prompt-loader';
import {
  discoverAgentFiles,
  loadAgentFiles,
  parseAgentFile,
  type AgentFileTemplateOptions,
} from '../agent/file-loader';
import {
  AgentFileWatcher,
  type AgentFileChangeHandler,
} from '../agent/file-watcher';
import type { AgentConfig } from '../agent/agent';
import type { MCPGlobalServerConfig, ToolConfig, ToolPoliciesConfig } from './types';
import type { FrameworkConfig } from './types';
import { DEFAULT_ENV_ALLOWLIST, filterEnvVars } from '../template/security';

interface LoadedAgentFile {
  readonly filePath: string;
  readonly config: AgentConfig;
}

/**
 * Options for initialization
 */
export interface InitializerOptions {
  toolExecutors?: Map<string, Tool['execute']>;
  providers?: ProviderConfigInput;
  routingOverride?: import('../routing/types').RoutingConfig;
}

/**
 * Narrow service-backed target used by createFred config initialization.
 * It intentionally exposes capabilities rather than legacy manager objects.
 */
export interface ConfigInitializationTarget {
  setDefaultSystemMessage(systemMessage?: string): Promise<void>;
  setMemoryDefaults(memory: NonNullable<FrameworkConfig['memory']>): Promise<void>;
  setContextPolicy(policy: NonNullable<FrameworkConfig['memory']>['policy']): Promise<void>;
  setToolPolicies(policies: ToolPoliciesConfig | undefined): Promise<void>;
  registerProvider(idOrPackage: string, config?: import('../platform/provider').ProviderConfig): Promise<void>;
  registerDefaultProviders(config?: ProviderConfigInput): Promise<void>;
  configureMCPServers(configs: Array<MCPGlobalServerConfig & { id: string }>): Promise<void>;
  registerTool(tool: Tool): Promise<void>;
  configureRouting(config: import('../routing/types').RoutingConfig): Promise<void>;
  configureWorkflows(workflows: import('../workflow/manager').Workflow[]): Promise<void>;
  registerIntents(intents: import('../intent/intent').Intent[]): Promise<void>;
  createAgent(config: AgentConfig): Promise<void>;
  removeAgent(id: string): Promise<void>;
  hasAgent(id: string): Promise<boolean>;
  defineWorkflow(config: import('../pipeline').PipelineConfigV2): Promise<void>;
  getGlobalVariables(): Promise<Record<string, string | number | boolean>>;
  invalidateTemplateCache(): Promise<void>;
  ownAgentFileWatcher(watcher: AgentFileWatcher): void;
  emitWarning(message: string | null): void;
}

const makeConfiguredTool = (definition: ToolConfig, execute: Tool['execute']): Tool => ({
  id: definition.id,
  name: definition.name,
  description: definition.description,
  capabilities: definition.capabilities,
  capabilityMetadata: definition.capabilityMetadata,
  strict: definition.strict,
  schema: {
    input: Schema.Unknown,
    success: Schema.Unknown,
    metadata: definition.schema?.metadata,
  },
  execute,
});

/** Applies YAML/JSON configuration to the service-backed Fred client target. */
export class ConfigInitializer {
  /** Apply a validated config to the Effect-service-backed client target. */
  async initializeServices(
    target: ConfigInitializationTarget,
    configPath: string,
    options?: InitializerOptions,
    validatedConfig?: FrameworkConfig,
  ): Promise<void> {
    const config = validatedConfig ?? loadValidatedConfig(configPath);
    emitFrameworkConfigWarnings(config);

    const defaultSystemMessage = config.defaultSystemMessage
      ? loadPromptFile(config.defaultSystemMessage, configPath, false)
      : undefined;
    await target.setDefaultSystemMessage(defaultSystemMessage);
    await target.setMemoryDefaults(config.memory ?? {});
    await target.setContextPolicy(config.memory?.policy);

    await target.setToolPolicies(extractToolPolicies(config));

    const providers = extractProviders(config);
    if (providers.length > 0) {
      await Promise.all(
        providers.map((pack) => target.registerProvider(pack.package, pack.config)),
      );
    } else {
      await target.registerDefaultProviders(options?.providers);
    }

    const mcpConfigs = extractMCPServers(config);
    if (mcpConfigs.length > 0) {
      await target.configureMCPServers(mcpConfigs);
    }

    for (const definition of config.tools ?? []) {
      const executor = options?.toolExecutors?.get(definition.id);
      if (!executor) {
        throw new Error(
          `Tool "${definition.id}" requires an execute function. Provide it in toolExecutors option.`,
        );
      }
      await target.registerTool(makeConfiguredTool(definition, executor));
    }

    const effectiveRouting = options?.routingOverride ?? config.routing;
    if (effectiveRouting) {
      await target.configureRouting(effectiveRouting);
    }
    await target.configureWorkflows(extractWorkflows(config));
    await target.registerIntents(extractIntents(config));

    const discoveredAgentDirs = config.agentDirs ?? (() => {
      const sourceAgents = resolve(dirname(configPath), './src/agents');
      if (existsSync(sourceAgents)) return ['./src/agents'];
      return existsSync(resolve(dirname(configPath), './agents')) ? ['./agents'] : [];
    })();
    const templateOptions = await this.buildServiceTemplateOptions(target, config);
    const discoveredPaths = discoveredAgentDirs.length > 0
      ? discoverAgentFiles(discoveredAgentDirs, dirname(configPath))
      : [];
    const fileAgents = discoveredAgentDirs.length > 0
      ? loadAgentFiles(discoveredAgentDirs, dirname(configPath), templateOptions)
      : [];
    let fileAgentCursor = 0;
    const fileAgentEntries = discoveredPaths.flatMap((filePath) => {
      if (parseAgentFile(readFileSync(filePath, 'utf-8'), filePath) === null) return [];
      const agent = fileAgents[fileAgentCursor];
      fileAgentCursor += 1;
      return agent ? [{ filePath, config: agent } satisfies LoadedAgentFile] : [];
    });

    validateNoAmbiguousPromptFiles(config.agents ?? [], configPath);
    const configAgents = extractAgents(config, configPath);
    const ids = new Set<string>();
    for (const agent of [...fileAgents, ...configAgents]) {
      if (ids.has(agent.id)) {
        throw new Error(
          `Duplicate agent ID "${agent.id}" found across agent sources. Agent IDs must be unique across .md files, config agents, and programmatic registrations.`,
        );
      }
      ids.add(agent.id);
    }
    for (const agent of [...fileAgents, ...configAgents]) {
      await target.createAgent(agent);
    }

    if (discoveredAgentDirs.length > 0) {
      const watcher = this.createServiceAgentWatcher(
        target,
        discoveredAgentDirs,
        configPath,
        config,
        fileAgentEntries,
      );
      watcher.start();
      target.ownAgentFileWatcher(watcher);
    }

    for (const pipeline of extractPipelinesV2(config)) {
      await target.defineWorkflow(pipeline);
    }

    if (config.routing?.defaultAgent && !(await target.hasAgent(config.routing.defaultAgent))) {
      console.warn(
        `[Config] Routing defaultAgent "${config.routing.defaultAgent}" not found among registered agents`,
      );
    }
  }

  private async buildServiceTemplateOptions(
    target: ConfigInitializationTarget,
    config: FrameworkConfig,
  ): Promise<AgentFileTemplateOptions> {
    const envAllowlist = config.template?.envAllowlist ?? [...DEFAULT_ENV_ALLOWLIST];
    return {
      globalVars: await target.getGlobalVariables(),
      filteredEnv: filterEnvVars(
        process.env,
        envAllowlist,
      ),
      fredConfig: {
        defaultSystemMessage: config.defaultSystemMessage,
        agentDirs: config.agentDirs,
        template: config.template,
      },
    };
  }

  private createServiceAgentWatcher(
    target: ConfigInitializationTarget,
    agentDirs: string[],
    configPath: string,
    config: FrameworkConfig,
    fileAgentEntries: LoadedAgentFile[],
  ): AgentFileWatcher {
    const onFileChanged: AgentFileChangeHandler = async (event) => {
      try {
        if (event.previousId) await target.removeAgent(event.previousId);
        if (event.config) {
          await target.createAgent(event.config);
          target.emitWarning(null);
        } else if (event.error) {
          const shortPath = event.filePath.split('/').slice(-2).join('/');
          target.emitWarning(`Agent reload failed (${shortPath}): ${event.error}`);
        }
      } catch (error) {
        console.warn(
          `[AgentFileWatcher] Failed to reload agent from "${event.filePath}": ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    };

    const watcher = new AgentFileWatcher(agentDirs, dirname(configPath), onFileChanged, {
      partialDirs: config.template?.partialDirs ?? ['./partials'],
      onPartialChanged: () => target.invalidateTemplateCache(),
    });
    for (const entry of fileAgentEntries) {
      watcher.registerKnownAgent(entry.filePath, entry.config.id);
    }
    return watcher;
  }

}

/**
 * Effect service tag for ConfigInitializer
 */
export const ConfigInitializerService = Context.GenericTag<ConfigInitializer>('ConfigInitializerService');
