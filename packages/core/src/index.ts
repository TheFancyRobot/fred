import type { Intent } from './intent/intent';
import type { AgentConfig, AgentInstance, AgentResponse, AgentMessage } from './agent/agent';
import type { PipelineConfig, PipelineInstance } from './pipeline';
import type { AnyPipelineConfig } from './pipeline/pipeline';
import { isPipelineConfigV2 } from './pipeline/pipeline';
import type { GraphWorkflowConfig } from './pipeline/graph';
import type { GraphExecutionResult } from './pipeline/graph-executor';
import { executeGraphWorkflow as executeGraphWorkflowImpl, executeGraphWorkflowEffect } from './pipeline/graph-executor';
import type { AgentManagerLike, HookManagerLike } from './pipeline/executor';
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
import { Cause, Effect, Exit, Layer, Runtime, Stream } from 'effect';
import type { StreamEvent } from './stream/events';
import type { StreamResult } from './stream/result';
import { createStreamResult } from './stream/result';
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
  ExecuteSubagentOptions,
  ExecuteSubagentResult,
  SpawnSubagentOptions,
  SubagentInfo,
} from './subagent/service';
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
  SubagentService,
  SubagentServiceLive,
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
import { loadConfig, extractObservability } from './config/loader';
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
  private readonly configInitializer: ConfigInitializer;
  private agentFileWatcher?: AgentFileWatcher;

  /** Optional callback invoked when runtime warnings occur (e.g. hot reload errors). Pass null to clear. */
  onWarning?: (message: string | null) => void;

  // MCP integration
  private readonly mcpServerRegistry: MCPServerRegistry;
  private readonly mcpResourceService: MCPResourceService;

  // Instance-level context settings, applied to the runtime when it is built
  // (and re-applied if a new runtime is built after shutdown()).
  private defaultContextPolicy: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  } | null = null;
  // Persistent reference to the storage adapter for session listing
  private activeStorageAdapter: ContextStorage | null = null;

  // Effect runtime for service execution. Built lazily exactly once on first
  // use (sync or async) and never invalidated: configuration changes after
  // the build are applied as live service mutations, not runtime rebuilds.
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

  private buildRuntimeLayer(): Layer.Layer<FredServices | TemplateEngine> {
    const layerOptions: FredLayerOptions = {
      routingConfig: this.routingConfig,
      observabilityLayers: this.observabilityLayers,
    };

    return Layer.mergeAll(
      makeFredRuntimeLayer(layerOptions),
      TemplateEngineLive({
        ...this.templateConfig,
        basePath: process.cwd(),
      })
    ) as Layer.Layer<FredServices | TemplateEngine>;
  }

  /**
   * One-time service initialization applied right after the runtime is built:
   * built-in tool registration plus instance-level settings (tracer, template
   * context, memory defaults, context policy/storage). This is configuration
   * application, not state replay — registered tools/agents/intents live only
   * in the services themselves.
   */
  private initializeRuntimeServices(): Effect.Effect<void, never, FredServices | TemplateEngine> {
    const self = this;
    return Effect.gen(function* () {
      const toolRegistryService = yield* ToolRegistryService;
      const agentService = yield* AgentService;
      const processor = yield* MessageProcessorService;
      const templateEngine = yield* TemplateEngine;

      const calculatorTool = createCalculatorTool() as unknown as Tool;
      yield* toolRegistryService.registerTool(calculatorTool);

      yield* agentService.setTracer(self.tracer);
      yield* agentService.setGlobalVariablesResolver(() => self.snapshotGlobalVariablesSync());
      yield* agentService.setTemplateEngine(templateEngine);
      yield* agentService.setTemplateCustomNamespaces(self.snapshotTemplateNamespacesSync());
      yield* agentService.setTemplateEnvAllowlist(
        self.templateConfig.envAllowlist ?? [...DEFAULT_ENV_ALLOWLIST]
      );
      yield* agentService.setTemplateFredConfig(self.templateContextConfig);

      yield* processor.updateConfig({
        defaultAgentId: self.defaultAgentId,
        memoryDefaults: self.memoryDefaults,
        tracer: self.tracer,
      });

      if (self.routingConfig) {
        const router = yield* MessageRouterService;
        yield* router.setConfig(self.routingConfig);
      }

      if (self.defaultAgentId) {
        const routerOption = yield* Effect.serviceOption(IntentRouterService);
        if (routerOption._tag === 'Some') {
          yield* routerOption.value.setDefaultAgent(self.defaultAgentId);
        }
      }

      const contextService = yield* ContextStorageService;
      if (self.defaultContextPolicy) {
        yield* contextService.setDefaultPolicy(self.defaultContextPolicy);
      }
      if (self.activeStorageAdapter) {
        yield* contextService.replaceStorage(self.activeStorageAdapter as any);
      }
    }) as Effect.Effect<void, never, FredServices | TemplateEngine>;
  }

  /**
   * Ensure the Effect runtime exists, building it synchronously if needed.
   *
   * The default Fred layer graph is fully synchronous, so synchronous
   * registration methods (registerTool, registerIntents, ...) can force the
   * build without awaiting. If an async layer is configured (e.g. OTel
   * observability layers), synchronous building is impossible — use
   * `await Fred.create()` or any async method first in that case.
   */
  private ensureRuntimeSync(): FredRuntime {
    if (this.runtime) return this.runtime;

    if (this.runtimePromise) {
      throw new Error(
        'Fred runtime is currently initializing. Await Fred.create() (or a pending async call) before using synchronous registration methods.'
      );
    }

    try {
      const runtime = Effect.runSync(
        Effect.scoped(Layer.toRuntime(this.buildRuntimeLayer()))
      ) as FredRuntime;
      Runtime.runSync(runtime)(this.initializeRuntimeServices());
      this.runtime = runtime;
      return runtime;
    } catch (error) {
      throw new Error(
        'Fred runtime could not be initialized synchronously (a configured layer requires async setup). Use `await Fred.create()` or call an async Fred method before synchronous registration methods.',
        { cause: error }
      );
    }
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
      this.runtimePromise = (async () => {
        try {
          const runtime = await Effect.runPromise(
            Effect.scoped(Layer.toRuntime(this.buildRuntimeLayer()))
          ) as FredRuntime;

          await Runtime.runPromise(runtime)(this.initializeRuntimeServices());

          this.runtime = runtime;
          return runtime;
        } catch (error) {
          this.runtimePromise = null;
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
    // Wrap with Effect.exit so the fiber always succeeds. This prevents
    // Effect's runtime from logging "Fiber terminated with an unhandled
    // error" to stderr, which corrupts TUI displays that use alternate
    // screen mode. We inspect the Exit value ourselves and re-throw.
    const exit = await Runtime.runPromise(runtime)(Effect.exit(effect));
    if (Exit.isSuccess(exit)) {
      return exit.value;
    }
    // Extract the original error from the Cause for the wrapper
    const failure = Cause.failureOption(exit.cause);
    const defects = Array.from(Cause.defects(exit.cause));
    const cause = failure._tag === 'Some'
      ? failure.value
      : defects[0] ?? exit.cause;
    throw new Error(errorMessage, { cause });
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
   * Run an Effect program with Fred services, without fiber failure logging.
   *
   * Unlike calling `Runtime.runPromise(runtime)(effect)` directly, this method
   * wraps the program with `Effect.exit` to prevent Effect's runtime from
   * logging "Fiber terminated with an unhandled error" to stderr. This is
   * important in TUI environments where stderr writes corrupt the display.
   *
   * @example
   * ```typescript
   * const fred = await Fred.create();
   *
   * const result = await fred.runSafe(
   *   Effect.gen(function* () {
   *     const toolService = yield* ToolRegistryService;
   *     return yield* toolService.size();
   *   })
   * );
   * ```
   */
  async runSafe<A, E>(effect: Effect.Effect<A, E, FredServices>): Promise<A> {
    return this.runEffect(effect, 'Effect execution failed');
  }

  /**
   * Enable tracing with a tracer instance.
   *
   * Applied live to the running runtime — no rebuild required.
   */
  enableTracing(tracer?: Tracer): void {
    this.tracer = tracer || new NoOpTracer();

    if (!this.runtime) {
      return; // Applied by initializeRuntimeServices when the runtime is built.
    }

    const nextTracer = this.tracer;
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        const processor = yield* MessageProcessorService;
        yield* agentService.setTracer(nextTracer);
        yield* processor.updateConfig({ tracer: nextTracer });
      })
    );
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
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        yield* providers.registerDefinition(provider);
      })
    );
  }

  listProviders(): string[] {
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        return yield* providers.listProviders();
      })
    );
  }

  hasProvider(providerId: string): boolean {
    return Runtime.runSync(this.ensureRuntimeSync())(
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
  }

  async registerProviderFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Promise<void> {
    await this.runEffect(
      Effect.gen(function* () {
        const providers = yield* ProviderRegistryService;
        yield* providers.registerFactory(factory, config);
      }),
      `Failed to register provider factory: ${factory.id}`
    );
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

  // --- Tool Management ---

  registerTool(tool: Tool): void {
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const tools = yield* ToolRegistryService;
        yield* tools.registerTool(tool);
      })
    );
  }

  registerTools(tools: Tool[]): void {
    if (tools.length === 0) {
      return;
    }

    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const registry = yield* ToolRegistryService;
        yield* registry.registerTools(tools);
      })
    );
  }

  getTool(id: string): Tool | undefined {
    const tools = Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const registry = yield* ToolRegistryService;
        return yield* registry.getAllTools();
      })
    );
    return tools.find((tool) => tool.id === id);
  }

  getTools(): Tool[] {
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const registry = yield* ToolRegistryService;
        return yield* registry.getAllTools();
      })
    );
  }

  // --- Intent Management ---

  registerIntent(intent: Intent): void {
    this.registerIntents([intent]);
  }

  registerIntents(intents: Intent[]): void {
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const matcher = yield* Effect.serviceOption(IntentMatcherService);
        if (matcher._tag === 'Some') {
          yield* matcher.value.registerIntents(intents);
        }
      })
    );
  }

  getIntents(): Intent[] {
    return Runtime.runSync(this.ensureRuntimeSync())(
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
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.getAgentOptional(id);
      })
    );
  }

  getAgents(): AgentInstance[] {
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.getAllAgents();
      })
    );
  }

  setDefaultAgent(agentId: string): void {
    const runtime = this.ensureRuntimeSync();
    const exists = Runtime.runSync(runtime)(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.hasAgent(agentId);
      })
    );
    if (!exists) {
      throw new Error(`Agent not found: ${agentId}. Create the agent first.`);
    }

    Runtime.runSync(runtime)(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        yield* processor.updateConfig({ defaultAgentId: agentId });
      })
    );

    this.defaultAgentId = agentId;
  }

  getDefaultAgentId(): string | undefined {
    return this.defaultAgentId;
  }

  // --- Pipeline Management ---

  async createPipeline(config: AnyPipelineConfig): Promise<PipelineInstance | void> {
    if (isPipelineConfigV2(config)) {
      return this.runEffect(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.createPipelineV2(config);
        }),
        `Failed to create pipeline: ${config.id}`
      );
    }

    return this.runEffect(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.createPipeline(config as PipelineConfig);
      }),
      `Failed to create pipeline: ${config.id}`
    );
  }

  registerGraphWorkflow(config: GraphWorkflowConfig): void {
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        yield* service.registerGraphWorkflow(config);
      })
    );
  }

  async executeGraphWorkflow(
    id: string,
    input: string,
    options?: { conversationId?: string }
  ): Promise<GraphExecutionResult> {
    const runtime = await this.ensureRuntime();

    const configExit = await Runtime.runPromise(runtime)(
      Effect.exit(
        Effect.gen(function* () {
          const service = yield* PipelineService;
          return yield* service.getGraphWorkflow(id);
        })
      )
    );
    if (Exit.isFailure(configExit)) {
      throw new Error(`Graph workflow not found: ${id}`);
    }
    const config = configExit.value;
    const agents = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const agentService = yield* AgentService;
        return yield* agentService.getAllAgents();
      })
    );

    const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
    const agentManager: AgentManagerLike = {
      getAgent: (agentId: string) => {
        const agent = agentMap.get(agentId);
        if (!agent) {
          throw new Error(`Agent not found: ${agentId}`);
        }
        return agent;
      },
      hasAgent: (agentId: string) => agentMap.has(agentId),
    };

    const hookManager = await Runtime.runPromise(runtime)(
      Effect.gen(function* () {
        const hooks = yield* HookManagerService;
        const adapter: HookManagerLike = {
          executeHooks: (hookName, event) =>
            Runtime.runPromise(runtime)(hooks.executeHooks(hookName as HookType, event)).then(() => undefined),
          executeHooksAndMerge: (hookName, event) =>
            Runtime.runPromise(runtime)(hooks.executeHooksAndMerge(hookName as HookType, event)),
        };
        return adapter;
      })
    ).catch(() => undefined);

    const graphOptions = {
      agentManager,
      hookManager,
      tracer: this.tracer,
      ...options,
    };

    // Use the Effect-native path with the Fred runtime instead of the deprecated
    // function which uses Effect.runCallback without a runtime, causing hangs
    // when graph nodes call back into Runtime.runPromise.
    const exit = await Runtime.runPromise(runtime)(
      Effect.exit(executeGraphWorkflowEffect(config, input, graphOptions))
    );

    if (Exit.isSuccess(exit)) {
      return exit.value;
    }

    // Mirror the deprecated function's error-to-result conversion
    const error = Cause.squash(exit.cause);
    return {
      success: false,
      context: {
        pipelineId: config.id,
        input,
        outputs: {},
        history: [],
        metadata: {},
      },
      outputs: {},
      executedNodes: [],
      error: error instanceof Error ? error : new Error(String(error)),
    };
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
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.getPipelineOptional(id);
      })
    );
  }

  getAllPipelines(): PipelineInstance[] {
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const service = yield* PipelineService;
        return yield* service.getAllPipelines();
      })
    );
  }

  removePipeline(id: string): boolean {
    return Runtime.runSync(this.ensureRuntimeSync())(
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

    if (!this.runtime) {
      return; // Applied by initializeRuntimeServices when the runtime is built.
    }

    const nextConfig = this.routingConfig;
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const router = yield* MessageRouterService;
        yield* router.setConfig(nextConfig);
      })
    );
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
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        yield* service.clear();
        for (const workflow of workflows) {
          yield* service.addWorkflow(workflow.name, {
            defaultAgent: workflow.defaultAgent,
            agents: workflow.agents,
            routing: workflow.routing,
          });
        }
      })
    );
  }

  addWorkflow(name: string, config: Omit<Workflow, 'name'>): void {
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        yield* service.addWorkflow(name, config);
      })
    );
  }

  getWorkflow(name: string): Workflow | undefined {
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        return yield* service.getWorkflow(name);
      })
    );
  }

  listWorkflows(): string[] {
    return Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const service = yield* WorkflowService;
        return yield* service.listWorkflows();
      })
    );
  }

  hasWorkflow(name: string): boolean {
    return Runtime.runSync(this.ensureRuntimeSync())(
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
        let effectStream = processor.streamMessage(message, options).pipe(
          Stream.mapError((error) =>
            error instanceof Error ? error : new Error(String(error))
          )
        );

        // When an AbortSignal is provided, interrupt the stream on abort
        if (options?.signal) {
          const signal = options.signal;
          effectStream = effectStream.pipe(
            Stream.interruptWhen(
              Effect.async<void, never>((resume) => {
                if (signal.aborted) {
                  resume(Effect.succeed(undefined));
                  return;
                }
                const onAbort = () => resume(Effect.succeed(undefined));
                signal.addEventListener('abort', onAbort, { once: true });
                return Effect.sync(() => {
                  signal.removeEventListener('abort', onAbort);
                });
              })
            )
          );
        }

        return effectStream;
      }),
      'Failed to stream message'
    );

    // Use Stream.unwrap to lazily resolve the stream promise, then pass
    // the Effect Stream directly to createStreamResult. This avoids a
    // redundant double-conversion (Effect Stream → AsyncIterable →
    // Effect Stream → AsyncIterable) that can batch events in multi-step
    // flows where a tool call separates two model response phases.
    const lazyStream = Stream.unwrap(
      Effect.promise(() => streamPromise)
    ) as Stream.Stream<StreamEvent, Error>;

    return createStreamResult(lazyStream);
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
    return Runtime.runSync(this.ensureRuntimeSync())(
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
    this.defaultContextPolicy = policy;
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const context = yield* ContextStorageService;
        yield* context.setDefaultPolicy(policy);
      })
    );
  }

  setStorage(storage: unknown): void {
    this.activeStorageAdapter = storage as ContextStorage;
    Runtime.runSync(this.ensureRuntimeSync())(
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

    const preview = (() => {
      const content = context.messages.find((message) => message.role === 'user')?.content;
      if (typeof content === 'string') {
        return content;
      }
      return content ? JSON.stringify(content) : '';
    })();

    const summary: SessionSummary = {
      id: conversationId,
      preview,
      createdAt: context.metadata.createdAt,
      updatedAt: context.metadata.updatedAt,
      messageCount: context.messages.length,
    };

    return {
      summary,
      messages: context.messages,
      metadata: context.metadata,
    };
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
      return context.messages
        .map((message) => `## ${message.role}\n\n${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`)
        .join('\n\n');
    }

    return {
      id: conversationId,
      metadata: context.metadata as unknown as Record<string, unknown>,
      messages: context.messages as unknown as Array<Record<string, unknown>>,
    };
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

  // --- Subagent Management ---

  get subagents(): {
    spawn: (options: SpawnSubagentOptions) => Promise<SubagentInfo>;
    list: () => Promise<SubagentInfo[]>;
    inspect: (id: string) => Promise<SubagentInfo | null>;
    execute: (id: string, options?: ExecuteSubagentOptions) => Promise<ExecuteSubagentResult>;
    destroy: (id: string) => Promise<boolean>;
  } {
    return {
      spawn: (options) => this.runEffect(
        Effect.gen(function* () {
          const subagents = yield* SubagentService;
          return yield* subagents.spawnSubagent(options);
        }),
        `Failed to spawn subagent: ${options.name}`,
      ),
      list: () => this.runEffect(
        Effect.gen(function* () {
          const subagents = yield* SubagentService;
          return yield* subagents.listSubagents();
        }),
        'Failed to list subagents',
      ),
      inspect: (id) => this.runEffect(
        Effect.gen(function* () {
          const subagents = yield* SubagentService;
          const result = yield* subagents.inspectSubagent(id);
          return result ?? null;
        }),
        `Failed to inspect subagent: ${id}`,
      ),
      execute: (id, options) => this.runEffect(
        Effect.gen(function* () {
          const subagents = yield* SubagentService;
          return yield* subagents.executeSubagent(id, options);
        }),
        `Failed to execute subagent: ${id}`,
      ),
      destroy: (id) => this.runEffect(
        Effect.gen(function* () {
          const subagents = yield* SubagentService;
          return yield* subagents.destroySubagent(id);
        }),
        `Failed to destroy subagent: ${id}`,
      ),
    };
  }

  // --- Hook Management ---

  registerHook(type: HookType, handler: HookHandler): void {
    Runtime.runSync(this.ensureRuntimeSync())(
      Effect.gen(function* () {
        const hooks = yield* HookManagerService;
        yield* hooks.registerHook(type, handler);
      })
    );
  }

  unregisterHook(type: HookType, handler: HookHandler): boolean {
    return Runtime.runSync(this.ensureRuntimeSync())(
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
    if (this.runtime) {
      // Idempotent re-application of the same config is a no-op (e.g. when
      // initializeFromConfig already applied it before the runtime was built).
      if (JSON.stringify(this.observabilityConfig ?? null) === JSON.stringify(config ?? null)) {
        return;
      }
      const warning =
        '[Fred] configureObservability was called after the runtime was initialized. ' +
        'Observability layers (OTel tracer/logger) are applied when the runtime is built and cannot be changed afterwards. ' +
        'Configure observability before first use (e.g. via initializeFromConfig on a fresh instance, or before Fred.create() resolves).';
      this.emitWarning(warning);
      console.warn(warning);
      return;
    }

    this.observabilityConfig = config;
    this.observabilityLayers = buildObservabilityLayers(config);
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

    // Apply layer-baked configuration (observability) before the runtime is
    // first built so it lands in the layer graph. When the runtime already
    // exists, configureObservability warns instead of rebuilding.
    if (!this.runtime) {
      this.configureObservability(extractObservability(config));
    }

    // Ensure runtime is built before ConfigInitializer accesses service proxies
    await this.ensureRuntime();

    // Apply live-mutable settings to the existing runtime.
    const currentMemoryDefaults = this.memoryDefaults;
    await this.runEffect(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        yield* processor.updateConfig({ memoryDefaults: currentMemoryDefaults });
      }),
      'Failed to apply memory defaults from config'
    );

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
      getDefinitions: () =>
        Runtime.runSync(this.ensureRuntimeSync())(
          Effect.gen(function* () {
            const providers = yield* ProviderRegistryService;
            return yield* providers.getDefinitions();
          })
        ),
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
          const subagents = yield* SubagentService;
          yield* subagents.destroyAllSubagents();
          yield* agents.clear();
          yield* pipelines.clear();
        })
      ).catch(() => undefined);
    }

    // Runtime cleanup happens automatically via Effect.scoped when the
    // runtime was created. Reset the runtime reference so a later use builds
    // a fresh one; registered tools/agents/intents are gone at that point —
    // only instance-level settings (tracer, routing, storage adapter, context
    // policy) are re-applied to the new runtime.
    this.runtime = null;
    this.runtimePromise = null;
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

// Public type alias for consumers that need a stable identifier
// independent of the concrete Fred class implementation.
export type FredInstance = Fred;

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
  SubagentService,
  SubagentServiceLive,
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
