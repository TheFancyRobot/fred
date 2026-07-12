import { Context, Schema } from 'effect';
import { existsSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import type { Tool } from '../tool/tool';
import type { ProviderConfigInput } from '../platform/provider';
import {
  loadConfig,
  validateConfig,
  extractIntents,
  extractAgents,
  validateNoAmbiguousPromptFiles,
  extractPipelines,
  extractWorkflows,
  extractProviders,
  extractObservability,
  extractToolPolicies,
  extractMCPServers,
} from './loader';
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
import { PostgresContextStorage } from '../context/storage/postgres';
import { SqliteContextStorage } from '../context/storage/sqlite';
import {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  CheckpointManager,
  CheckpointCleanupTask,
} from '../pipeline/checkpoint';
import type { CheckpointStorage } from '../pipeline/checkpoint';

/**
 * Interface for Fred instance (to avoid circular dependency)
 */
interface AgentManagerLike {
  setDefaultSystemMessage(systemMessage?: string): void;
  hasAgent(id: string): boolean;
}

interface PipelineManagerLike {
  setCheckpointManager(manager: import('../pipeline/checkpoint').CheckpointManager): void;
}

interface ProviderRegistryLike {
  register(idOrPackage: string, config?: import('../platform/provider').ProviderConfig): Promise<void>;
  markInitialized(): void;
}

interface ProviderServiceLike {
  syncProviderRegistry(): void;
  registerDefaultProviders(config?: ProviderConfigInput): Promise<void>;
  loadDefaultProviders(): Promise<void>;
}

export interface FredLike {
  getAgentManager(): AgentManagerLike;
  getPipelineManager(): PipelineManagerLike;
  getProviderRegistry(): ProviderRegistryLike;
  getProviderService(): ProviderServiceLike;
  setDefaultPolicy(policy: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  }): void;
  setStorage(storage: unknown): void;
  registerTool(tool: Tool): void;
  registerIntents(intents: import('../intent/intent').Intent[]): void;
  createAgent(config: import('../agent/agent').AgentConfig): Promise<import('../agent/agent').AgentInstance>;
  removeAgent(id: string): Promise<boolean>;
  createPipeline(config: import('../pipeline').PipelineConfig): Promise<import('../pipeline').PipelineInstance>;
  configureRouting(config: import('../routing/types').RoutingConfig): void;
  configureWorkflows(workflows: import('../workflow/manager').Workflow[]): void;
  configureObservability(config: import('./types').ObservabilityConfig): void;
  setToolPolicies?(policies: ToolPoliciesConfig | undefined): Promise<void> | void;
  configureMCPServers?(configs: Array<import('./types').MCPGlobalServerConfig & { id: string }>): Promise<void>;
  setAgentFileWatcher?(watcher: AgentFileWatcher): void;
  emitWarning?(message: string | null): void;
  getGlobalVariables?(): Promise<Record<string, string | number | boolean>>;
  onPartialFileChanged?(partialName: string, filePath: string): Promise<void> | void;
}

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
  createPipeline(config: import('../pipeline').PipelineConfig): Promise<void>;
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

/**
 * ConfigInitializer handles loading and applying configuration from YAML/JSON files.
 * Extracts the initializeFromConfig logic from Fred class.
 */
export class ConfigInitializer {
  /**
   * Initialize Fred from a config file
   */
  async initialize(
    fred: FredLike,
    configPath: string,
    options?: InitializerOptions
  ): Promise<void> {
    const agentManager = fred.getAgentManager();
    const pipelineManager = fred.getPipelineManager();
    const providerRegistry = fred.getProviderRegistry();
    const providerService = fred.getProviderService();

    // Load and validate config
    const config = loadConfig(configPath);
    validateConfig(config);

    // Set default system message
    const defaultSystemMessage = config.defaultSystemMessage
      ? loadPromptFile(config.defaultSystemMessage, configPath, false)
      : undefined;
    agentManager.setDefaultSystemMessage(defaultSystemMessage);

    // Configure memory defaults
    const memoryDefaults = config.memory;
    if (memoryDefaults?.policy) {
      fred.setDefaultPolicy(memoryDefaults.policy);
    }

    // Configure persistence adapter
    if (config.persistence) {
      await this.configurePersistence(
        config.persistence,
        fred,
        pipelineManager
      );
    }

    // Configure observability (tracing and logging)
    const observabilityConfig = extractObservability(config);
    fred.configureObservability(observabilityConfig);

    const toolPolicies = extractToolPolicies(config);
    if (fred.setToolPolicies) {
      await fred.setToolPolicies(toolPolicies);
    }

    // Register providers
    const providers = extractProviders(config);
    if (providers.length > 0) {
      await Promise.all(
        providers.map((pack) => providerRegistry.register(pack.package, pack.config))
      );
      providerRegistry.markInitialized();
      providerService.syncProviderRegistry();
    } else if (options?.providers) {
      await providerService.registerDefaultProviders(options.providers);
    } else {
      await providerService.loadDefaultProviders();
      providerRegistry.markInitialized();
      providerService.syncProviderRegistry();
    }

    // Configure MCP servers (before agent creation so agents can reference them)
    const mcpConfigs = extractMCPServers(config);
    if (mcpConfigs.length > 0 && fred.configureMCPServers) {
      await fred.configureMCPServers(mcpConfigs);
    }

    // Register tools (need execute functions)
    // Config-loaded tools have metadata-only schemas - Effect Schema types
    // are added at runtime via the execute function registration
    if (config.tools) {
      const toolExecutors = options?.toolExecutors || new Map();
      for (const toolDef of config.tools) {
        const executor = toolExecutors.get(toolDef.id);
        if (!executor) {
          throw new Error(
            `Tool "${toolDef.id}" requires an execute function. Provide it in toolExecutors option.`
          );
        }
        // Cast to Tool since config-defined tools have metadata schema only
        fred.registerTool({
          ...toolDef,
          execute: executor,
        } as Tool);
      }
    }

    // Configure routing before agent creation so runtime invalidation
    // happens before agents are registered (routing config is baked into
    // the Effect runtime layer, so configureRouting triggers a rebuild).
    if (config.routing) {
      fred.configureRouting(config.routing);
    }

    // Configure workflows before agent creation for the same reason.
    const workflows = extractWorkflows(config);
    if (workflows.length > 0) {
      fred.configureWorkflows(workflows);
    }

    // Register intents
    const intents = extractIntents(config);
    if (intents.length > 0) {
      fred.registerIntents(intents);
    }

    // Create agents (load order: .md files -> config agents)
    const discoveredAgentDirs = config.agentDirs ?? (() => {
      const srcAgentsDir = resolve(dirname(configPath), './src/agents');
      if (existsSync(srcAgentsDir)) {
        return ['./src/agents'];
      }

      const rootAgentsDir = resolve(dirname(configPath), './agents');
      return existsSync(rootAgentsDir) ? ['./agents'] : [];
    })();

    const fileTemplateOptions = await this.buildAgentFileTemplateOptions(fred, config);
    const discoveredFilePaths = discoveredAgentDirs.length > 0
      ? discoverAgentFiles(discoveredAgentDirs, dirname(configPath))
      : [];
    const fileAgents = discoveredAgentDirs.length > 0
      ? loadAgentFiles(discoveredAgentDirs, dirname(configPath), fileTemplateOptions)
      : [];

    let configCursor = 0;
    const fileAgentEntries = discoveredFilePaths.flatMap((filePath) => {
      const content = readFileSync(filePath, 'utf-8');
      const parsed = parseAgentFile(content, filePath);
      if (parsed === null) {
        return [];
      }

      const config = fileAgents[configCursor];
      configCursor += 1;
      if (!config) {
        return [];
      }

      return [{
        filePath,
        config,
      } satisfies LoadedAgentFile];
    });

    validateNoAmbiguousPromptFiles(config.agents ?? [], configPath);
    const configAgents = extractAgents(config, configPath);

    const allAgentIds = new Set<string>();
    for (const agentConfig of [...fileAgents, ...configAgents]) {
      if (allAgentIds.has(agentConfig.id)) {
        throw new Error(
          `Duplicate agent ID "${agentConfig.id}" found across agent sources. Agent IDs must be unique across .md files, config agents, and programmatic registrations.`
        );
      }
      allAgentIds.add(agentConfig.id);
    }

    for (const agentConfig of fileAgents) {
      await fred.createAgent(agentConfig);
    }

    for (const agentConfig of configAgents) {
      await fred.createAgent(agentConfig);
    }

    if (discoveredAgentDirs.length > 0) {
      const onFileChanged: AgentFileChangeHandler = async (event) => {
        try {
          if (event.previousId) {
            await fred.removeAgent(event.previousId);
          }

          if (event.config) {
            await fred.createAgent(event.config);
            fred.emitWarning?.(null);
            console.log(`[AgentFileWatcher] Reloaded agent "${event.config.id}" from ${event.filePath}`);
          } else if (event.error) {
            const shortPath = event.filePath.split('/').slice(-2).join('/');
            fred.emitWarning?.(`Agent reload failed (${shortPath}): ${event.error}`);
          } else if (event.previousId) {
            console.log(`[AgentFileWatcher] Removed agent "${event.previousId}" (file deleted or invalid)`);
          }
        } catch (error) {
          console.warn(
            `[AgentFileWatcher] Failed to reload agent from "${event.filePath}": ${error instanceof Error ? error.message : String(error)}`
          );
        }
      };

      const partialDirs = config.template?.partialDirs ?? ['./partials'];
      const watcher = new AgentFileWatcher(discoveredAgentDirs, dirname(configPath), onFileChanged, {
        partialDirs,
        onPartialChanged: async (partialName, filePath) => {
          try {
            await fred.onPartialFileChanged?.(partialName, filePath);
            console.log(`[TemplateEngine] Partial "${partialName}" changed, invalidated template cache`);
          } catch (error) {
            console.warn(
              `[TemplateEngine] Failed to process partial change "${partialName}" (${filePath}): ${error instanceof Error ? error.message : String(error)}`
            );
          }
        },
      });
      for (const entry of fileAgentEntries) {
        watcher.registerKnownAgent(entry.filePath, entry.config.id);
      }
      watcher.start();
      fred.setAgentFileWatcher?.(watcher);
    }

    // Create pipelines (resolve prompt files in inline agents relative to config path)
    const pipelines = extractPipelines(config, configPath);
    for (const pipelineConfig of pipelines) {
      await fred.createPipeline(pipelineConfig);
    }

    // Validate routing defaultAgent now that agents are registered
    if (config.routing?.defaultAgent && !agentManager.hasAgent(config.routing.defaultAgent)) {
      console.warn(
        `[Config] Routing defaultAgent "${config.routing.defaultAgent}" not found among registered agents`
      );
    }
  }

  /** Apply a validated config to the Effect-service-backed client target. */
  async initializeServices(
    target: ConfigInitializationTarget,
    configPath: string,
    options?: InitializerOptions,
  ): Promise<void> {
    const config = loadConfig(configPath);
    validateConfig(config);

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

    if (config.routing) {
      await target.configureRouting(config.routing);
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

    for (const pipeline of extractPipelines(config, configPath)) {
      await target.createPipeline(pipeline);
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

  private async buildAgentFileTemplateOptions(
    fred: FredLike,
    config: FrameworkConfig
  ): Promise<AgentFileTemplateOptions> {
    const globalVars = fred.getGlobalVariables ? await fred.getGlobalVariables() : {};
    const envAllowlist = config.template?.envAllowlist ?? [...DEFAULT_ENV_ALLOWLIST];
    const filteredEnv = filterEnvVars(process.env as Record<string, string | undefined>, envAllowlist);

    return {
      globalVars,
      filteredEnv,
      fredConfig: {
        defaultSystemMessage: config.defaultSystemMessage,
        agentDirs: config.agentDirs,
        template: config.template,
      },
    };
  }

  /**
   * Configure persistence storage
   */
  private async configurePersistence(
    persistence: {
      adapter: 'postgres' | 'sqlite';
      checkpoint?: { enabled?: boolean; ttlMs?: number; cleanupIntervalMs?: number };
    },
    fred: Pick<FredLike, 'setStorage'>,
    pipelineManager: PipelineManagerLike
  ): Promise<void> {
    if (persistence.adapter === 'postgres') {
      const connectionString = process.env.FRED_POSTGRES_URL;
      if (!connectionString) {
        throw new Error(
          'FRED_POSTGRES_URL environment variable is required for Postgres persistence adapter'
        );
      }
      const storage = new PostgresContextStorage({ connectionString });
      fred.setStorage(storage);
    } else if (persistence.adapter === 'sqlite') {
      const path = process.env.FRED_SQLITE_PATH || './fred.db';
      const storage = new SqliteContextStorage({ path });
      fred.setStorage(storage);
    }

    // Set up checkpoint storage if persistence enabled (default: true)
    const checkpointEnabled = persistence.checkpoint?.enabled !== false;
    if (checkpointEnabled) {
      let checkpointStorage: CheckpointStorage;

      if (persistence.adapter === 'postgres') {
        const url = process.env.FRED_POSTGRES_URL;
        if (!url) {
          throw new Error('FRED_POSTGRES_URL required for postgres persistence');
        }
        checkpointStorage = new PostgresCheckpointStorage({ connectionString: url });
      } else {
        const dbPath = process.env.FRED_SQLITE_PATH ?? './fred.db';
        checkpointStorage = new SqliteCheckpointStorage({ path: dbPath });
      }

      const checkpointManager = new CheckpointManager({
        storage: checkpointStorage,
        defaultTtlMs: persistence.checkpoint?.ttlMs,
      });

      // Wire to pipeline manager
      pipelineManager.setCheckpointManager(checkpointManager);

      // Start cleanup task
      const cleanupIntervalMs = persistence.checkpoint?.cleanupIntervalMs ?? 3600000;
      const cleanupTask = new CheckpointCleanupTask(checkpointStorage, { intervalMs: cleanupIntervalMs });
      cleanupTask.start();

      // Note: Consider adding a shutdown() method to Fred that stops cleanup
    }
  }

  /**
   * Get memory defaults from config
   */
  getMemoryDefaults(configPath: string): {
    policy?: { maxMessages?: number; maxChars?: number; strict?: boolean; isolated?: boolean };
    requireConversationId?: boolean;
    sequentialVisibility?: boolean;
  } {
    const config = loadConfig(configPath);
    const memoryDefaults = config.memory;
    return {
      policy: memoryDefaults?.policy,
      requireConversationId: memoryDefaults?.requireConversationId,
      sequentialVisibility: memoryDefaults?.sequentialVisibility,
    };
  }
}

/**
 * Effect service tag for ConfigInitializer
 */
export const ConfigInitializerService = Context.GenericTag<ConfigInitializer>('ConfigInitializerService');
