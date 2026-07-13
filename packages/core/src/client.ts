/**
 * createFred - the scoped Promise client for Fred.
 *
 * This is the recommended entry point for Promise-based consumers. It builds
 * the Effect runtime once, exposes small scoped sub-APIs (agents, workflows,
 * sessions, providers) as thin `Runtime.runPromise` shims over the service
 * Tags, and hands power users the raw runtime as an escape hatch:
 *
 * ```typescript
 * import { createFred } from '@fancyrobot/fred';
 *
 * const fred = await createFred();
 * await fred.agents.register({ id: 'helper', platform: 'openai', model: 'gpt-4o' });
 * const result = await fred.workflows.run('my-pipeline', 'hello');
 * await fred.shutdown();
 * ```
 *
 * Effect-native consumers should use `@fancyrobot/fred/effect` instead.
 *
 * This module is an approved Effect runtime boundary (see
 * tests/unit/core/migration/boundary-guard.test.ts).
 */

import { Cause, Data, Effect, Exit, Layer, Runtime, Scope } from 'effect';
import { dirname } from 'path';
import type * as Schema from 'effect/Schema';
import type {
  AgentConfig,
  AgentInstance,
  AgentResponse,
  AnyAgentInstance,
} from './agent/agent';
import type { PipelineConfigV2 } from './pipeline/pipeline';
import type { GraphWorkflowConfig } from './pipeline/graph';
import type { GraphExecutionResult } from './pipeline/graph-executor';
import type { AgentManagerLike, HookManagerLike, PipelineResult } from './pipeline/executor';
import type {
  GraphValidationError,
  PipelineAlreadyExistsError,
  PipelineExecutionError,
} from './pipeline/errors';
import type { WorkflowIR } from './workflow/ir';
import {
  WorkflowInputValidationError,
  WorkflowNodeExecutionError,
  WorkflowOutputValidationError,
} from './workflow/errors';
import type { WorkflowDescriptor } from './workflow/contracts';
import {
  executeWorkflowEffect,
  type WorkflowExecutionOptions,
  type WorkflowExecutionResult,
} from './workflow/execute';
import type { Tool, ToolSchemaMetadata } from './tool/tool';
import { createCalculatorTool } from './tool/calculator';
import type { ProviderConfig, ProviderDefinition } from './platform/provider';
import type { Tracer } from './tracing';
import type { RoutingConfig } from './routing/types';
import { buildObservabilityLayers } from './observability/otel';
import type {
  MCPGlobalServerConfig,
  ObservabilityConfig,
  TemplateConfig,
} from './config/types';
import {
  ConfigInitializer,
  type ConfigInitializationTarget,
  type InitializerOptions,
} from './config/initializer';
import { loadValidatedConfig } from './config/load';
import { configToLayerOptions } from './config/compile';
import type { ContextStorage, SessionDetails, SessionSummary } from './context/context';
import { PostgresContextStorage } from './context/storage/postgres';
import { SqliteContextStorage } from './context/storage/sqlite';
import { buildSessionDetails } from './context/session';
import {
  makeFredRuntimeLayer,
  type FredLayerOptions,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  ToolGateService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  MessageProcessorService,
  MessageRouterService,
  IntentMatcherService,
  WorkflowService,
  PauseService,
  SubagentService,
  SessionService,
} from './services';
import type { SessionHandle } from './context/session-service';
import { resolveAmbientConversationId } from './context/session-service';
import { TemplateEngine, TemplateEngineLive } from './template';
import { DEFAULT_ENV_ALLOWLIST } from './template';
import type { ProcessingOptions } from './message-processor/types';
import type { HookHandler, HookType } from './hooks';
import type { HumanInputResumeOptions, PendingPause } from './pipeline/pause/types';
import type { ResumeResult } from './pipeline/resume';
import type {
  ExecuteSubagentOptions,
  ExecuteSubagentResult,
  SpawnSubagentOptions,
  SubagentInfo,
} from './subagent/service';
import { MCPServerRegistry, type ServerStatus } from './mcp';
import type { MCPServerConfig } from './mcp/types';
import { MCPSecurityError, validateCommand, validateUrl } from './mcp/security';
import type { VariableFactory } from './variables';
import { BUILTIN_PACKS } from './platform/packs';
import type { AgentFileWatcher } from './agent/file-watcher';
import {
  CheckpointCleanupTask,
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  type CheckpointStorage,
} from './pipeline/checkpoint';

/** Execute an already-compiled workflow against an existing Fred runtime. */
export async function executeWorkflowViaRuntime(
  runtime: FredRuntime,
  workflow: WorkflowIR,
  input: unknown,
  options: { conversationId?: string; tracer?: Tracer } = {}
): Promise<WorkflowExecutionResult> {
  const agents = await Runtime.runPromise(runtime)(
    Effect.flatMap(AgentService, (s) => s.getAllAgents())
  );

  const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
  const agentManager: AgentManagerLike = {
    getAgent: (agentId: string) => agentMap.get(agentId),
    hasAgent: (agentId: string) => agentMap.has(agentId),
  };

  const hookManager = await Runtime.runPromise(runtime)(
    Effect.map(HookManagerService, (hooks): HookManagerLike => ({
      executeHooks: (hookName, event) =>
        Runtime.runPromise(runtime)(hooks.executeHooks(hookName, event)).then(() => undefined),
      executeHooksAndMerge: (hookName, event) =>
        Runtime.runPromise(runtime)(hooks.executeHooksAndMerge(hookName, event)),
    }))
  ).catch(() => undefined);
  const pipelineService = await Runtime.runPromise(runtime)(PipelineService);

  // Resolve the conversation id: explicit wins, otherwise fall back to the
  // ambient session so an ambient-only graph run still binds to it.
  const conversationId = await Runtime.runPromise(runtime)(
    resolveAmbientConversationId(options.conversationId)
  );

  const workflowResolver = (workflowId: string, nestedInput: unknown) =>
    Effect.gen(function* () {
      const nestedWorkflow = yield* pipelineService.getWorkflowIR(workflowId);
      const nestedResult: WorkflowExecutionResult = yield* Effect.tryPromise({
        try: () => executeWorkflowViaRuntime(runtime, nestedWorkflow, nestedInput, options),
        catch: (cause) => new WorkflowNodeExecutionError({
          workflowId,
          nodeId: nestedWorkflow.entry,
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
          retryable: true,
        }),
      });
      if (!nestedResult.success) {
        const cause = nestedResult.error ?? `Nested workflow "${workflowId}" did not complete`;
        return yield* new WorkflowNodeExecutionError({
          workflowId,
          nodeId: nestedResult.failedNodeId ?? nestedWorkflow.entry,
          message: cause instanceof Error ? cause.message : cause,
          cause,
          retryable: true,
        });
      }
      return nestedResult.finalOutput;
    });

  const executionOptions: WorkflowExecutionOptions = {
    agentManager,
    hookManager,
    tracer: options.tracer,
    conversationId,
    workflowResolver,
  };

  const workflowEffect = executeWorkflowEffect(workflow, input, executionOptions);
  const scoped = conversationId
    ? Effect.flatMap(SessionService, (session) =>
        session.withSession(conversationId, workflowEffect)
      )
    : workflowEffect;
  const exit = await Runtime.runPromise(runtime)(Effect.exit(scoped));

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const error = Cause.squash(exit.cause);
  if (
    error instanceof WorkflowInputValidationError ||
    error instanceof WorkflowOutputValidationError
  ) {
    throw error;
  }
  return {
    success: false,
    status: 'failed',
    context: {
      pipelineId: workflow.id,
      input,
      outputs: {},
      history: [],
      metadata: {},
    },
    outputs: {},
    executedNodes: [],
    error: error instanceof Error ? error : new Error(String(error)),
    runId: crypto.randomUUID(),
  };
}

/** Compatibility helper for the legacy graph-specific Promise entrypoint. */
export async function executeGraphWorkflowViaRuntime(
  runtime: FredRuntime,
  id: string,
  input: string,
  options: { conversationId?: string; tracer?: Tracer } = {},
): Promise<GraphExecutionResult> {
  const workflowExit = await Runtime.runPromise(runtime)(
    Effect.exit(Effect.flatMap(PipelineService, (service) => service.getWorkflowIR(id))),
  );
  if (Exit.isFailure(workflowExit)) throw new Error(`Graph workflow not found: ${id}`);
  const workflow = workflowExit.value;
  if (workflow.source !== 'graph') throw new Error(`Graph workflow not found: ${id}`);
  const result = await executeWorkflowViaRuntime(runtime, workflow, input, options);
  return {
    success: result.success,
    context: result.context,
    outputs: result.outputs,
    executedNodes: result.executedNodes,
    error: result.error,
    abortedBy: result.abortedBy,
  };
}

/**
 * The FredClient was shut down; no further calls are allowed.
 */
export class FredClientClosedError extends Data.TaggedError('FredClientClosedError')<{
  readonly message: string;
}> {}

export interface CreateFredOptions {
  /** Load and apply this YAML/JSON config before returning the client. */
  configPath?: string;
  /** Runtime executors and provider defaults used by config initialization. */
  configOptions?: InitializerOptions;
  /** Tracer applied to agent execution and message processing. */
  tracer?: Tracer;
  /** Rule-based message routing configuration. */
  routing?: RoutingConfig;
  /** OpenTelemetry observability configuration (baked into the runtime layers). */
  observability?: ObservabilityConfig;
  /** Template engine configuration for agent prompts. */
  template?: TemplateConfig;
  /** Persistent conversation storage adapter (e.g. SQLite/Postgres). */
  storage?: ContextStorage;
  /** Prompt adapter layer used while constructing AgentService. */
  promptSourceLayer?: FredLayerOptions['promptSourceLayer'];
}

/** A supported V2, graph, or native-IR workflow definition. */
export type WorkflowDefinition = PipelineConfigV2 | GraphWorkflowConfig | WorkflowIR;

/** Failures workflows.define can produce across the three workflow kinds. */
export type WorkflowDefineError =
  | PipelineAlreadyExistsError
  | PipelineExecutionError
  | GraphValidationError;

/** Result of workflows.run — shape depends on the workflow kind. */
export type WorkflowRunResult =
  | PipelineResult
  | GraphExecutionResult
  | WorkflowExecutionResult;

/** Safe, execution-free metadata for a tool discovered from an MCP server. */
export interface MCPToolMetadata {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema?: ToolSchemaMetadata;
}

/** Client-facing MCP server state. Secret-bearing registry config stays private. */
export interface MCPServerInfo {
  readonly id: string;
  readonly transport: MCPServerConfig['transport'];
  readonly lazy: boolean;
  readonly status: ServerStatus | 'stopped';
  readonly connected: boolean;
  readonly tools: readonly MCPToolMetadata[];
  readonly toolDiscoveryFailed?: boolean;
}

/** Per-server result used by best-effort bulk MCP lifecycle operations. */
export interface MCPServerOperationResult {
  readonly id: string;
  readonly success: boolean;
  readonly error?: string;
}

export type FredWarningListener = (message: string | null) => void;

export interface FredClient {
  readonly agents: {
    register<
      InputSchema extends Schema.Schema.AnyNoContext = typeof Schema.String,
      OutputSchema extends Schema.Schema.AnyNoContext = typeof Schema.Unknown,
    >(
      config: AgentConfig<InputSchema, OutputSchema>
    ): Promise<AgentInstance<InputSchema, OutputSchema>>;
    remove(id: string): Promise<boolean>;
    get(id: string): Promise<AnyAgentInstance | null>;
    list(): Promise<AnyAgentInstance[]>;
  };
  readonly messages: {
    process(message: string, options?: ProcessingOptions): Promise<AgentResponse>;
  };
  readonly tools: {
    register<Input, Output, Failure>(tool: Tool<Input, Output, Failure>): Promise<void>;
    remove(id: string): Promise<boolean>;
    list(): Promise<Tool[]>;
  };
  readonly hooks: {
    register(type: HookType, handler: HookHandler): Promise<void>;
    unregister(type: HookType, handler: HookHandler): Promise<boolean>;
  };
  readonly templates: {
    addContext(namespace: string, resolver: () => unknown): Promise<void>;
    invalidate(): Promise<void>;
  };
  readonly variables: {
    register(name: string, factory: VariableFactory): Promise<void>;
    registerAll(variables: Record<string, VariableFactory>): Promise<void>;
    snapshot(): Promise<Record<string, string | number | boolean>>;
  };
  readonly workflows: {
    define(config: WorkflowDefinition): Promise<void>;
    list(): Promise<readonly WorkflowDescriptor[]>;
    describe(id: string): Promise<WorkflowDescriptor>;
    /**
     * Run a workflow. When a session is given (`sessionId`, or the legacy
     * `conversationId` alias), it is bound as the ambient session for the whole
     * run and used as the conversation/persistence key: agent steps that go
     * through the ContextStorage-backed path (e.g. `MessageProcessor`) read and
     * append history under it, so a later `run` with the same id continues that
     * conversation. Steps that don't touch conversation storage (e.g. pure
     * function steps) simply run under the bound id. Omit both for a run that is
     * not associated with any session.
     */
    run(
      id: string,
      input: unknown,
      options?: { conversationId?: string; sessionId?: string }
    ): Promise<WorkflowRunResult>;
    resume(runId: string, options: HumanInputResumeOptions): Promise<ResumeResult>;
    pending(runId: string): Promise<PendingPause | null>;
    listPending(): Promise<PendingPause[]>;
  };
  readonly sessions: {
    /** Open a session: resume `id`, or mint a fresh one when omitted. */
    open(id?: string): Promise<SessionHandle>;
    get(conversationId: string): Promise<SessionDetails | null>;
    list(): Promise<SessionSummary[]>;
    delete(conversationId: string): Promise<void>;
  };
  readonly providers: {
    use(idOrPackage: string, config?: ProviderConfig): Promise<ProviderDefinition>;
  };
  readonly mcp: {
    configure(configs: Array<MCPGlobalServerConfig & { id: string }>): Promise<void>;
    status(id: string): Promise<ServerStatus | undefined>;
    list(): Promise<string[]>;
    listServers(): Promise<readonly MCPServerInfo[]>;
    discoverTools(id: string): Promise<readonly MCPToolMetadata[]>;
    connect(id: string): Promise<void>;
    connectAll(): Promise<readonly MCPServerOperationResult[]>;
    disconnect(id: string): Promise<void>;
    disconnectAll(): Promise<readonly MCPServerOperationResult[]>;
  };
  readonly warnings: {
    /** Subscribe to config hot-reload warnings and null clears. */
    subscribe(listener: FredWarningListener): () => void;
  };
  readonly subagents: {
    spawn(options: SpawnSubagentOptions): Promise<SubagentInfo>;
    list(): Promise<SubagentInfo[]>;
    inspect(id: string): Promise<SubagentInfo | null>;
    execute(id: string, options?: ExecuteSubagentOptions): Promise<ExecuteSubagentResult>;
    destroy(id: string): Promise<boolean>;
  };
  readonly effects: {
    run<A, E>(effect: Effect.Effect<A, E, FredServices>): Promise<A>;
  };
  /**
   * Escape hatch to the Effect world: run custom Effects against the same
   * runtime (and therefore the same service state) the client uses.
   */
  readonly runtime: FredRuntime;
  /** Release all resources. Idempotent; further client calls reject with FredClientClosedError. */
  shutdown(): Promise<void>;
}

const toMCPServerConfig = (
  config: MCPGlobalServerConfig & { id: string },
): MCPServerConfig => ({
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
  healthCheckIntervalMs: config.healthCheckIntervalMs,
  allowedCommands: config.allowedCommands,
  envAllowlist: config.envAllowlist,
  allowedHosts: config.allowedHosts,
  allowedSchemes: config.allowedSchemes,
  retry: config.retry
    ? {
        maxAttempts: config.retry.maxRetries,
        initialDelayMs: config.retry.backoffMs,
        maxDelayMs: config.retry.maxBackoffMs,
      }
    : undefined,
});

const toMCPToolMetadata = (tool: Tool): MCPToolMetadata => ({
  id: tool.id,
  name: tool.name,
  description: tool.description,
  schema: tool.schema?.metadata
    ? {
        ...tool.schema.metadata,
        properties: { ...tool.schema.metadata.properties },
        required: tool.schema.metadata.required
          ? [...tool.schema.metadata.required]
          : undefined,
      }
    : undefined,
});

/**
 * Create a Fred client with an initialized Effect runtime.
 */
export async function createFred(options: CreateFredOptions = {}): Promise<FredClient> {
  const loadedConfig = options.configPath ? loadValidatedConfig(options.configPath) : undefined;
  const needsConfigRouting = options.routing === undefined;
  const needsConfigObservability = options.observability === undefined;
  const compiledConfig = loadedConfig && (needsConfigRouting || needsConfigObservability)
    ? configToLayerOptions(loadedConfig, {
        includeRouting: needsConfigRouting,
        includeObservability: needsConfigObservability,
      })
    : undefined;
  const routing = options.routing ?? compiledConfig?.routingConfig;
  const template = options.template ?? loadedConfig?.template;
  const templateBasePath = options.configPath ? dirname(options.configPath) : process.cwd();
  const persistence = loadedConfig?.persistence;
  let configuredStorage: PostgresContextStorage | SqliteContextStorage | undefined;
  let configuredCheckpointStorage: CheckpointStorage | undefined;
  if (persistence) {
    if (persistence.adapter === 'postgres') {
      const connectionString = process.env.FRED_POSTGRES_URL;
      if (!connectionString) {
        throw new Error(
          'FRED_POSTGRES_URL environment variable is required for Postgres persistence adapter',
        );
      }
      if (!options.storage) {
        configuredStorage = new PostgresContextStorage({ connectionString });
      }
      if (persistence.checkpoint?.enabled !== false) {
        configuredCheckpointStorage = new PostgresCheckpointStorage({ connectionString });
      }
    } else {
      const path = process.env.FRED_SQLITE_PATH ?? './fred.db';
      if (!options.storage) {
        configuredStorage = new SqliteContextStorage({ path });
      }
      if (persistence.checkpoint?.enabled !== false) {
        configuredCheckpointStorage = new SqliteCheckpointStorage({ path });
      }
    }
  }
  const layer = Layer.mergeAll(
    makeFredRuntimeLayer({
      routingConfig: routing,
      observabilityLayers: options.observability !== undefined
        ? buildObservabilityLayers(options.observability)
        : compiledConfig?.observabilityLayers,
      promptSourceLayer: options.promptSourceLayer,
      storage: options.storage ?? configuredStorage,
      checkpointStorage: configuredCheckpointStorage,
      checkpointTtlMs: persistence?.checkpoint?.ttlMs,
    }),
    TemplateEngineLive({ ...template, basePath: templateBasePath })
  ) as Layer.Layer<FredServices | TemplateEngine>;

  const ownedClosers: Array<() => Promise<void>> = [];
  if (configuredStorage) {
    ownedClosers.push(async () => { await configuredStorage.close(); });
  }
  if (configuredCheckpointStorage) {
    ownedClosers.push(() => configuredCheckpointStorage.close());
  }
  const closeOwnedResources = async (): Promise<void> => {
    for (const close of ownedClosers) {
      await close().catch(() => undefined);
    }
  };

  const scope = Effect.runSync(Scope.make());
  let clientRuntime: Runtime.Runtime<FredServices | TemplateEngine>;
  try {
    clientRuntime = (await Effect.runPromise(
      Scope.extend(Layer.toRuntime(layer), scope)
    )) as Runtime.Runtime<FredServices | TemplateEngine>;
  } catch (error) {
    await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
    await closeOwnedResources();
    throw error;
  }
  const mcpRegistry = new MCPServerRegistry();
  const globalVariables = new Map<string, VariableFactory>();
  const templateNamespaces = new Map<string, () => unknown>();
  const warningListeners = new Set<FredWarningListener>();
  let agentFileWatcher: AgentFileWatcher | undefined;
  const cleanupTasks: CheckpointCleanupTask[] = [];
  if (configuredCheckpointStorage) {
    const cleanupTask = new CheckpointCleanupTask(configuredCheckpointStorage, {
      intervalMs: persistence?.checkpoint?.cleanupIntervalMs ?? 3_600_000,
    });
    cleanupTask.start();
    cleanupTasks.push(cleanupTask);
  }

  // One-time service initialization, mirroring the Fred facade defaults.
  try {
    await Runtime.runPromise(clientRuntime)(Effect.gen(function* () {
      const tools = yield* ToolRegistryService;
      const agentService = yield* AgentService;
      const templateEngine = yield* TemplateEngine;
      yield* tools.registerTool(createCalculatorTool() as unknown as Tool);

      yield* agentService.setTemplateEngine(templateEngine);
      yield* agentService.setMCPServerRegistry(mcpRegistry);
      yield* agentService.setGlobalVariablesResolver(() =>
        Object.fromEntries(
          Array.from(globalVariables, ([name, factory]) => [name, Effect.runSync(factory())]),
        ),
      );
      yield* agentService.setTemplateEnvAllowlist(
        template?.envAllowlist ?? [...DEFAULT_ENV_ALLOWLIST],
      );
      yield* agentService.setTemplateFredConfig({
        defaultSystemMessage: loadedConfig?.defaultSystemMessage,
        agentDirs: loadedConfig?.agentDirs,
        template,
      });

      if (options.tracer) {
        const processor = yield* MessageProcessorService;
        yield* agentService.setTracer(options.tracer);
        yield* processor.updateConfig({ tracer: options.tracer });
      }

      if (options.storage) {
        const context = yield* ContextStorageService;
        yield* context.replaceStorage(options.storage);
      }
    }));
  } catch (error) {
    for (const task of cleanupTasks) task.stop();
    await Effect.runPromise(Scope.close(scope, Exit.void)).catch(() => undefined);
    await closeOwnedResources();
    throw error;
  }

  const runtime = clientRuntime as FredRuntime;

  let closed = false;
  const ensureOpen = (): void => {
    if (closed) {
      throw new FredClientClosedError({ message: 'FredClient has been shut down' });
    }
  };

  const run = <A, E>(
    effect: Effect.Effect<A, E, FredServices | TemplateEngine>,
  ): Promise<A> => {
    if (closed) {
      return Promise.reject(
        new FredClientClosedError({ message: 'FredClient has been shut down' })
      );
    }
    // Wrap with Effect.exit so failures never surface as unhandled fiber
    // errors; rethrow the squashed cause for a clean Promise rejection.
    return Runtime.runPromise(clientRuntime)(Effect.exit(effect)).then((exit) => {
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      const error = Cause.squash(exit.cause);
      throw error instanceof Error ? error : new Error(String(error));
    });
  };

  const emitWarning = (message: string | null): void => {
    if (closed) return;
    for (const listener of [...warningListeners]) {
      try {
        listener(message);
      } catch {
        // A consumer listener must never interrupt watcher delivery to peers.
      }
    }
  };

  const discoverMCPTools = (id: string): Promise<readonly MCPToolMetadata[]> =>
    run(Effect.map(mcpRegistry.discoverTools(id), (tools) => tools.map(toMCPToolMetadata)));

  const connectMCPServer = async (id: string): Promise<void> => {
    await run(mcpRegistry.ensureConnected(id));
    mcpRegistry.startHealthChecks();
  };

  const disconnectMCPServer = async (id: string): Promise<void> => {
    ensureOpen();
    const config = mcpRegistry.getServerConfig(id);
    await run(mcpRegistry.removeServer(id));
    if (config) mcpRegistry.registerLazyServer(id, config);
  };

  const client: FredClient = {
    agents: {
      register: (config) => run(Effect.flatMap(AgentService, (s) => s.createAgent(config))),
      remove: (id) => run(Effect.flatMap(AgentService, (s) => s.removeAgent(id))),
      get: (id) =>
        run(Effect.map(
          Effect.flatMap(AgentService, (s) => s.getAgentOptional(id)),
          (agent) => agent ?? null,
        )),
      list: () => run(Effect.flatMap(AgentService, (s) => s.getAllAgents())),
    },

    messages: {
      process: (message, processingOptions) =>
        run(Effect.flatMap(
          MessageProcessorService,
          (processor) => processor.processMessage(message, processingOptions),
        )),
    },

    tools: {
      register: (tool) => run(Effect.flatMap(ToolRegistryService, (s) => s.registerTool(tool))),
      remove: (id) => run(Effect.flatMap(ToolRegistryService, (s) => s.removeTool(id))),
      list: () => run(Effect.flatMap(ToolRegistryService, (s) => s.getAllTools())),
    },

    hooks: {
      register: (type, handler) =>
        run(Effect.flatMap(HookManagerService, (s) => s.registerHook(type, handler))),
      unregister: (type, handler) =>
        run(Effect.flatMap(HookManagerService, (s) => s.unregisterHook(type, handler))),
    },

    templates: {
      addContext: async (namespace, resolver) => {
        templateNamespaces.set(namespace, resolver);
        await run(Effect.flatMap(
          AgentService,
          (s) => s.setTemplateCustomNamespaces(
            Object.fromEntries(
              Array.from(templateNamespaces, ([name, resolveValue]) => [name, resolveValue()]),
            ),
          ),
        ));
      },
      invalidate: () => run(Effect.flatMap(TemplateEngine, (engine) => engine.invalidateCache())),
    },

    variables: {
      register: async (name, factory) => {
        ensureOpen();
        globalVariables.set(name, factory);
      },
      registerAll: async (variables) => {
        ensureOpen();
        for (const [name, factory] of Object.entries(variables)) {
          globalVariables.set(name, factory);
        }
      },
      snapshot: async () => {
        ensureOpen();
        return Object.fromEntries(
          await Promise.all(
            Array.from(globalVariables, async ([name, factory]) => [
              name,
              await Effect.runPromise(factory()),
            ]),
          ),
        );
      },
    },

    workflows: {
      define: (config) =>
        run(
          Effect.flatMap(
            PipelineService,
            (service): Effect.Effect<void, WorkflowDefineError> => service.defineWorkflow(config),
          ),
        ),
      list: () => run(Effect.flatMap(PipelineService, (service) => service.listWorkflows())),
      describe: (id) =>
        run(Effect.flatMap(PipelineService, (service) => service.describeWorkflow(id))),
      run: async (id, input, runOptions) => {
        // The session id (explicit `conversationId` wins over the `sessionId`
        // alias). When present it becomes the ambient session for the run and
        // the persistence key; when absent the run is stateless.
        const sessionId = runOptions?.conversationId ?? runOptions?.sessionId;
        const workflow = await run(
          Effect.flatMap(PipelineService, (service) => service.getWorkflowIR(id)),
        );
        const result = await executeWorkflowViaRuntime(runtime, workflow, input, {
          conversationId: sessionId,
          tracer: options.tracer,
        });
        switch (workflow.source) {
          case 'v2':
            return {
              success: result.success,
              status: result.status,
              context: result.context,
              executedNodes: result.executedNodes,
              finalOutput: result.finalOutput,
              error: result.error,
              abortedBy: result.abortedBy,
              runId: result.runId,
              pauseRequest: result.pauseRequest,
            } satisfies PipelineResult;
          case 'graph':
            return {
              success: result.success,
              context: result.context,
              outputs: result.outputs,
              executedNodes: result.executedNodes,
              error: result.error,
              abortedBy: result.abortedBy,
            } satisfies GraphExecutionResult;
          default:
            return result;
        }
      },
      resume: (runId, resumeOptions) =>
        run(Effect.flatMap(
          PipelineService,
          (service) => service.resumeWithHumanInput(runId, resumeOptions),
        )),
      pending: (runId) =>
        run(Effect.flatMap(PauseService, (service) =>
          Effect.map(Effect.either(service.getPendingPause(runId)), (result) =>
            result._tag === 'Right' ? result.right : null,
          ),
        )),
      listPending: () =>
        run(Effect.flatMap(PauseService, (service) => service.listPendingPauses())),
    },

    sessions: {
      open: (id) => run(Effect.flatMap(SessionService, (s) => s.open(id))),
      get: (conversationId) =>
        run(
          Effect.map(
            Effect.flatMap(ContextStorageService, (s) => s.getContextById(conversationId)),
            (context) => (context ? buildSessionDetails(context) : null)
          )
        ),
      list: () => run(Effect.flatMap(ContextStorageService, (s) => s.listSessions())),
      delete: (conversationId) =>
        run(Effect.flatMap(ContextStorageService, (s) => s.clearContext(conversationId))),
    },

    providers: {
      use: (idOrPackage, config = {}) =>
        run(Effect.flatMap(ProviderRegistryService, (s) => s.register(idOrPackage, config))),
    },

    mcp: {
      configure: async (configs) => {
        ensureOpen();
        for (const config of configs) {
          const serverConfig = toMCPServerConfig(config);
          if (serverConfig.enabled === false) {
            mcpRegistry.registerLazyServer(config.id, serverConfig);
            continue;
          }
          if (serverConfig.transport === 'stdio') {
            if (!serverConfig.command) {
              throw new MCPSecurityError('COMMAND_DENIED', 'MCP stdio configuration requires a command');
            }
            if (!serverConfig.allowedCommands?.length) {
              throw new MCPSecurityError(
                'COMMAND_DENIED',
                `MCP stdio server '${config.id}' requires a non-empty allowedCommands allowlist`,
              );
            }
            validateCommand(serverConfig.command, serverConfig.allowedCommands);
          } else {
            if (!serverConfig.url) {
              throw new MCPSecurityError('URL_DENIED', 'MCP HTTP/SSE configuration requires a URL');
            }
            if (!serverConfig.allowedHosts?.length || !serverConfig.allowedSchemes?.length) {
              throw new MCPSecurityError(
                'URL_DENIED',
                `MCP ${serverConfig.transport} server '${config.id}' requires non-empty allowedHosts and allowedSchemes allowlists`,
              );
            }
            validateUrl(
              serverConfig.url,
              serverConfig.allowedHosts,
              serverConfig.allowedSchemes,
            );
          }
          if (config.lazy) {
            mcpRegistry.registerLazyServer(config.id, serverConfig);
          } else {
            await run(mcpRegistry.registerAndConnect(config.id, serverConfig));
            if (!mcpRegistry.getServerConfig(config.id)) {
              // Preserve failed eager configs for discovery and later reconnects.
              mcpRegistry.registerLazyServer(config.id, serverConfig);
            }
          }
        }
        mcpRegistry.startHealthChecks();
      },
      status: async (id) => {
        ensureOpen();
        return mcpRegistry.getServerStatus(id);
      },
      list: async () => {
        ensureOpen();
        return mcpRegistry.getAllConfiguredServers();
      },
      listServers: async () => {
        ensureOpen();
        const configuredServers = mcpRegistry.getAllConfiguredServers().flatMap((id) => {
          const config = mcpRegistry.getServerConfig(id);
          return config ? [{ id, config }] : [];
        });
        return Promise.all(configuredServers.map(async ({ id, config }): Promise<MCPServerInfo> => {
          const client = mcpRegistry.getClient(id);
          const connected = client?.isConnected() ?? false;
          if (!connected) {
            return {
              id,
              transport: config.transport,
              lazy: config.lazy ?? false,
              status: mcpRegistry.getServerStatus(id) ?? 'stopped',
              connected: false,
              tools: [],
            } satisfies MCPServerInfo;
          }
          try {
            const tools = await discoverMCPTools(id);
            return {
              id,
              transport: config.transport,
              lazy: config.lazy ?? false,
              status: mcpRegistry.getServerStatus(id) ?? 'stopped',
              connected: true,
              tools,
            } satisfies MCPServerInfo;
          } catch {
            return {
              id,
              transport: config.transport,
              lazy: config.lazy ?? false,
              status: mcpRegistry.getServerStatus(id) ?? 'stopped',
              connected: true,
              tools: [],
              toolDiscoveryFailed: true,
            } satisfies MCPServerInfo;
          }
        }));
      },
      discoverTools: discoverMCPTools,
      connect: connectMCPServer,
      connectAll: async () => {
        ensureOpen();
        const results: MCPServerOperationResult[] = [];
        for (const id of mcpRegistry.getAllConfiguredServers()) {
          try {
            await connectMCPServer(id);
            results.push({ id, success: true });
          } catch (error) {
            results.push({
              id,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return results;
      },
      disconnect: disconnectMCPServer,
      disconnectAll: async () => {
        ensureOpen();
        const results: MCPServerOperationResult[] = [];
        for (const id of mcpRegistry.getRegisteredServers()) {
          try {
            await disconnectMCPServer(id);
            results.push({ id, success: true });
          } catch (error) {
            results.push({
              id,
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return results;
      },
    },

    warnings: {
      subscribe: (listener) => {
        ensureOpen();
        warningListeners.add(listener);
        let subscribed = true;
        return () => {
          if (!subscribed) return;
          subscribed = false;
          warningListeners.delete(listener);
        };
      },
    },

    subagents: {
      spawn: (spawnOptions) =>
        run(Effect.flatMap(SubagentService, (service) => service.spawnSubagent(spawnOptions))),
      list: () => run(Effect.flatMap(SubagentService, (service) => service.listSubagents())),
      inspect: (id) => run(Effect.map(
        Effect.flatMap(SubagentService, (service) => service.inspectSubagent(id)),
        (subagent) => subagent ?? null,
      )),
      execute: (id, executeOptions) =>
        run(Effect.flatMap(
          SubagentService,
          (service) => service.executeSubagent(id, executeOptions),
        )),
      destroy: (id) =>
        run(Effect.flatMap(SubagentService, (service) => service.destroySubagent(id))),
    },

    effects: { run },

    runtime,

    shutdown: async () => {
      if (closed) {
        return;
      }
      closed = true;
      warningListeners.clear();

      agentFileWatcher?.close();
      agentFileWatcher = undefined;
      for (const task of cleanupTasks) task.stop();
      await Effect.runPromise(mcpRegistry.shutdown()).catch(() => undefined);

      // Best-effort service cleanup while the runtime is still open.
      await Runtime.runPromise(runtime)(
        Effect.gen(function* () {
          const subagents = yield* SubagentService;
          const agents = yield* AgentService;
          const pipelines = yield* PipelineService;
          yield* subagents.destroyAllSubagents();
          yield* agents.clear();
          yield* pipelines.clear();
        })
      ).catch(() => undefined);

      for (const close of ownedClosers) await close().catch(() => undefined);

      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };

  if (options.configPath) {
    const initializer = new ConfigInitializer();
    const target: ConfigInitializationTarget = {
      setDefaultSystemMessage: (message) =>
        run(Effect.flatMap(AgentService, (service) => service.setDefaultSystemMessage(message))),
      setMemoryDefaults: (memory) =>
        run(Effect.flatMap(
          MessageProcessorService,
          (service) => service.updateConfig({ memoryDefaults: memory }),
        )),
      setContextPolicy: (policy) => policy
        ? run(Effect.flatMap(ContextStorageService, (service) => service.setDefaultPolicy(policy)))
        : Promise.resolve(),
      setToolPolicies: (policies) =>
        run(Effect.flatMap(ToolGateService, (service) => service.reloadPolicies(policies))),
      registerProvider: async (id, config) => { await client.providers.use(id, config); },
      registerDefaultProviders: async (providerOptions) => {
        if (providerOptions?.providers?.length) {
          for (const registration of providerOptions.providers) {
            const id = providerOptions.aliases?.[registration.id] ?? registration.id;
            const defaults = providerOptions.modelDefaults
              ? {
                  ...providerOptions.modelDefaults,
                  model: providerOptions.defaultModel ?? providerOptions.modelDefaults.model,
                }
              : providerOptions.defaultModel
                ? { model: providerOptions.defaultModel }
                : undefined;
            await client.providers.use(id, {
              ...registration.config,
              modelDefaults: registration.modelDefaults ?? defaults,
            });
          }
          return;
        }
        for (const factory of Object.values(BUILTIN_PACKS)) {
          await run(Effect.flatMap(
            ProviderRegistryService,
            (service) => service.registerFactory(factory, {}),
          )).catch(async (error) => {
            await run(Effect.logDebug('Built-in provider pack registration failed').pipe(
              Effect.annotateLogs({
                providerId: factory.id,
                error: error instanceof Error ? error.message : String(error),
              }),
            ));
          });
        }
      },
      configureMCPServers: (configs) => client.mcp.configure(configs),
      registerTool: (tool) => client.tools.register(tool),
      configureRouting: (config) =>
        run(Effect.flatMap(MessageRouterService, (service) => service.setConfig(config))),
      configureWorkflows: (workflows) => run(Effect.gen(function* () {
        const service = yield* WorkflowService;
        yield* service.clear();
        for (const workflow of workflows) {
          yield* service.addWorkflow(workflow.name, workflow);
        }
      })),
      registerIntents: (intents) => intents.length === 0
        ? Promise.resolve()
        : run(Effect.flatMap(IntentMatcherService, (service) => service.registerIntents(intents))),
      createAgent: async (config) => { await client.agents.register(config); },
      removeAgent: async (id) => { await client.agents.remove(id); },
      hasAgent: async (id) => (await client.agents.get(id)) !== null,
      defineWorkflow: async (config) => { await client.workflows.define(config); },
      getGlobalVariables: () => client.variables.snapshot(),
      invalidateTemplateCache: () => client.templates.invalidate(),
      ownAgentFileWatcher: (watcher) => {
        agentFileWatcher?.close();
        agentFileWatcher = watcher;
      },
      emitWarning,
    };
    try {
      await initializer.initializeServices(
        target,
        options.configPath,
        {
          ...options.configOptions,
          routingOverride: options.routing,
        },
        loadedConfig,
      );
    } catch (error) {
      await client.shutdown();
      throw error;
    }
  }

  return client;
}
