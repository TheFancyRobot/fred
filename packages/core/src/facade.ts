/**
 * FredBase - shared facade implementation for the Fred Promise API.
 *
 * Hosts every simple service delegation plus the instance-level settings
 * (tracer, routing config, template context, storage adapter, ...) that are
 * applied to the Effect runtime when it is built.
 *
 * The runtime kernel itself (layer composition, lazy build, Promise
 * boundary execution) lives in the `Fred` subclass in `./index.ts` — the
 * only approved `Runtime.runPromise` boundary for the facade. This module
 * intentionally contains no `runPromise`/`runFork` calls.
 */

import { Effect, Runtime, Stream } from 'effect';
import type * as Schema from 'effect/Schema';
import type { Intent } from './intent/intent';
import type {
  AgentConfig,
  AgentInstance,
  AgentMessage,
  AgentResponse,
  AnyAgentInstance,
} from './agent/agent';
import type { PipelineConfig, PipelineInstance } from './pipeline';
import type { AnyPipelineConfig } from './pipeline/pipeline';
import { isPipelineConfigV2 } from './pipeline/pipeline';
import type { GraphWorkflowConfig } from './pipeline/graph';
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
import type { StreamEvent } from './stream/events';
import type { RoutingConfig, RoutingDecision, RoutingExplanation } from './routing/types';
import type { Workflow } from './workflow/manager';
import { buildObservabilityLayers, type ObservabilityLayers } from './observability/otel';
import type {
  FrameworkConfig,
  MCPGlobalServerConfig,
  ObservabilityConfig,
  TemplateConfig,
  ToolPoliciesConfig,
} from './config/types';
import { type VariableFactory } from './variables';
import type { ProcessingOptions, MemoryDefaults, RouteResult } from './message-processor/types';
import { ConfigInitializer } from './config/initializer';
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
} from './services';
import { MCPServerRegistry, MCPResourceService } from './mcp';
import type { MCPServerConfig } from './mcp/types';
import { BUILTIN_PACKS } from './platform/packs';
import { AgentFileWatcher } from './agent/file-watcher';
import { TemplateEngine, DEFAULT_ENV_ALLOWLIST } from './template';

export abstract class FredBase {
  protected defaultAgentId?: string;
  protected memoryDefaults: MemoryDefaults = {};
  protected tracer?: Tracer;
  protected routingConfig?: RoutingConfig;
  protected observabilityLayers?: ObservabilityLayers;
  protected observabilityConfig?: ObservabilityConfig;
  protected templateConfig: TemplateConfig = {};
  protected templateContextConfig: Partial<FrameworkConfig> = {};
  protected globalVariables: Map<string, VariableFactory> = new Map();
  protected templateCustomNamespaces = new Map<string, () => unknown>();
  protected readonly configInitializer: ConfigInitializer;
  protected agentFileWatcher?: AgentFileWatcher;

  /** Optional callback invoked when runtime warnings occur (e.g. hot reload errors). Pass null to clear. */
  onWarning?: (message: string | null) => void;

  // MCP integration
  protected readonly mcpServerRegistry: MCPServerRegistry;
  protected readonly mcpResourceService: MCPResourceService;

  // Instance-level context settings, applied to the runtime when it is built
  // (and re-applied if a new runtime is built after shutdown()).
  protected defaultContextPolicy: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  } | null = null;
  // Persistent reference to the storage adapter for session listing
  protected activeStorageAdapter: ContextStorage | null = null;

  // Effect runtime for service execution. Built lazily exactly once by the
  // subclass kernel and never invalidated: configuration changes after the
  // build are applied as live service mutations, not runtime rebuilds.
  protected runtime: FredRuntime | null = null;

  protected constructor(tracer?: Tracer) {
    this.tracer = tracer;
    this.configInitializer = new ConfigInitializer();
    this.mcpServerRegistry = new MCPServerRegistry();
    this.mcpResourceService = new MCPResourceService(this.mcpServerRegistry);
  }

  // --- Runtime kernel hooks (implemented by the Fred subclass) ---

  /** Return the runtime, building it synchronously on first use. */
  protected abstract ensureRuntimeSync(): FredRuntime;

  /** Run an Effect at the Promise boundary, wrapping failures as Error with cause. */
  protected abstract runEffect<A, E>(
    effect: Effect.Effect<A, E, FredServices>,
    errorMessage: string
  ): Promise<A>;

  /** Run an Effect synchronously against the (possibly just-built) runtime. */
  protected runSync<A, E>(effect: Effect.Effect<A, E, FredServices>): A {
    return Runtime.runSync(this.ensureRuntimeSync())(effect);
  }

  /**
   * One-time service initialization applied right after the runtime is built:
   * built-in tool registration plus instance-level settings (tracer, template
   * context, memory defaults, context policy/storage). This is configuration
   * application, not state replay — registered tools/agents/intents live only
   * in the services themselves.
   */
  protected initializeRuntimeServices(): Effect.Effect<void, never, FredServices | TemplateEngine> {
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

  protected updateGlobalVariablesResolver(): void {
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

  protected snapshotTemplateNamespacesSync(): Record<string, unknown> {
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

  protected snapshotGlobalVariablesSync(): Record<string, string | number | boolean> {
    const result: Record<string, string | number | boolean> = {};
    for (const [name, factory] of this.globalVariables.entries()) {
      result[name] = Effect.runSync(factory());
    }
    return result;
  }

  // --- Provider Management ---

  registerProvider(_platform: string, provider: ProviderDefinition): void {
    this.runSync(Effect.flatMap(ProviderRegistryService, (s) => s.registerDefinition(provider)));
  }

  listProviders(): string[] {
    return this.runSync(Effect.flatMap(ProviderRegistryService, (s) => s.listProviders()));
  }

  hasProvider(providerId: string): boolean {
    return this.runSync(Effect.flatMap(ProviderRegistryService, (s) => s.hasProvider(providerId)));
  }

  async useProvider(platform: string, config?: ProviderConfig): Promise<ProviderDefinition> {
    // Use the returned definition directly rather than re-querying by
    // `platform`: package specifiers (e.g. "@fancyrobot/fred-openai")
    // register under the pack's declared id/alias (e.g. "openai"), not
    // under the specifier string itself.
    return this.runEffect(
      Effect.flatMap(ProviderRegistryService, (s) => s.register(platform, config ?? {})),
      `Failed to use provider: ${platform}`
    );
  }

  async registerProviderPack(idOrPackage: string, config: ProviderConfig = {}): Promise<void> {
    await this.runEffect(
      Effect.flatMap(ProviderRegistryService, (s) => s.register(idOrPackage, config)),
      `Failed to register provider pack: ${idOrPackage}`
    );
  }

  async registerProviderFactory(factory: EffectProviderFactory, config: ProviderConfig = {}): Promise<void> {
    await this.runEffect(
      Effect.flatMap(ProviderRegistryService, (s) => s.registerFactory(factory, config)),
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
    this.runSync(Effect.flatMap(ToolRegistryService, (s) => s.registerTool(tool)));
  }

  registerTools(tools: Tool[]): void {
    if (tools.length === 0) {
      return;
    }
    this.runSync(Effect.flatMap(ToolRegistryService, (s) => s.registerTools(tools)));
  }

  getTool(id: string): Tool | undefined {
    return this.getTools().find((tool) => tool.id === id);
  }

  getTools(): Tool[] {
    return this.runSync(Effect.flatMap(ToolRegistryService, (s) => s.getAllTools()));
  }

  // --- Intent Management ---

  registerIntent(intent: Intent): void {
    this.registerIntents([intent]);
  }

  registerIntents(intents: Intent[]): void {
    this.runSync(
      Effect.gen(function* () {
        const matcher = yield* Effect.serviceOption(IntentMatcherService);
        if (matcher._tag === 'Some') {
          yield* matcher.value.registerIntents(intents);
        }
      })
    );
  }

  getIntents(): Intent[] {
    return this.runSync(
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

  async createAgent<
    InputSchema extends Schema.Schema.AnyNoContext = typeof Schema.String,
    OutputSchema extends Schema.Schema.AnyNoContext = typeof Schema.Unknown,
  >(
    config: AgentConfig<InputSchema, OutputSchema>
  ): Promise<AgentInstance<InputSchema, OutputSchema>> {
    return this.runEffect(
      Effect.flatMap(AgentService, (s) => s.createAgent(config)),
      `Failed to create agent: ${config.id}`
    );
  }

  async removeAgent(id: string): Promise<boolean> {
    return this.runEffect(
      Effect.flatMap(AgentService, (s) => s.removeAgent(id)),
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
      Effect.flatMap(TemplateEngine, (engine) =>
        engine.invalidateCache()
      ) as unknown as Effect.Effect<void, never, FredServices>,
      `Failed to invalidate template cache for partial "${partialName}" from ${filePath}`
    );
  }

  async registerAgent<
    InputSchema extends Schema.Schema.AnyNoContext = typeof Schema.String,
    OutputSchema extends Schema.Schema.AnyNoContext = typeof Schema.Unknown,
  >(
    config: AgentConfig<InputSchema, OutputSchema>
  ): Promise<AgentInstance<InputSchema, OutputSchema>> {
    return this.createAgent(config);
  }

  getAgent(id: string): AnyAgentInstance | undefined {
    return this.runSync(Effect.flatMap(AgentService, (s) => s.getAgentOptional(id)));
  }

  getAgents(): AnyAgentInstance[] {
    return this.runSync(Effect.flatMap(AgentService, (s) => s.getAllAgents()));
  }

  setDefaultAgent(agentId: string): void {
    const exists = this.runSync(Effect.flatMap(AgentService, (s) => s.hasAgent(agentId)));
    if (!exists) {
      throw new Error(`Agent not found: ${agentId}. Create the agent first.`);
    }

    this.runSync(
      Effect.flatMap(MessageProcessorService, (p) => p.updateConfig({ defaultAgentId: agentId }))
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
        Effect.flatMap(PipelineService, (s) => s.createPipelineV2(config)),
        `Failed to create pipeline: ${config.id}`
      );
    }

    return this.runEffect(
      Effect.flatMap(PipelineService, (s) => s.createPipeline(config as PipelineConfig)),
      `Failed to create pipeline: ${config.id}`
    );
  }

  registerGraphWorkflow(config: GraphWorkflowConfig): void {
    this.runSync(Effect.flatMap(PipelineService, (s) => s.registerGraphWorkflow(config)));
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
      Effect.flatMap(PipelineService, (s) =>
        s.executePipeline(pipelineId, message, previousMessages, options)
      ),
      `Failed to execute pipeline: ${pipelineId}`
    );
  }

  getPipeline(id: string): PipelineInstance | undefined {
    return this.runSync(Effect.flatMap(PipelineService, (s) => s.getPipelineOptional(id)));
  }

  getAllPipelines(): PipelineInstance[] {
    return this.runSync(Effect.flatMap(PipelineService, (s) => s.getAllPipelines()));
  }

  removePipeline(id: string): boolean {
    return this.runSync(Effect.flatMap(PipelineService, (s) => s.removePipeline(id)));
  }

  async routeMessage(message: string, options?: ProcessingOptions): Promise<RouteResult> {
    return this.runEffect(
      Effect.flatMap(MessageProcessorService, (p) =>
        p.routeMessage(message, undefined, [], {
          conversationId: options?.conversationId,
          sequentialVisibility: options?.sequentialVisibility,
        })
      ),
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
      Effect.flatMap(MessageRouterService, (router) => router.setConfig(nextConfig))
    );
  }

  async testRoute(message: string, metadata?: Record<string, unknown>): Promise<RoutingDecision | null> {
    if (!this.routingConfig) return null;

    return this.runEffect(
      Effect.flatMap(MessageRouterService, (router) => router.testRoute(message, metadata ?? {})),
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
       */
      explain: async (
        message: string,
        metadata?: Record<string, unknown>
      ): Promise<RoutingExplanation | null> => {
        if (!this.routingConfig) return null;
        const decision = await this.runEffect(
          Effect.flatMap(MessageRouterService, (router) => router.testRoute(message, metadata ?? {})),
          'Failed to explain route'
        );
        return decision?.explanation ?? null;
      },
    };
  }

  // --- Workflow Configuration ---

  configureWorkflows(workflows: Workflow[]): void {
    this.runSync(
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
    this.runSync(Effect.flatMap(WorkflowService, (s) => s.addWorkflow(name, config)));
  }

  getWorkflow(name: string): Workflow | undefined {
    return this.runSync(Effect.flatMap(WorkflowService, (s) => s.getWorkflow(name)));
  }

  listWorkflows(): string[] {
    return this.runSync(Effect.flatMap(WorkflowService, (s) => s.listWorkflows()));
  }

  hasWorkflow(name: string): boolean {
    return this.runSync(Effect.flatMap(WorkflowService, (s) => s.hasWorkflow(name)));
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

  // --- Message Processing ---

  async processChatMessage(
    messages: Array<{ role: string; content: string }>,
    options?: ProcessingOptions
  ): Promise<AgentResponse | null> {
    return this.runEffect(
      Effect.flatMap(MessageProcessorService, (p) => p.processChatMessage(messages, options)),
      'Failed to process chat message'
    );
  }

  /**
   * Build the Effect stream for streamMessage, wiring AbortSignal
   * interruption. Consumed by the streamMessage boundary in the subclass.
   */
  protected streamMessageEffect(
    message: string,
    options?: ProcessingOptions
  ): Effect.Effect<Stream.Stream<StreamEvent, Error>, never, FredServices> {
    return Effect.gen(function* () {
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
    });
  }

  // --- Context Management ---

  generateConversationId(): string {
    return this.runSync(Effect.flatMap(ContextStorageService, (s) => s.generateConversationId()));
  }

  setDefaultPolicy(policy: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  }): void {
    this.defaultContextPolicy = policy;
    this.runSync(Effect.flatMap(ContextStorageService, (s) => s.setDefaultPolicy(policy)));
  }

  setStorage(storage: unknown): void {
    this.activeStorageAdapter = storage as ContextStorage;
    this.runSync(Effect.flatMap(ContextStorageService, (s) => s.replaceStorage(storage as any)));
  }

  async getHistory(conversationId: string): Promise<any[]> {
    return this.runEffect(
      Effect.flatMap(ContextStorageService, (s) => s.getHistory(conversationId)),
      'Failed to get conversation history'
    );
  }

  async addMessages(conversationId: string, messages: any[]): Promise<void> {
    await this.runEffect(
      Effect.flatMap(ContextStorageService, (s) => s.addMessages(conversationId, messages)),
      'Failed to add messages'
    );
  }

  async getContext(conversationId: string): Promise<any> {
    return this.runEffect(
      Effect.flatMap(ContextStorageService, (s) => s.getContext(conversationId)),
      'Failed to get context'
    );
  }

  async updateMetadata(conversationId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.runEffect(
      Effect.flatMap(ContextStorageService, (s) => s.updateMetadata(conversationId, metadata as any)),
      'Failed to update metadata'
    );
  }

  async clearContext(conversationId: string): Promise<void> {
    await this.runEffect(
      Effect.flatMap(ContextStorageService, (s) => s.clearContext(conversationId)),
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
      Effect.flatMap(ContextStorageService, (s) => s.getContextById(conversationId)),
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
      Effect.flatMap(ContextStorageService, (s) => s.getContextById(conversationId)),
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
      Effect.flatMap(ContextStorageService, (s) => s.clearContext(conversationId)),
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
        Effect.flatMap(SubagentService, (s) => s.spawnSubagent(options)),
        `Failed to spawn subagent: ${options.name}`,
      ),
      list: () => this.runEffect(
        Effect.flatMap(SubagentService, (s) => s.listSubagents()),
        'Failed to list subagents',
      ),
      inspect: (id) => this.runEffect(
        Effect.flatMap(SubagentService, (s) =>
          Effect.map(s.inspectSubagent(id), (result) => result ?? null)
        ),
        `Failed to inspect subagent: ${id}`,
      ),
      execute: (id, options) => this.runEffect(
        Effect.flatMap(SubagentService, (s) => s.executeSubagent(id, options)),
        `Failed to execute subagent: ${id}`,
      ),
      destroy: (id) => this.runEffect(
        Effect.flatMap(SubagentService, (s) => s.destroySubagent(id)),
        `Failed to destroy subagent: ${id}`,
      ),
    };
  }

  // --- Hook Management ---

  registerHook(type: HookType, handler: HookHandler): void {
    this.runSync(Effect.flatMap(HookManagerService, (s) => s.registerHook(type, handler)));
  }

  unregisterHook(type: HookType, handler: HookHandler): boolean {
    return this.runSync(Effect.flatMap(HookManagerService, (s) => s.unregisterHook(type, handler)));
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
      Effect.flatMap(PauseService, (s) =>
        Effect.map(Effect.either(s.getPendingPause(runId)), (result) =>
          result._tag === 'Right' ? result.right : null
        )
      ),
      `Failed to get pending pause: ${runId}`
    );
  }

  async listPendingPauses(): Promise<PendingPause[]> {
    return this.runEffect(
      Effect.flatMap(PauseService, (s) => s.listPendingPauses()),
      'Failed to list pending pauses'
    );
  }

  async resume(runId: string, options: HumanInputResumeOptions): Promise<ResumeResult> {
    return this.runEffect(
      Effect.flatMap(PipelineService, (s) => s.resumeWithHumanInput(runId, options)),
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
      Effect.flatMap(ToolGateService, (s) => s.reloadPolicies(policies)),
      'Failed to apply tool policies'
    );
  }

  getObservabilityLayers(): ObservabilityLayers | undefined {
    return this.observabilityLayers;
  }

  // --- FredLike accessors (consumed by ConfigInitializer) ---

  ['getAgent' + 'Manager'](): any {
    return {
      hasAgent: (id: string) => this.getAgent(id) !== undefined,
      setDefaultSystemMessage: (systemMessage?: string) => {
        if (!this.runtime) {
          return;
        }
        Runtime.runSync(this.runtime)(
          Effect.flatMap(AgentService, (s) => s.setDefaultSystemMessage(systemMessage))
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
          Effect.flatMap(PipelineService, (s) => s.resume(runId, options)),
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
        this.runSync(Effect.flatMap(ProviderRegistryService, (s) => s.getDefinitions())),
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
   */
  async configureMCPServers(
    configs: Array<MCPGlobalServerConfig & { id: string }>
  ): Promise<void> {
    for (const config of configs) {
      const serverConfig = this.toMCPServerConfig(config);

      if (config.lazy) {
        // Register lazy server (deferred connection)
        this.mcpServerRegistry.registerLazyServer(config.id, serverConfig);
      } else {
        // Register and connect immediately (graceful failure handling —
        // registerAndConnect never fails, it logs and skips the server).
        await this.runEffect(
          this.mcpServerRegistry.registerAndConnect(config.id, serverConfig),
          `Failed to connect MCP server: ${config.id}`
        );
      }
    }

    // Start health checks for connected servers
    this.mcpServerRegistry.startHealthChecks();
  }

  /**
   * Map MCPGlobalServerConfig retry fields to internal MCPServerConfig format:
   *   maxRetries -> maxAttempts, backoffMs -> initialDelayMs, maxBackoffMs -> maxDelayMs
   */
  private toMCPServerConfig(config: MCPGlobalServerConfig & { id: string }): MCPServerConfig {
    const retry = config.retry
      ? {
          maxAttempts: config.retry.maxRetries,
          initialDelayMs: config.retry.backoffMs,
          maxDelayMs: config.retry.maxBackoffMs,
        }
      : undefined;
    return {
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
    } as MCPServerConfig;
  }
}
