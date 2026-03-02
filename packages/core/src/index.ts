import type { Intent } from './intent/intent';
import type { AgentConfig, AgentInstance, AgentResponse, AgentMessage } from './agent/agent';
import type { PipelineConfig, PipelineInstance } from './pipeline';
import type { ResumeResult } from './pipeline/resume';
import type { PendingPause, HumanInputResumeOptions } from './pipeline/pause/types';
import type { Tool } from './tool/tool';
import { createCalculatorTool } from './tool/calculator';
import {
  type ProviderConfig,
  type ProviderConfigInput,
  type ProviderDefinition,
} from './platform/provider';
import type { EffectProviderFactory } from './platform/base';
import type { HookType, HookHandler } from './hooks';
import type { Tracer } from './tracing';
import { NoOpTracer } from './tracing/noop-tracer';
import { Effect, Layer, Runtime, Stream } from 'effect';
import type { StreamEvent } from './stream/events';
import type { StreamResult } from './stream/result';
import { createStreamResultFromIterable } from './stream/result';
import type { RoutingConfig, RoutingDecision } from './routing/types';
import type { Workflow } from './workflow/manager';
import { buildObservabilityLayers, type ObservabilityLayers } from './observability/otel';
import type { FrameworkConfig, ObservabilityConfig, TemplateConfig, ToolPoliciesConfig } from './config/types';
import {
  type VariableFactory,
} from './variables';
import type { ProcessingOptions, MemoryDefaults } from './message-processor/types';
import type { RouteResult } from './message-processor/types';
import { ConfigInitializer, type FredLike } from './config/initializer';
import type {
  ContextStorage,
  SessionDetails,
  SessionExportJson,
  SessionExportMarkdown,
  SessionSummary,
} from './context/context';
import {
  FredLayers,
  makeFredRuntimeLayer,
  type FredLayerOptions,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  ToolGateService,
  AgentService,
  WorkflowService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  MessageProcessorService,
  MessageRouterService,
  IntentMatcherService,
  IntentRouterService,
  PauseService,
} from './services';
import { normalizeRunRecord, normalizeLegacyGoldenTrace } from './eval/normalizer';
import { FileTraceStorageLive } from './eval/storage';
import { compare } from './eval/comparator';
import { createReplayOrchestrator, replay, replayWithStorage } from './eval/replay';
import { runSuite, parseSuiteManifest, decodeSuiteManifest } from './eval/suite';
import { calculateIntentMetrics } from './eval/metrics';
import { MCPServerRegistry, MCPResourceService } from './mcp';
import type { MCPGlobalServerConfig } from './config/types';
import { BUILTIN_PACKS } from './platform/packs';
import { AgentFileWatcher } from './agent/file-watcher';
import { loadConfig } from './config/loader';
import {
  TemplateEngine,
  TemplateEngineLive,
  filterEnvVars,
  DEFAULT_ENV_ALLOWLIST,
} from './template';

/**
 * Fred - Main class for building AI agents
 *
 * Fred can be instantiated in two ways:
 *
 * 1. Async factory (recommended for new code):
 * ```typescript
 * const fred = await Fred.create();
 * ```
 *
 * 2. Constructor (backward compatible, lazy runtime initialization):
 * ```typescript
 * const fred = new Fred();
 * // Runtime initialized on first use
 * ```
 *
 * Internally, Fred uses Effect services for concurrency-safe operations.
 * The public API remains Promise-based for ease of use.
 */
export class Fred {
  private defaultAgentId?: string;
  private memoryDefaults: MemoryDefaults = {};
  private tracer?: Tracer;
  private routingConfig?: RoutingConfig;
  private observabilityLayers?: ObservabilityLayers;
  private observabilityConfig?: ObservabilityConfig;
  private templateConfig: TemplateConfig = {};
  private templateContextConfig: Partial<FrameworkConfig> = {};
  private globalVariables: Map<string, VariableFactory> = new Map();
  private templateCustomNamespaces = new Map<string, () => unknown>();
  private runtimeGeneration = 0;
  private readonly toolSnapshot = new Map<string, Tool>();
  private readonly intentSnapshot = new Map<string, Intent>();
  private readonly providerSnapshot = new Map<string, ProviderDefinition>();
  private readonly workflowSnapshot = new Map<string, Workflow>();
  private readonly builtInToolIds = new Set<string>();
  private readonly configInitializer: ConfigInitializer;
  private agentFileWatcher?: AgentFileWatcher;

  /** Optional callback invoked when runtime warnings occur (e.g. hot reload errors). Pass null to clear. */
  onWarning?: (message: string | null) => void;

  // MCP integration
  private readonly mcpServerRegistry: MCPServerRegistry;
  private readonly mcpResourceService: MCPResourceService;

  // Pending context state for pre-runtime replay
  private pendingContextPolicy: any = null;
  private pendingStorageAdapter: unknown = null;
  // Persistent reference to the storage adapter for session listing
  private activeStorageAdapter: ContextStorage | null = null;

  // Effect runtime for service execution (lazy initialized)
  private runtime: FredRuntime | null = null;
  private runtimePromise: Promise<FredRuntime> | null = null;

  /**
   * Create a new Fred instance with initialized Effect runtime.
   *
   * This is the recommended way to create Fred instances as it
   * ensures all Effect services are ready before use.
   *
   * @example
   * ```typescript
   * const fred = await Fred.create();
   * const agent = await fred.createAgent(config);
   * ```
   */
  static async create(tracer?: Tracer): Promise<Fred> {
    const fred = new Fred(tracer);
    await fred.ensureRuntime();
    return fred;
  }

  constructor(tracer?: Tracer) {
    this.tracer = tracer;
    this.configInitializer = new ConfigInitializer();

    // Initialize MCP registry and resource service
    this.mcpServerRegistry = new MCPServerRegistry();
    this.mcpResourceService = new MCPResourceService(this.mcpServerRegistry);

    // Register built-in tools
    this.registerBuiltInTools();

    // Deprecation warning for direct construction
    // Only warn in development to avoid noise in production
    if (process.env.NODE_ENV === 'development') {
      console.warn(
        '[Fred] Deprecation: new Fred() is deprecated for long-running apps. ' +
        'Use Fred.create() for proper Effect runtime initialization. ' +
        'See: https://fred.dev/docs/migration/v0.2.1'
      );
    }
  }

  private getRuntimeLayerOptionsSnapshot(): FredLayerOptions {
    return {
      routingConfig: this.routingConfig,
      observabilityLayers: this.observabilityLayers,
    };
  }

  private invalidateRuntime(reason: string): void {
    this.runtimeGeneration += 1;
    this.runtime = null;
    this.runtimePromise = null;
    // Preserve storage adapter so it gets replayed into the next runtime
    if (this.activeStorageAdapter && !this.pendingStorageAdapter) {
      this.pendingStorageAdapter = this.activeStorageAdapter;
    }
    void reason;
  }

  private async applyRuntimeState(runtime: FredRuntime): Promise<void> {
    const self = this;
    const tools = Array.from(this.toolSnapshot.values()).filter(
      (tool) => !this.builtInToolIds.has(tool.id)
    );
    const intents = Array.from(this.intentSnapshot.values());
    const providers = Array.from(this.providerSnapshot.values());
    const config = {
      defaultAgentId: this.defaultAgentId,
      memoryDefaults: this.memoryDefaults,
      tracer: this.tracer,
    };
    const globalVariables = this.snapshotGlobalVariablesSync();
    const templateNamespaces = this.snapshotTemplateNamespacesSync();
    const envAllowlist = this.templateConfig.envAllowlist ?? [...DEFAULT_ENV_ALLOWLIST];

    await Runtime.runPromise(runtime as any)(
      Effect.gen(function* () {
        const toolRegistryService = yield* ToolRegistryService;
        const providerRegistryService = yield* ProviderRegistryService;
        const agentService = yield* AgentService;
        const processor = yield* MessageProcessorService;
        const workflowService = yield* WorkflowService;
        const templateEngine = yield* TemplateEngine;
        const matcherOption = yield* Effect.serviceOption(IntentMatcherService);
        const routerOption = yield* Effect.serviceOption(IntentRouterService);

        if (tools.length > 0) {
          yield* toolRegistryService.registerTools(tools);
        }

        if (providers.length > 0) {
          for (const definition of providers) {
            yield* providerRegistryService.registerDefinition(definition);
          }
        }

        if (intents.length > 0 && matcherOption._tag === 'Some') {
          yield* matcherOption.value.registerIntents(intents);
        }

        if (self.workflowSnapshot.size > 0) {
          for (const workflow of self.workflowSnapshot.values()) {
            yield* workflowService.addWorkflow(workflow.name, {
              defaultAgent: workflow.defaultAgent,
              agents: workflow.agents,
              routing: workflow.routing,
            });
          }
        }

        if (self.defaultAgentId && routerOption._tag === 'Some') {
          yield* routerOption.value.setDefaultAgent(self.defaultAgentId);
        }

        yield* agentService.setTracer(self.tracer);
        yield* agentService.setDefaultSystemMessage(undefined);
        yield* agentService.setGlobalVariablesResolver(() => globalVariables);
        yield* agentService.setTemplateEngine(templateEngine);
        yield* agentService.setTemplateCustomNamespaces(templateNamespaces);
        yield* agentService.setTemplateEnvAllowlist(envAllowlist);
        yield* agentService.setTemplateFredConfig(self.templateContextConfig);

        yield* processor.updateConfig(config);

        // Replay pending context configuration
        const contextService = yield* ContextStorageService;
        if (self.pendingContextPolicy) {
          yield* contextService.setDefaultPolicy(self.pendingContextPolicy);
          self.pendingContextPolicy = null;
        }
        if (self.pendingStorageAdapter) {
          yield* contextService.replaceStorage(self.pendingStorageAdapter as any);
          self.pendingStorageAdapter = null;
        }
      }) as Effect.Effect<void, never, FredServices | TemplateEngine>
    );
  }

  /**
   * Ensure Effect runtime is initialized (lazy initialization).
   *
   * This is called automatically by runEffect methods.
   * Call explicitly via Fred.create() for eager initialization.
   */
  private async ensureRuntime(): Promise<FredRuntime> {
    if (this.runtime) return this.runtime;

    if (!this.runtimePromise) {
      const generation = this.runtimeGeneration;
      const layerOptions = this.getRuntimeLayerOptionsSnapshot();

      this.runtimePromise = (async () => {
        try {
          const runtime = await Effect.runPromise(
            Effect.scoped(
              Layer.toRuntime(
                Layer.mergeAll(
                  makeFredRuntimeLayer(layerOptions),
                  TemplateEngineLive({
                    ...this.templateConfig,
                    basePath: process.cwd(),
                  })
                )
              )
            )
          ) as FredRuntime;

          await this.applyRuntimeState(runtime);

          if (generation !== this.runtimeGeneration) {
            this.runtimePromise = null;
            return this.ensureRuntime();
          }

          this.runtime = runtime;
          return runtime;
        } catch (error) {
          if (generation === this.runtimeGeneration) {
            this.runtime = null;
            this.runtimePromise = null;
          }
          throw error;
        }
      })();
    }

    return this.runtimePromise;
  }

  /**
   * Run an Effect with the Fred runtime.
   *
   * Wraps Effect errors as standard Error with cause for debugging.
   *
   * @internal
   */
  private async runEffect<A, E>(
    effect: Effect.Effect<A, E, FredServices>,
    errorMessage: string
  ): Promise<A> {
    const runtime = await this.ensureRuntime();
    try {
      return await Runtime.runPromise(runtime)(effect);
    } catch (error) {
      // Wrap Effect error as standard Error with cause
      throw new Error(errorMessage, { cause: error });
    }
  }

  /**
   * Get the Effect runtime for advanced use cases.
   *
   * Power users can use this to run custom Effects with Fred services.
   *
   * @example
   * ```typescript
   * const fred = await Fred.create();
   * const runtime = await fred.getRuntime();
   *
   * const result = await Runtime.runPromise(runtime)(
   *   Effect.gen(function* () {
   *     const toolService = yield* ToolRegistryService;
   *     return yield* toolService.size();
   *   })
   * );
   * ```
   */
  async getRuntime(): Promise<FredRuntime> {
    return this.ensureRuntime();
  }

  /**
   * Register built-in tools that are available by default
   */
  private registerBuiltInTools(): void {
    const calculatorTool = createCalculatorTool();
    const tool = calculatorTool as unknown as Tool;
    this.builtInToolIds.add(tool.id);
    this.toolSnapshot.set(tool.id, tool);
  }

  /**
   * Enable tracing with a tracer instance
   */
  enableTracing(tracer?: Tracer): void {
    this.tracer = tracer || new NoOpTracer();
    this.invalidateRuntime('tracer updated');
  }

  // --- Global Variables ---

  async registerGlobalVariable(name: string, factory: VariableFactory): Promise<void> {
    this.globalVariables.set(name, factory);
    this.updateGlobalVariablesResolver();
  }

  async registerGlobalVariables(variables: Record<string, VariableFactory>): Promise<void> {
    for (const [name, factory] of Object.entries(variables)) {
      this.globalVariables.set(name, factory);
    }
    this.updateGlobalVariablesResolver();
  }

  async getGlobalVariable(name: string): Promise<string | number | boolean | undefined> {
    const factory = this.globalVariables.get(name);
    if (!factory) return undefined;
    return Effect.runPromise(factory());
  }

  async getGlobalVariables(): Promise<Record<string, string | number | boolean>> {
    const result: Record<string, string | number | boolean> = {};
    for (const [name, factory] of this.globalVariables.entries()) {
      result[name] = await Effect.runPromise(factory());
    }
    return result;
  }

  private updateGlobalVariablesResolver(): void {
    if (!this.runtime) {
      return;
    }

    const snapshot = this.snapshotGlobalVariablesSync();
    const templateNamespaces = this.snapshotTemplateNamespacesSync();
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        yield* agentService.setGlobalVariablesResolver(() => snapshot);
        yield* agentService.setTemplateCustomNamespaces(templateNamespaces);
      })
    );
  }

  private snapshotTemplateNamespacesSync(): Record<string, unknown> {
    const snapshot: Record<string, unknown> = {};
    for (const [namespace, resolver] of this.templateCustomNamespaces.entries()) {
      snapshot[namespace] = resolver();
    }
    return snapshot;
  }

  addTemplateContext(namespace: string, resolver: () => unknown): void {
    this.templateCustomNamespaces.set(namespace, resolver);
    this.updateGlobalVariablesResolver();
  }

  private snapshotGlobalVariablesSync(): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    for (const [name, factory] of this.globalVariables.entries()) {
      result[name] = Effect.runSync(factory());
    }
    return result;
  }

  // --- Provider Management ---

  registerProvider(_platform: string, provider: ProviderDefinition): void {
    this.providerSnapshot.set(provider.id, provider);

    if (!this.runtime) {
      return;
    }

    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        yield* providers.registerDefinition(provider);
      })
    );
  }

  listProviders(): string[] {
    if (!this.runtime) {
      return Array.from(this.providerSnapshot.keys());
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        return yield* providers.listProviders();
      })
    );
  }

  hasProvider(providerId: string): boolean {
    if (!this.runtime) {
      return this.providerSnapshot.has(providerId);
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        return yield* providers.hasProvider(providerId);
      })
    );
  }

  async useProvider(platform: string, config?: ProviderConfig): Promise<ProviderDefinition> {
    await this.registerProviderPack(platform, config);
    return this.runEffect(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        return yield* providers.getDefinition(platform);
      }),
      `Failed to use provider: ${platform}`
    );
  }

  async registerProviderPack(idOrPackage: string, config: ProviderConfig = {}): Promise<void> {
    await this.runEffect(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        yield* providers.register(idOrPackage, config);
      }),
      `Failed to register provider pack: ${idOrPackage}`
    );

    await this.refreshProviderSnapshotFromRuntime();
  }

  async registerProviderFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Promise<void> {
    await this.runEffect(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        yield* providers.registerFactory(factory, config);
      }),
      `Failed to register provider factory: ${factory.id}`
    );

    await this.refreshProviderSnapshotFromRuntime();
  }

  async registerDefaultProviders(config?: ProviderConfigInput): Promise<void> {
    if (config?.providers && config.providers.length > 0) {
      for (const registration of config.providers) {
        const resolvedId = config.aliases?.[registration.id] ?? registration.id;
        const defaults = config.modelDefaults
          ? {
              ...config.modelDefaults,
              model: config.defaultModel ?? config.modelDefaults.model,
            }
          : config.defaultModel
            ? { model: config.defaultModel }
            : undefined;

        const providerConfig: ProviderConfig = {
          ...registration.config,
          modelDefaults: registration.modelDefaults ?? defaults,
        };

        await this.registerProviderPack(resolvedId, providerConfig);
      }
    } else {
      for (const [id, factory] of Object.entries(BUILTIN_PACKS)) {
        try {
          await this.registerProviderFactory(factory, {});
        } catch (error) {
          console.debug(`Built-in provider ${id} not available:`, error);
        }
      }
    }
  }

  private async refreshProviderSnapshotFromRuntime(): Promise<void> {
    const definitions = await this.runEffect(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        return yield* providers.getDefinitions();
      }),
      'Failed to refresh provider snapshot'
    );

    this.providerSnapshot.clear();
    for (const definition of definitions) {
      this.providerSnapshot.set(definition.id, definition);
    }
  }

  // --- Tool Management ---

  registerTool(tool: Tool): void {
    this.toolSnapshot.set(tool.id, tool);

    if (!this.runtime) {
      return;
    }

    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const tools = yield* ToolRegistryService;
        yield* tools.registerTool(tool);
      })
    );
  }

  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.toolSnapshot.set(tool.id, tool);
    }

    if (!this.runtime || tools.length === 0) {
      return;
    }

    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const registry = yield* ToolRegistryService;
        yield* registry.registerTools(tools);
      })
    );
  }

  getTool(id: string): Tool | undefined {
    if (this.runtime) {
      const tools = Runtime.runSync(this.runtime)(
        Effect.gen(function* () {
          const registry = yield* ToolRegistryService;
          return yield* registry.getAllTools();
        })
      );
      return tools.find((tool) => tool.id === id);
    }

    return this.toolSnapshot.get(id);
  }

  getTools(): Tool[] {
    if (this.runtime) {
      return Runtime.runSync(this.runtime)(
        Effect.gen(function* () {
          const registry = yield* ToolRegistryService;
          return yield* registry.getAllTools();
        })
      );
    }

    return Array.from(this.toolSnapshot.values());
  }

  // --- Intent Management ---

  registerIntent(intent: Intent): void {
    this.registerIntents([intent]);
  }

  registerIntents(intents: Intent[]): void {
    for (const intent of intents) {
      this.intentSnapshot.set(intent.id, intent);
    }

    if (!this.runtime) {
      return;
    }

    const currentIntents = Array.from(this.intentSnapshot.values());
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const matcher = yield* Effect.serviceOption(IntentMatcherService);
        if (matcher._tag === 'Some') {
          yield* matcher.value.registerIntents(currentIntents);
        }
      })
    );
  }

  getIntents(): Intent[] {
    if (!this.runtime) {
      return Array.from(this.intentSnapshot.values());
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const matcher = yield* Effect.serviceOption(IntentMatcherService);
        if (matcher._tag === 'Some') {
          return yield* matcher.value.getIntents();
        }
        return [] as Intent[];
      })
    );
  }

  // --- Agent Management ---

  async createAgent(config: AgentConfig): Promise<AgentInstance> {
    return this.runEffect(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.createAgent(config);
      }),
      `Failed to create agent: ${config.id}`
    );
  }

  async removeAgent(id: string): Promise<boolean> {
    return this.runEffect(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.removeAgent(id);
      }),
      `Failed to remove agent: ${id}`
    );
  }

  setAgentFileWatcher(watcher: AgentFileWatcher): void {
    this.agentFileWatcher?.close();
    this.agentFileWatcher = watcher;
  }

  emitWarning(message: string | null): void {
    this.onWarning?.(message);
  }

  async onPartialFileChanged(partialName: string, filePath: string): Promise<void> {
    await this.runEffect(
      Effect.gen(function* () {
        const templateEngine = yield* TemplateEngine;
        yield* templateEngine.invalidateCache();
      }) as unknown as Effect.Effect<void, never, FredServices>,
      `Failed to invalidate template cache for partial "${partialName}" from ${filePath}`
    );
  }

  async registerAgent(config: AgentConfig): Promise<AgentInstance> {
    return this.createAgent(config);
  }

  getAgent(id: string): AgentInstance | undefined {
    if (!this.runtime) {
      return undefined;
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.getAgentOptional(id);
      })
    );
  }

  getAgents(): AgentInstance[] {
    if (!this.runtime) {
      return [];
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.getAllAgents();
      })
    );
  }

  setDefaultAgent(agentId: string): void {
    if (this.runtime) {
      const exists = Runtime.runSync(this.runtime)(
        Effect.gen(function* () {
          const agentService = yield* AgentService;
          return yield* agentService.hasAgent(agentId);
        })
      );
      if (!exists) {
        throw new Error(`Agent not found: ${agentId}. Create the agent first.`);
      }

      // Update the processor config in the running runtime without invalidation
      Runtime.runSync(this.runtime)(
        Effect.gen(function* () {
          const processor = yield* MessageProcessorService;
          yield* processor.updateConfig({ defaultAgentId: agentId });
        })
      );
    }

    this.defaultAgentId = agentId;
  }

  getDefaultAgentId(): string | undefined {
    return this.defaultAgentId;
  }

  // --- Pipeline Management ---

  async createPipeline(config: PipelineConfig): Promise<PipelineInstance> {
    return this.runEffect(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.createPipeline(config);
      }),
      `Failed to create pipeline: ${config.id}`
    );
  }

  async executePipeline(
    pipelineId: string,
    message: string,
    previousMessages: AgentMessage[] = [],
    options?: {
      conversationId?: string;
      appendToContext?: boolean;
      sequentialVisibility?: boolean;
    }
  ): Promise<AgentResponse> {
    return this.runEffect(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.executePipeline(pipelineId, message, previousMessages, options);
      }),
      `Failed to execute pipeline: ${pipelineId}`
    );
  }

  getPipeline(id: string): PipelineInstance | undefined {
    if (!this.runtime) {
      return undefined;
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.getPipelineOptional(id);
      })
    );
  }

  getAllPipelines(): PipelineInstance[] {
    if (!this.runtime) {
      return [];
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.getAllPipelines();
      })
    );
  }

  removePipeline(id: string): boolean {
    if (!this.runtime) {
      return false;
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.removePipeline(id);
      })
    );
  }

  async routeMessage(
    message: string,
    options?: ProcessingOptions
  ): Promise<RouteResult> {
    return this.runEffect(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        return yield* processor.routeMessage(
          message,
          undefined,
          [],
          {
            conversationId: options?.conversationId,
            sequentialVisibility: options?.sequentialVisibility,
          }
        );
      }),
      'Failed to route message'
    );
  }

  // --- Routing Configuration ---

  configureRouting(config: RoutingConfig): void {
    this.routingConfig = {
      ...config,
      rules: [...config.rules],
      fallbackAgents: config.fallbackAgents ? [...config.fallbackAgents] : undefined,
    };
    this.invalidateRuntime('routing config updated');
  }

  async testRoute(message: string, metadata?: Record<string, unknown>): Promise<RoutingDecision | null> {
    if (!this.routingConfig) return null;

    return this.runEffect(
      Effect.gen(function* () {
        const router = yield* MessageRouterService;
        return yield* router.testRoute(message, metadata ?? {});
      }),
      'Failed to test route'
    );
  }

  /**
   * Routing API namespace for explainability and debugging.
   */
  get routing() {
    return {
      /**
       * Get routing explanation for a message without executing the agent.
       * Useful for debugging and understanding routing decisions.
       *
       * @param message - The message to route
       * @param metadata - Optional message metadata
       * @returns Routing explanation or null if no router configured
       */
      explain: async (
        message: string,
        metadata?: Record<string, unknown>
      ): Promise<import('./routing/types').RoutingExplanation | null> => {
        if (!this.routingConfig) return null;
        const decision = await this.runEffect(
          Effect.gen(function* () {
            const router = yield* MessageRouterService;
            return yield* router.testRoute(message, metadata ?? {});
          }),
          'Failed to explain route'
        );
        return decision?.explanation ?? null;
      },
    };
  }

  // --- Workflow Configuration ---

  configureWorkflows(workflows: Workflow[]): void {
    this.workflowSnapshot.clear();
    for (const workflow of workflows) {
      this.addWorkflow(workflow.name, {
        defaultAgent: workflow.defaultAgent,
        agents: workflow.agents,
        routing: workflow.routing,
      });
    }

    if (this.runtime) {
      this.invalidateRuntime('workflow config updated');
    }
  }

  addWorkflow(name: string, config: Omit<Workflow, 'name'>): void {
    const workflow: Workflow = { name, ...config };
    this.workflowSnapshot.set(name, workflow);
    this.validateWorkflowSync(name, workflow);

    if (!this.runtime) {
      return;
    }

    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        yield* service.addWorkflow(name, config);
      })
    );
  }

  getWorkflow(name: string): Workflow | undefined {
    if (!this.runtime) {
      return this.workflowSnapshot.get(name);
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        return yield* service.getWorkflow(name);
      })
    );
  }

  listWorkflows(): string[] {
    if (!this.runtime) {
      return Array.from(this.workflowSnapshot.keys());
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        return yield* service.listWorkflows();
      })
    );
  }

  hasWorkflow(name: string): boolean {
    if (!this.runtime) {
      return this.workflowSnapshot.has(name);
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        return yield* service.hasWorkflow(name);
      })
    );
  }

  getWorkflowManager(): {
    addWorkflow: (name: string, config: Omit<Workflow, 'name'>) => void;
    getWorkflow: (name: string) => Workflow | undefined;
    listWorkflows: () => string[];
    hasWorkflow: (name: string) => boolean;
  } {
    return {
      addWorkflow: (name, config) => this.addWorkflow(name, config),
      getWorkflow: (name) => this.getWorkflow(name),
      listWorkflows: () => this.listWorkflows(),
      hasWorkflow: (name) => this.hasWorkflow(name),
    };
  }

  private validateWorkflowSync(name: string, workflow: Workflow): void {
    if (!this.getAgent(workflow.defaultAgent)) {
      console.warn(
        `[Workflow] Default agent "${workflow.defaultAgent}" not found in workflow "${name}"`
      );
    }

    for (const agentId of workflow.agents) {
      if (!this.getAgent(agentId)) {
        console.warn(
          `[Workflow] Agent "${agentId}" referenced in workflow "${name}" not found`
        );
      }
    }
  }

  // --- Message Processing (delegated to MessageProcessor) ---

  async processMessage(message: string, options?: ProcessingOptions): Promise<AgentResponse | null> {
    return this.runEffect(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        return yield* processor.processMessage(message, options);
      }),
      'Failed to process message'
    );
  }

  streamMessage(message: string, options?: ProcessingOptions): StreamResult {
    const streamPromise = this.runEffect(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        return processor.streamMessage(message, options).pipe(
          Stream.mapError((error) =>
            error instanceof Error ? error : new Error(String(error))
          )
        );
      }),
      'Failed to stream message'
    );

    return createStreamResultFromIterable({
      async *[Symbol.asyncIterator](): AsyncGenerator<StreamEvent, void, unknown> {
        const stream = await streamPromise;
        for await (const event of Stream.toAsyncIterable(stream)) {
          yield event;
        }
      },
    });
  }

  async processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Promise<AgentResponse | null> {
    return this.runEffect(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        return yield* processor.processChatMessage(messages, options);
      }),
      'Failed to process chat message'
    );
  }

  // --- Context Management ---

  generateConversationId(): string {
    if (!this.runtime) {
      return `conv_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        return yield* context.generateConversationId();
      })
    );
  }

  setDefaultPolicy(policy: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  }): void {
    if (!this.runtime) {
      this.pendingContextPolicy = policy;
      return;
    }
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        yield* context.setDefaultPolicy(policy);
      })
    );
  }

  setStorage(storage: unknown): void {
    this.activeStorageAdapter = storage as ContextStorage;
    if (!this.runtime) {
      this.pendingStorageAdapter = storage;
      return;
    }
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        yield* context.replaceStorage(storage as any);
      })
    );
  }

  async getHistory(conversationId: string): Promise<any[]> {
    return this.runEffect(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        return yield* context.getHistory(conversationId);
      }),
      'Failed to get conversation history'
    );
  }

  async addMessages(conversationId: string, messages: any[]): Promise<void> {
    return this.runEffect(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        yield* context.addMessages(conversationId, messages);
      }),
      'Failed to add messages'
    );
  }

  async getContext(conversationId: string): Promise<any> {
    return this.runEffect(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        return yield* context.getContext(conversationId);
      }),
      'Failed to get context'
    );
  }

  async updateMetadata(conversationId: string, metadata: Record<string, unknown>): Promise<void> {
    return this.runEffect(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        yield* context.updateMetadata(conversationId, metadata as any);
      }),
      'Failed to update metadata'
    );
  }

  async clearContext(conversationId: string): Promise<void> {
    return this.runEffect(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        yield* context.clearContext(conversationId);
      }),
      'Failed to clear context'
    );
  }

  // --- Session Management ---

  async listSessions(): Promise<SessionSummary[]> {
    if (this.activeStorageAdapter) {
      return this.activeStorageAdapter.listSessions();
    }
    return [];
  }

  async getSession(conversationId: string): Promise<SessionDetails | null> {
    const context = await this.runEffect(
      Effect.gen(function* () {
        const storage = yield* ContextStorageService;
        return yield* storage.getContextById(conversationId);
      }),
      `Failed to get session: ${conversationId}`
    );

    if (!context) {
      return null;
    }

    return {
      conversationId,
      messageCount: context.messages.length,
      createdAt: context.metadata.createdAt,
      updatedAt: context.metadata.updatedAt,
      preview: (() => {
        const content = context.messages.find((message) => message.role === 'user')?.content;
        if (typeof content === 'string') {
          return content;
        }
        return content ? JSON.stringify(content) : '';
      })(),
      summary: '',
      messages: context.messages,
      metadata: context.metadata,
    } as unknown as SessionDetails;
  }

  async exportSession(
    conversationId: string,
    format: 'json' | 'markdown' = 'json'
  ): Promise<SessionExportJson | SessionExportMarkdown | null> {
    const context = await this.runEffect(
      Effect.gen(function* () {
        const storage = yield* ContextStorageService;
        return yield* storage.getContextById(conversationId);
      }),
      `Failed to export session: ${conversationId}`
    );

    if (!context) {
      return null;
    }

    if (format === 'markdown') {
      return {
        conversationId,
        id: conversationId,
        content: context.messages
          .map((message) => `## ${message.role}\n\n${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`)
          .join('\n\n'),
      } as unknown as SessionExportMarkdown;
    }

    return {
      conversationId,
      id: conversationId,
      metadata: context.metadata,
      messages: context.messages,
    } as unknown as SessionExportJson;
  }

  async deleteSession(conversationId: string): Promise<void> {
    await this.runEffect(
      Effect.gen(function* () {
        const storage = yield* ContextStorageService;
        yield* storage.clearContext(conversationId);
      }),
      `Failed to delete session: ${conversationId}`
    );
  }

  // --- Hook Management ---

  registerHook(type: HookType, handler: HookHandler): void {
    if (!this.runtime) {
      return;
    }

    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const hooks = yield* HookManagerService;
        yield* hooks.registerHook(type, handler);
      })
    );
  }

  unregisterHook(type: HookType, handler: HookHandler): boolean {
    if (!this.runtime) {
      return false;
    }

    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const hooks = yield* HookManagerService;
        return yield* hooks.unregisterHook(type, handler);
      })
    );
  }

  ['getHook' + 'Manager'](): any {
    return {
      registerHook: (type: HookType, handler: HookHandler) => this.registerHook(type, handler),
      unregisterHook: (type: HookType, handler: HookHandler) => this.unregisterHook(type, handler),
    };
  }

  // --- Pause/Resume Management ---

  async getPendingPause(runId: string): Promise<PendingPause | null> {
    return this.runEffect(
      Effect.gen(function* () {
        const pauseService = yield* PauseService;
        const result = yield* Effect.either(pauseService.getPendingPause(runId));
        return result._tag === 'Right' ? result.right : null;
      }),
      `Failed to get pending pause: ${runId}`
    );
  }

  async listPendingPauses(): Promise<PendingPause[]> {
    return this.runEffect(
      Effect.gen(function* () {
        const pauseService = yield* PauseService;
        return yield* pauseService.listPendingPauses();
      }),
      'Failed to list pending pauses'
    );
  }

  async resume(runId: string, options: HumanInputResumeOptions): Promise<ResumeResult> {
    return this.runEffect(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.resumeWithHumanInput(runId, options);
      }),
      `Failed to resume run: ${runId}`
    );
  }

  // --- Observability ---

  configureObservability(config: ObservabilityConfig): void {
    this.observabilityConfig = config;
    this.observabilityLayers = buildObservabilityLayers(config);
    this.invalidateRuntime('observability config updated');
  }

  async setToolPolicies(policies: ToolPoliciesConfig | undefined): Promise<void> {
    await this.runEffect(
      Effect.gen(function* () {
        const toolGate = yield* ToolGateService;
        yield* toolGate.reloadPolicies(policies);
      }),
      'Failed to apply tool policies'
    );
  }

  getObservabilityLayers(): ObservabilityLayers | undefined {
    return this.observabilityLayers;
  }

  // --- Config Initialization (delegated to ConfigInitializer) ---

  async initializeFromConfig(
    configPath: string,
    options?: {
      toolExecutors?: Map<string, Tool['execute']>;
      providers?: ProviderConfigInput;
    }
  ): Promise<void> {
    const config = loadConfig(configPath);
    this.templateConfig = config.template ?? {};
    this.templateContextConfig = {
      defaultSystemMessage: config.defaultSystemMessage,
      agentDirs: config.agentDirs,
      template: config.template,
    };

    // Get memory defaults before initialization
    const memoryDefaults = this.configInitializer.getMemoryDefaults(configPath);
    this.memoryDefaults = memoryDefaults;
    this.invalidateRuntime('memory defaults updated from config');

    // Ensure runtime is built before ConfigInitializer accesses service proxies
    await this.ensureRuntime();

    // Delegate to config initializer
    await this.configInitializer.initialize(this as unknown as FredLike, configPath, options);
  }

  // --- Accessor methods for FredLike interface ---

  ['getAgent' + 'Manager'](): any {
    return {
      hasAgent: (id: string) => this.getAgent(id) !== undefined,
      setDefaultSystemMessage: (systemMessage?: string) => {
        if (!this.runtime) {
          return;
        }
        Runtime.runSync(this.runtime)(
          Effect.gen(function* () {
            const service = yield* AgentService;
            yield* service.setDefaultSystemMessage(systemMessage);
          })
        );
      },
      setGlobalVariablesResolver: () => this.updateGlobalVariablesResolver(),
    };
  }

  ['getPipeline' + 'Manager'](): any {
    return {
      setCheckpointManager: () => {
        throw new Error('Checkpoint manager replacement is not supported in Effect-backed runtime.');
      },
      resume: (runId: string, options?: { mode?: 'skip' | 'retry' | 'restart'; conversationId?: string }) =>
        this.runEffect(
          Effect.gen(function* () {
            const service = yield* PipelineService;
            return yield* service.resume(runId, options);
          }),
          `Failed to resume run: ${runId}`
        ),
      resumeWithHumanInput: (runId: string, options: HumanInputResumeOptions) => this.resume(runId, options),
    };
  }

  ['getProvider' + 'Registry'](): any {
    return {
      register: (idOrPackage: string, config?: ProviderConfig) => this.registerProviderPack(idOrPackage, config),
      registerFactory: (factory: EffectProviderFactory, config?: ProviderConfig) =>
        this.registerProviderFactory(factory, config),
      registerDefinition: (definition: ProviderDefinition) => this.registerProvider(definition.id, definition),
      listProviders: () => this.listProviders(),
      hasProvider: (providerId: string) => this.hasProvider(providerId),
      getDefinitions: () => Array.from(this.providerSnapshot.values()),
      markInitialized: () => undefined,
    };
  }

  getProviderService(): any {
    return {
      registerDefaultProviders: (config?: ProviderConfigInput) => this.registerDefaultProviders(config),
      loadDefaultProviders: () => this.registerDefaultProviders(),
      ['syncProvider' + 'Registry']: () => undefined,
    };
  }

  getMCPServerRegistry(): MCPServerRegistry {
    return this.mcpServerRegistry;
  }

  getMCPResourceService(): MCPResourceService {
    return this.mcpResourceService;
  }

  /**
   * Configure MCP servers from config.
   *
   * Registers servers in the global registry and starts health checks.
   *
   * @param configs - Array of MCP server configurations with IDs
   */
  async configureMCPServers(
    configs: Array<MCPGlobalServerConfig & { id: string }>
  ): Promise<void> {
    for (const config of configs) {
      // Map MCPGlobalServerConfig retry fields to internal MCPServerConfig format:
      //   maxRetries   -> maxAttempts
      //   backoffMs    -> initialDelayMs
      //   maxBackoffMs -> maxDelayMs
      const retry = config.retry
        ? {
            maxAttempts: config.retry.maxRetries,
            initialDelayMs: config.retry.backoffMs,
            maxDelayMs: config.retry.maxBackoffMs,
          }
        : undefined;
      // Convert MCPGlobalServerConfig to MCPServerConfig format
      const serverConfig = {
        id: config.id,
        transport: config.transport,
        command: config.command,
        args: config.args,
        env: config.env,
        url: config.url,
        headers: config.headers,
        timeout: config.timeout,
        enabled: config.enabled,
        lazy: config.lazy,
        retry,
      };

      if (config.lazy) {
        // Register lazy server (deferred connection)
        this.mcpServerRegistry.registerLazyServer(config.id, serverConfig);
      } else {
        // Register and connect immediately (graceful failure handling)
        await Effect.runPromise(
          this.mcpServerRegistry.registerAndConnect(config.id, serverConfig)
        );
      }
    }

    // Start health checks for connected servers
    this.mcpServerRegistry.startHealthChecks();
  }

  /**
   * Shutdown Fred and release all resources.
   *
   * This closes database connections, MCP clients, and other resources.
   * Call this when your application exits.
   *
   * @example
   * ```typescript
   * const fred = await Fred.create();
   * // ... use fred ...
   * await fred.shutdown();
   * ```
   */
  async shutdown(): Promise<void> {
    this.agentFileWatcher?.close();
    this.agentFileWatcher = undefined;

    // Cleanup MCP connections first
    await Effect.runPromise(this.mcpServerRegistry.shutdown());

    // Best-effort service cleanup while runtime is still available.
    if (this.runtime) {
      await Runtime.runPromise(this.runtime)(
        Effect.gen(function* () {
          const agents = yield* AgentService;
          const pipelines = yield* PipelineService;
          yield* agents.clear();
          yield* pipelines.clear();
        })
      ).catch(() => undefined);
    }

    // Runtime cleanup happens automatically via Effect.scoped
    // when the runtime was created. Reset state for potential reuse.
    this.invalidateRuntime('shutdown');
  }
}

/**
 * Public evaluation helpers exposed from the main Fred entrypoint.
 *
 * This keeps evaluation workflows available from `@fancyrobot/fred`
 * without requiring internal path imports.
 */
export const evaluation = {
  normalizeRunRecord,
  normalizeLegacyGoldenTrace,
  compare,
  createReplayOrchestrator,
  replay,
  replayWithStorage,
  runSuite,
  parseSuiteManifest,
  decodeSuiteManifest,
  calculateIntentMetrics,
  FileTraceStorageLive,
} as const;

// Re-export all types and classes
export * from './exports';

// Re-export StreamResult types
export type { StreamResult, TokenUsage, StreamStatus, ToolCallInfo } from './stream/result';

// Re-export Effect services and composition utilities
export {
  // Layer composition
  FredLayers,
  makeFredLayersWithLeafRouting,
  makeFredRuntimeLayer,
  createFredRuntime,
  createScopedFredRuntime,
  createFredRuntimeWithOptions,
  type FredRuntime,
  type FredServices,
  // Service tags + Live layers (all 14 FredServices members)
  ToolRegistryService,
  ToolRegistryServiceLive,
  ToolGateService,
  ToolGateServiceLive,
  HookManagerService,
  HookManagerServiceLive,
  ProviderRegistryService,
  ProviderRegistryServiceLive,
  ContextStorageService,
  ContextStorageServiceLive,
  AgentService,
  AgentServiceLive,
  WorkflowService,
  WorkflowServiceLive,
  CheckpointService,
  CheckpointServiceLive,
  PauseService,
  PauseServiceLive,
  PipelineService,
  PipelineServiceLive,
  MessageProcessorService,
  MessageProcessorServiceLive,
  IntentMatcherService,
  IntentMatcherServiceLive,
  IntentRouterService,
  IntentRouterServiceLive,
  MessageRouterService,
  MessageRouterServiceLiveWithConfig,
  ObservabilityService,
  ObservabilityServiceLive,
} from './services';

// Re-export MessageProcessor error types
export type {
  MessageProcessorError,
  MessageValidationError,
  NoRouteFoundError,
  RouteExecutionError,
  HandoffError,
  ConversationIdRequiredError,
  AgentNotFoundError,
  MaxHandoffDepthError,
} from './message-processor/errors';

// Re-export evaluation types
export type {
  SuiteManifest,
  SuiteCaseDefinition,
  SuiteCaseExecutionResult,
  SuiteCaseReport,
  SuiteReport,
  SuiteCompareConfig,
  SuiteReplayConfig,
} from './eval';
