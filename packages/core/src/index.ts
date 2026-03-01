import type { Intent } from './intent/intent';
import { IntentMatcher, createIntentMatcherSync } from './intent/matcher';
import { IntentRouter, createIntentRouterSync } from './intent/router';
import type { AgentConfig, AgentInstance, AgentResponse, AgentMessage } from './agent/agent';
import { AgentManager } from './agent/manager';
import type { PipelineConfig, PipelineInstance } from './pipeline';
import { PipelineManager } from './pipeline/manager';
import type { ResumeResult } from './pipeline/manager';
import type { PendingPause, HumanInputResumeOptions } from './pipeline/pause/types';
import type { Tool } from './tool/tool';
import { ToolRegistry } from './tool/registry';
import { createCalculatorTool } from './tool/calculator';
import {
  type ProviderConfig,
  type ProviderConfigInput,
  type ProviderDefinition,
} from './platform/provider';
import type { EffectProviderFactory } from './platform/base';
import { ProviderRegistry } from './platform/registry';
import { ContextManager } from './context/manager';
import { HookManager } from './hooks';
import type { HookType, HookHandler } from './hooks';
import type { Tracer } from './tracing';
import { NoOpTracer } from './tracing/noop-tracer';
import { Effect, Runtime, Stream } from 'effect';
import type { StreamEvent } from './stream/events';
import type { StreamResult } from './stream/result';
import { createStreamResultFromIterable } from './stream/result';
import { MessageRouter } from './routing/router';
import type { RoutingConfig, RoutingDecision } from './routing/types';
import { WorkflowManager } from './workflow/manager';
import type { Workflow } from './workflow/manager';
import { buildObservabilityLayers, type ObservabilityLayers } from './observability/otel';
import type { ObservabilityConfig } from './config/types';
import type { ToolPoliciesConfig } from './config/types';
import {
  type VariableFactory,
} from './variables';
import { ProviderService } from './provider/service';
import { MessageProcessor } from './message-processor/processor';
import type { ProcessingOptions, MemoryDefaults } from './message-processor/types';
import { ConfigInitializer, type FredLike } from './config/initializer';
import type {
  SessionDetails,
  SessionExportJson,
  SessionExportMarkdown,
  SessionSummary,
} from './context/context';
import {
  FredLayers,
  createFredRuntimeWithOptions,
  type FredLayerOptions,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  ToolGateService,
  MessageProcessorService,
  MessageRouterService,
} from './services';
import { normalizeRunRecord, normalizeLegacyGoldenTrace } from './eval/normalizer';
import { FileTraceStorageLive } from './eval/storage';
import { compare } from './eval/comparator';
import { createReplayOrchestrator, replay, replayWithStorage } from './eval/replay';
import { runSuite, parseSuiteManifest, decodeSuiteManifest } from './eval/suite';
import { calculateIntentMetrics } from './eval/metrics';
import { MCPServerRegistry, MCPResourceService } from './mcp';
import type { MCPGlobalServerConfig } from './config/types';

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
export class Fred implements FredLike {
  private toolRegistry?: ToolRegistry;
  private agentManager?: AgentManager;
  private providerRegistry?: ProviderRegistry;
  private pipelineManager?: PipelineManager;
  private intentMatcher?: IntentMatcher;
  private intentRouter?: IntentRouter;
  private defaultAgentId?: string;
  private contextManager?: ContextManager;
  private memoryDefaults: MemoryDefaults = {};
  private hookManager?: HookManager;
  private tracer?: Tracer;
  private routingConfig?: RoutingConfig;
  private workflowManager?: WorkflowManager;
  private observabilityLayers?: ObservabilityLayers;
  private observabilityConfig?: ObservabilityConfig;
  private globalVariables: Map<string, VariableFactory> = new Map();
  private runtimeGeneration = 0;
  private runtimeInvalidationReason: string | null = null;
  private readonly toolSnapshot = new Map<string, Tool>();
  private readonly builtInToolIds = new Set<string>();

  // Extracted services
  private providerService?: ProviderService;
  private messageProcessor?: MessageProcessor;
  private readonly configInitializer: ConfigInitializer;

  // MCP integration
  private readonly mcpServerRegistry: MCPServerRegistry;
  private readonly mcpResourceService: MCPResourceService;

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
    this.runtimeInvalidationReason = reason;
    this.runtime = null;
    this.runtimePromise = null;
  }

  private async applyRuntimeState(runtime: FredRuntime): Promise<void> {
    const tools = Array.from(this.toolSnapshot.values()).filter(
      (tool) => !this.builtInToolIds.has(tool.id)
    );
    const config = {
      defaultAgentId: this.defaultAgentId,
      memoryDefaults: this.memoryDefaults,
      tracer: this.tracer,
    };

    await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const toolRegistryService = yield* ToolRegistryService;
        const processor = yield* MessageProcessorService;

        if (tools.length > 0) {
          yield* toolRegistryService.registerTools(tools);
        }

        yield* processor.updateConfig(config);
      })
    );
  }

  private ensureLegacyCompat(): void {
    if (this.toolRegistry && this.agentManager && this.providerRegistry && this.pipelineManager && this.intentMatcher && this.intentRouter && this.contextManager && this.hookManager && this.providerService && this.messageProcessor) {
      return;
    }

    this.toolRegistry = new ToolRegistry();
    this.providerRegistry = new ProviderRegistry();
    this.agentManager = new AgentManager(this.toolRegistry, this.tracer);
    this.intentMatcher = createIntentMatcherSync();
    this.intentRouter = createIntentRouterSync(this.agentManager);
    this.contextManager = new ContextManager();
    this.pipelineManager = new PipelineManager(this.agentManager, this.tracer, this.contextManager);
    this.hookManager = new HookManager();

    this.providerService = new ProviderService(this.providerRegistry, this.agentManager);
    this.messageProcessor = new MessageProcessor({
      contextManager: this.contextManager,
      agentManager: this.agentManager,
      pipelineManager: this.pipelineManager,
      intentMatcher: this.intentMatcher,
      intentRouter: this.intentRouter,
      tracer: this.tracer,
      messageRouter: undefined,
      memoryDefaults: this.memoryDefaults,
      defaultAgentId: this.defaultAgentId,
      hookManager: this.hookManager,
      observabilityService: undefined,
    });

    this.agentManager.getAgentFactory().setMCPServerRegistry(this.mcpServerRegistry);

    if (this.tracer) {
      this.hookManager.setTracer(this.tracer);
    }

    for (const tool of this.toolSnapshot.values()) {
      this.toolRegistry.registerTool(tool);
    }

    this.agentManager.registerShutdownHooks();
    this.updateGlobalVariablesResolver();
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
            Effect.scoped(createFredRuntimeWithOptions(layerOptions))
          );

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
    if (this.hookManager) {
      this.hookManager.setTracer(this.tracer);
    }
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
    if (!this.agentManager) {
      return;
    }

    this.agentManager.setGlobalVariablesResolver(() => {
      const result: Record<string, string | number | boolean> = {};
      for (const [name, factory] of this.globalVariables.entries()) {
        result[name] = Effect.runSync(factory());
      }
      return result;
    });
  }

  // --- Provider Management (delegated to ProviderService) ---

  registerProvider(platform: string, provider: ProviderDefinition): void {
    this.ensureLegacyCompat();
    this.providerService!.registerProvider(platform, provider);
  }

  listProviders(): string[] {
    this.ensureLegacyCompat();
    return this.providerService!.listProviders();
  }

  hasProvider(providerId: string): boolean {
    this.ensureLegacyCompat();
    return this.providerService!.hasProvider(providerId);
  }

  async useProvider(platform: string, config?: ProviderConfig): Promise<ProviderDefinition> {
    this.ensureLegacyCompat();
    return this.providerService!.useProvider(platform, config);
  }

  async registerProviderPack(idOrPackage: string, config: ProviderConfig = {}): Promise<void> {
    this.ensureLegacyCompat();
    return this.providerService!.registerProviderPack(idOrPackage, config);
  }

  async registerProviderFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Promise<void> {
    this.ensureLegacyCompat();
    return this.providerService!.registerProviderFactory(factory, config);
  }

  async registerDefaultProviders(config?: ProviderConfigInput): Promise<void> {
    this.ensureLegacyCompat();
    return this.providerService!.registerDefaultProviders(config);
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
    this.ensureLegacyCompat();
    Effect.runSync(this.intentMatcher!.registerIntents([intent]));
  }

  registerIntents(intents: Intent[]): void {
    this.ensureLegacyCompat();
    Effect.runSync(this.intentMatcher!.registerIntents(intents));
  }

  getIntents(): Intent[] {
    this.ensureLegacyCompat();
    return this.intentMatcher!.getIntents();
  }

  // --- Agent Management ---

  async createAgent(config: AgentConfig): Promise<AgentInstance> {
    this.ensureLegacyCompat();
    return this.agentManager!.createAgent(config);
  }

  getAgent(id: string): AgentInstance | undefined {
    this.ensureLegacyCompat();
    return this.agentManager!.getAgent(id);
  }

  getAgents(): AgentInstance[] {
    this.ensureLegacyCompat();
    return this.agentManager!.getAllAgents();
  }

  setDefaultAgent(agentId: string): void {
    this.ensureLegacyCompat();

    if (!this.agentManager!.hasAgent(agentId)) {
      throw new Error(`Agent not found: ${agentId}. Create the agent first.`);
    }

    this.defaultAgentId = agentId;
    Effect.runSync(this.intentRouter!.setDefaultAgent(agentId));
    this.invalidateRuntime('default agent updated');
  }

  getDefaultAgentId(): string | undefined {
    return this.defaultAgentId;
  }

  // --- Pipeline Management ---

  async createPipeline(config: PipelineConfig): Promise<PipelineInstance> {
    this.ensureLegacyCompat();
    return this.pipelineManager!.createPipeline(config);
  }

  getPipeline(id: string): PipelineInstance | undefined {
    this.ensureLegacyCompat();
    return this.pipelineManager!.getPipeline(id);
  }

  getAllPipelines(): PipelineInstance[] {
    this.ensureLegacyCompat();
    return this.pipelineManager!.getAllPipelines();
  }

  removePipeline(id: string): boolean {
    this.ensureLegacyCompat();
    return this.pipelineManager!.removePipeline(id);
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
    this.workflowManager = new WorkflowManager(this);
    for (const workflow of workflows) {
      this.workflowManager.addWorkflow(workflow.name, {
        defaultAgent: workflow.defaultAgent,
        agents: workflow.agents,
        routing: workflow.routing,
      });
    }
  }

  getWorkflowManager(): WorkflowManager | undefined {
    return this.workflowManager;
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

  getContextManager(): ContextManager {
    this.ensureLegacyCompat();
    return this.contextManager!;
  }

  // --- Session Management ---

  async listSessions(): Promise<SessionSummary[]> {
    this.ensureLegacyCompat();
    return this.contextManager!.listSessions();
  }

  async getSession(conversationId: string): Promise<SessionDetails | null> {
    this.ensureLegacyCompat();
    return this.contextManager!.getSession(conversationId);
  }

  async exportSession(
    conversationId: string,
    format: 'json' | 'markdown' = 'json'
  ): Promise<SessionExportJson | SessionExportMarkdown | null> {
    this.ensureLegacyCompat();
    return this.contextManager!.exportSession(conversationId, format);
  }

  async deleteSession(conversationId: string): Promise<void> {
    this.ensureLegacyCompat();
    await this.contextManager!.deleteSession(conversationId);
  }

  // --- Hook Management ---

  registerHook(type: HookType, handler: HookHandler): void {
    this.ensureLegacyCompat();
    this.hookManager!.registerHook(type, handler);
  }

  unregisterHook(type: HookType, handler: HookHandler): boolean {
    this.ensureLegacyCompat();
    return this.hookManager!.unregisterHook(type, handler);
  }

  getHookManager(): HookManager {
    this.ensureLegacyCompat();
    return this.hookManager!;
  }

  // --- Pause/Resume Management ---

  async getPendingPause(runId: string): Promise<PendingPause | null> {
    this.ensureLegacyCompat();
    const pauseManager = this.pipelineManager!.getPauseManager();
    if (!pauseManager) return null;
    return pauseManager.getPendingPause(runId);
  }

  async listPendingPauses(): Promise<PendingPause[]> {
    this.ensureLegacyCompat();
    const pauseManager = this.pipelineManager!.getPauseManager();
    if (!pauseManager) return [];
    return pauseManager.listPendingPauses();
  }

  async resume(runId: string, options: HumanInputResumeOptions): Promise<ResumeResult> {
    this.ensureLegacyCompat();
    return this.pipelineManager!.resumeWithHumanInput(runId, options);
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
    // Get memory defaults before initialization
    const memoryDefaults = this.configInitializer.getMemoryDefaults(configPath);
    this.memoryDefaults = memoryDefaults;
    this.invalidateRuntime('memory defaults updated from config');

    // Delegate to config initializer
    await this.configInitializer.initialize(this, configPath, options);
  }

  // --- Accessor methods for FredLike interface ---

  getAgentManager(): AgentManager {
    this.ensureLegacyCompat();
    return this.agentManager!;
  }

  getPipelineManager(): PipelineManager {
    this.ensureLegacyCompat();
    return this.pipelineManager!;
  }

  getProviderRegistry(): ProviderRegistry {
    this.ensureLegacyCompat();
    return this.providerRegistry!;
  }

  getProviderService(): ProviderService {
    this.ensureLegacyCompat();
    return this.providerService!;
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
    // Cleanup MCP connections first
    await Effect.runPromise(this.mcpServerRegistry.shutdown());

    // Cleanup existing class-based resources (includes legacy MCP clients)
    if (this.agentManager) {
      await this.agentManager.clear();
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

// Re-export Effect services for advanced users
export {
  FredLayers,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  MessageProcessorService,
  MessageProcessorServiceLive,
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
