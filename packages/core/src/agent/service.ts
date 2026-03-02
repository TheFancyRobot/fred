import { Context, Effect, Layer, Ref } from 'effect';
import type { AgentConfig, AgentInstance } from './agent';
import type { ProviderDefinition } from '../platform/provider';
import {
  AgentNotFoundError,
  AgentAlreadyExistsError,
  AgentCreationError,
  getAgentNotFoundMessage,
  getAgentAlreadyExistsMessage,
  getAgentCreationMessage,
  type AgentError
} from './errors';
import { AgentFactory, type ToolRegistryLike } from './factory';
import type { Tool } from '../tool/tool';
import { ToolRegistryService } from '../tool/service';
import { ProviderRegistryService } from '../platform/service';
import { ToolGateService } from '../tool-gate/service';
import type { Tracer } from '../tracing';
import type { TemplateEngine } from '../template/engine';
import type { FrameworkConfig } from '../config/types';

/**
 * AgentService interface for Effect-based agent lifecycle management
 */
export interface AgentService {
  /**
   * Create an agent from configuration
   */
  createAgent(config: AgentConfig): Effect.Effect<AgentInstance, AgentCreationError | AgentAlreadyExistsError>;

  /**
   * Get an agent by ID
   */
  getAgent(id: string): Effect.Effect<AgentInstance, AgentNotFoundError>;

  /**
   * Get an agent by ID (returns undefined if not found)
   */
  getAgentOptional(id: string): Effect.Effect<AgentInstance | undefined>;

  /**
   * Check if an agent exists
   */
  hasAgent(id: string): Effect.Effect<boolean>;

  /**
   * Remove an agent
   */
  removeAgent(id: string): Effect.Effect<boolean>;

  /**
   * Get all agents
   */
  getAllAgents(): Effect.Effect<AgentInstance[]>;

  /**
   * Clear all agents
   */
  clear(): Effect.Effect<void>;

  /**
   * Set the tracer for agent creation
   */
  setTracer(tracer?: Tracer): Effect.Effect<void>;

  /**
   * Set default system message for agents
   */
  setDefaultSystemMessage(systemMessage?: string): Effect.Effect<void>;

  /**
   * Set global variables resolver
   */
  setGlobalVariablesResolver(resolver: () => Record<string, string | number | boolean>): Effect.Effect<void>;

  setTemplateEngine(engine: TemplateEngine): Effect.Effect<void>;

  setTemplateCustomNamespaces(namespaces: Record<string, unknown>): Effect.Effect<void>;

  setTemplateEnvAllowlist(envAllowlist: string[]): Effect.Effect<void>;

  setTemplateFredConfig(config: Partial<FrameworkConfig>): Effect.Effect<void>;

  /**
   * Match agent by utterance
   */
  matchAgentByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>
  ): Effect.Effect<{ agentId: string; confidence: number; matchType: 'exact' | 'regex' | 'semantic' } | null>;

  /**
   * Get MCP client connection metrics
   */
  getMCPMetrics(): Effect.Effect<any>;

  /**
   * Register shutdown hooks for MCP client cleanup
   */
  registerShutdownHooks(): Effect.Effect<void>;
}

export const AgentService = Context.GenericTag<AgentService>(
  'AgentService'
);

/**
 * Implementation of AgentService
 */
class AgentServiceImpl implements AgentService {
  private factory: AgentFactory;
  private defaultSystemMessage?: string;

  constructor(
    private agents: Ref.Ref<Map<string, AgentInstance>>,
    private toolRegistryService: typeof ToolRegistryService.Service,
    private providerRegistryService: typeof ProviderRegistryService.Service,
    private toolGateService: typeof ToolGateService.Service,
    private tracer?: Tracer
  ) {
    const emptyRegistry: ToolRegistryLike = {
      getMissingToolIds: (ids) => ids,
      getTools: () => [],
      hasTool: () => false,
      registerTool: () => {},
    };
    this.factory = new AgentFactory(emptyRegistry, tracer);
    this.factory.setToolGateService(toolGateService);
  }

  createAgent(config: AgentConfig): Effect.Effect<AgentInstance, AgentCreationError | AgentAlreadyExistsError> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);

      if (agents.has(config.id)) {
        return yield* Effect.fail(new AgentAlreadyExistsError({
          id: config.id,
          message: getAgentAlreadyExistsMessage(config.id),
        }));
      }

      const providerDef = yield* self.providerRegistryService.getDefinition(config.platform).pipe(
        Effect.mapError((error) => new AgentCreationError({
          id: config.id,
          message: getAgentCreationMessage(config.id),
          cause: error
        }))
      );

      let resolvedTools = config.tools;
      if (config.tools && config.tools.length > 0) {
        const assignedTools = yield* self.toolRegistryService.getTools(config.tools);
        const filteredTools = yield* self.toolGateService.filterTools(assignedTools, {
          agentId: config.id,
        });
        resolvedTools = filteredTools.allowed.map((tool) => tool.id);
      }

      const resolvedConfig = {
        ...config,
        tools: resolvedTools,
        systemMessage: config.systemMessage ?? self.defaultSystemMessage,
      };

      const allTools = yield* self.toolRegistryService.getAllTools();
      yield* self.syncFactoryTools(allTools, config.id);

      const agentProcessor = yield* self.createAgentFromFactory(resolvedConfig, providerDef);

      const instance: AgentInstance = {
        id: config.id,
        config: resolvedConfig,
        processMessage: agentProcessor.processMessage,
        streamMessage: agentProcessor.streamMessage,
      } as AgentInstance;

      const inserted = yield* self.registerIfAbsent(instance);
      if (!inserted) {
        return yield* Effect.fail(new AgentAlreadyExistsError({
          id: config.id,
          message: getAgentAlreadyExistsMessage(config.id),
        }));
      }

      return instance;
    });
  }

  private registerIfAbsent(instance: AgentInstance): Effect.Effect<boolean> {
    const self = this;
    return Ref.modify(self.agents, (agents) => {
      if (agents.has(instance.id)) {
        return [false, agents] as const;
      }

      const updated = new Map(agents);
      updated.set(instance.id, instance);
      return [true, updated] as const;
    });
  }

  private syncFactoryTools(tools: Tool[], agentId: string): Effect.Effect<void, AgentCreationError> {
    const self = this;

    return Effect.try({
      try: () => {
        const toolMap = new Map<string, Tool>();
        for (const tool of tools) {
          toolMap.set(tool.id, tool);
        }

        const registry: ToolRegistryLike = {
          getMissingToolIds: (ids) => ids.filter((id) => !toolMap.has(id)),
          getTools: (ids) =>
            ids
              .map((id) => toolMap.get(id))
              .filter((tool): tool is Tool => !!tool),
          hasTool: (id) => toolMap.has(id),
          registerTool: (tool) => {
            toolMap.set(tool.id, tool);
          },
        };

        self.factory.setToolRegistry(registry);
      },
      catch: (cause) =>
        new AgentCreationError({
          id: agentId,
          message: getAgentCreationMessage(agentId),
          cause,
        }),
    });
  }

  /**
   * Effect-wrapped agent creation from factory
   */
  private createAgentFromFactory(
    config: AgentConfig,
    providerDef: ProviderDefinition
  ): Effect.Effect<{ processMessage: AgentInstance['processMessage']; streamMessage: AgentInstance['streamMessage'] }, AgentCreationError> {
    const self = this;

    return Effect.tryPromise({
      try: () => self.factory.createAgent(config, providerDef),
      catch: (cause) =>
        new AgentCreationError({
          id: config.id,
          message: getAgentCreationMessage(config.id),
          cause,
        }),
    });
  }

  getAgent(id: string): Effect.Effect<AgentInstance, AgentNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      const agent = agents.get(id);
      if (!agent) {
        return yield* Effect.fail(new AgentNotFoundError({
          id,
          message: getAgentNotFoundMessage(id),
        }));
      }
      return agent;
    });
  }

  getAgentOptional(id: string): Effect.Effect<AgentInstance | undefined> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      return agents.get(id);
    });
  }

  hasAgent(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      return agents.has(id);
    });
  }

  removeAgent(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      const newAgents = new Map(agents);
      const result = newAgents.delete(id);
      yield* Ref.set(self.agents, newAgents);

      // Clean up MCP clients for this agent
      yield* self.cleanupAgentMCPClients(id);

      return result;
    });
  }

  /**
   * Effect-wrapped MCP client cleanup for a single agent
   */
  private cleanupAgentMCPClients(agentId: string): Effect.Effect<void> {
    const self = this;
    return Effect.tryPromise(() => self.factory.cleanupMCPClients(agentId)).pipe(
      Effect.catchAll(() => Effect.void)
    );
  }

  getAllAgents(): Effect.Effect<AgentInstance[]> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      return Array.from(agents.values());
    });
  }

  clear(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* Ref.set(self.agents, new Map());
      yield* self.cleanupAllMCPClientsEffect();
    });
  }

  /**
   * Effect-wrapped cleanup for all MCP clients
   */
  private cleanupAllMCPClientsEffect(): Effect.Effect<void> {
    const self = this;
    return Effect.tryPromise(() => self.factory.cleanupAllMCPClients()).pipe(
      Effect.catchAll(() => Effect.void)
    );
  }

  setTracer(tracer?: Tracer): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.tracer = tracer;
      self.factory.setTracer(tracer);
    });
  }

  setDefaultSystemMessage(systemMessage?: string): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.defaultSystemMessage = systemMessage;
      self.factory.setDefaultSystemMessage(systemMessage);
    });
  }

  setGlobalVariablesResolver(resolver: () => Record<string, string | number | boolean>): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.setGlobalVariablesResolver(resolver);
    });
  }

  setTemplateEngine(engine: TemplateEngine): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.setTemplateEngine(engine);
    });
  }

  setTemplateCustomNamespaces(namespaces: Record<string, unknown>): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.setTemplateCustomNamespaces(namespaces);
    });
  }

  setTemplateEnvAllowlist(envAllowlist: string[]): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.setEnvAllowlist(envAllowlist);
    });
  }

  setTemplateFredConfig(config: Partial<FrameworkConfig>): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.setTemplateFredConfig(config);
    });
  }

  matchAgentByUtterance(
    message: string,
    semanticMatcher?: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>
  ): Effect.Effect<{ agentId: string; confidence: number; matchType: 'exact' | 'regex' | 'semantic' } | null> {
    const self = this;
    return Effect.gen(function* () {
      const agents = yield* Ref.get(self.agents);
      const normalizedMessage = message.toLowerCase().trim();

      // Get all agents with utterances
      const agentsWithUtterances = Array.from(agents.values()).filter(
        agent => agent.config.utterances && agent.config.utterances.length > 0
      );

      // Try exact match first
      for (const agent of agentsWithUtterances) {
        const utterances = agent.config.utterances!;
        for (const utterance of utterances) {
          if (normalizedMessage === utterance.toLowerCase().trim()) {
            return {
              agentId: agent.id,
              confidence: 1.0,
              matchType: 'exact' as const,
            };
          }
        }
      }

      // Try regex match using Effect.try with catchAll for proper error handling
      for (const agent of agentsWithUtterances) {
        const utterances = agent.config.utterances!;
        for (const utterance of utterances) {
          const regexResult = yield* Effect.try(() => {
            const regex = new RegExp(utterance, 'i');
            return regex.test(message);
          }).pipe(
            Effect.catchAll(() => Effect.succeed(false)) // Invalid regex, treat as no match
          );
          if (regexResult) {
            return {
              agentId: agent.id,
              confidence: 0.8,
              matchType: 'regex' as const,
            };
          }
        }
      }

      // Try semantic matching if provided
      if (semanticMatcher) {
        for (const agent of agentsWithUtterances) {
          const utterances = agent.config.utterances!;
          const result = yield* self.runSemanticMatcher(semanticMatcher, message, utterances);
          if (result.matched) {
            return {
              agentId: agent.id,
              confidence: result.confidence,
              matchType: 'semantic' as const,
            };
          }
        }
      }

      return null;
    });
  }

  /**
   * Effect-wrapped semantic matcher invocation
   */
  private runSemanticMatcher(
    matcher: (message: string, utterances: string[]) => Promise<{ matched: boolean; confidence: number; utterance?: string }>,
    message: string,
    utterances: string[]
  ): Effect.Effect<{ matched: boolean; confidence: number; utterance?: string }> {
    return Effect.tryPromise(() => matcher(message, utterances)).pipe(
      Effect.catchAll(() => Effect.succeed({ matched: false, confidence: 0 }))
    );
  }

  getMCPMetrics(): Effect.Effect<any> {
    const self = this;
    return Effect.sync(() => self.factory.getMCPMetrics());
  }

  registerShutdownHooks(): Effect.Effect<void> {
    const self = this;
    return Effect.sync(() => {
      self.factory.registerShutdownHooks();
    });
  }
}

/**
 * Live layer providing AgentService with dependencies on ToolRegistryService and ProviderRegistryService
 */
export const AgentServiceLive = Layer.effect(
  AgentService,
  Effect.gen(function* () {
    const agents = yield* Ref.make(new Map<string, AgentInstance>());
    const toolRegistryService = yield* ToolRegistryService;
    const providerRegistryService = yield* ProviderRegistryService;
    const toolGateService = yield* ToolGateService;
    return new AgentServiceImpl(agents, toolRegistryService, providerRegistryService, toolGateService);
  })
);
