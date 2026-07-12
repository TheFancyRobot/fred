import { Cause, Effect, Exit, Fiber, Layer, Runtime, Stream } from 'effect';
import type { AgentResponse } from './agent/agent';
import type { GraphExecutionResult } from './pipeline/graph-executor';
import type { Tool } from './tool/tool';
import type { ProviderConfigInput } from './platform/provider';
import type { Tracer } from './tracing';
import type { StreamEvent } from './stream/events';
import type { StreamResult } from './stream/result';
import { createStreamResult } from './stream/result';
import type { ProcessingOptions } from './message-processor/types';
import { type FredLike } from './config/initializer';
import { loadConfig, extractObservability } from './config/loader';
import {
  makeFredRuntimeLayer,
  type FredLayerOptions,
  type FredRuntime,
  type FredServices,
  AgentService,
  PipelineService,
  MessageProcessorService,
  SubagentService,
  AgentStatusService,
} from './services';
import { TemplateEngine, TemplateEngineLive } from './template';
import { FredBase } from './facade';
import { executeGraphWorkflowViaRuntime, executeWorkflowViaRuntime } from './client';
import type { CompilableWorkflow } from './workflow/compile';
import type { WorkflowExecutionResult } from './workflow/execute';
import type {
  AgentStatusListener,
  AgentStatusSnapshot,
  AgentStatusUnsubscribe,
} from './observability/status';

const cloneAgentStatusSnapshot = (
  snapshot: AgentStatusSnapshot,
): AgentStatusSnapshot => snapshot.map((run) => ({ ...run }));

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
 * The public API remains Promise-based for ease of use. This class owns only
 * the runtime kernel (layer composition, lazy build, Promise boundary
 * execution); all simple service delegations live in FredBase (./facade.ts).
 *
 * New code should prefer the scoped `createFred()` client (./client.ts).
 */
export class Fred extends FredBase {
  private runtimePromise: Promise<FredRuntime> | null = null;

  /**
   * Create a new Fred instance with initialized Effect runtime.
   *
   * This is the recommended way to create Fred instances as it
   * ensures all Effect services are ready before use.
   */
  static async create(tracer?: Tracer): Promise<Fred> {
    const fred = new Fred(tracer);
    await fred.ensureRuntime();
    return fred;
  }

  constructor(tracer?: Tracer) {
    super(tracer);

    // Deprecation warning for direct construction.
    // Only warn in development to avoid noise in production.
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
   * Ensure the Effect runtime exists, building it synchronously if needed.
   *
   * The default Fred layer graph is fully synchronous, so synchronous
   * registration methods (registerTool, registerIntents, ...) can force the
   * build without awaiting. If an async layer is configured (e.g. OTel
   * observability layers), synchronous building is impossible — use
   * `await Fred.create()` or any async method first in that case.
   */
  protected ensureRuntimeSync(): FredRuntime {
    if (this.runtime) return this.runtime;

    if (this.runtimePromise) {
      throw new Error(
        'Fred runtime is currently initializing. Await Fred.create() (or a pending async call) before using synchronous registration methods.'
      );
    }

    try {
      // Built as Runtime<FredServices | TemplateEngine>; narrowed to the
      // public FredRuntime type after service initialization.
      const runtime = Effect.runSync(
        Effect.scoped(Layer.toRuntime(this.buildRuntimeLayer()))
      );
      Runtime.runSync(runtime)(this.initializeRuntimeServices());
      this.runtime = runtime as FredRuntime;
      return this.runtime;
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
          );

          await Runtime.runPromise(runtime)(this.initializeRuntimeServices());

          this.runtime = runtime as FredRuntime;
          return this.runtime;
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
  protected async runEffect<A, E>(
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
   */
  async runSafe<A, E>(effect: Effect.Effect<A, E, FredServices>): Promise<A> {
    return this.runEffect(effect, 'Effect execution failed');
  }

  /** Read the active agent runs owned by this Fred runtime. */
  async getAgentStatus(): Promise<AgentStatusSnapshot> {
    const snapshot = await this.runEffect(
      Effect.flatMap(AgentStatusService, (status) => status.snapshot),
      'Failed to read agent status',
    );
    return cloneAgentStatusSnapshot(snapshot);
  }

  /**
   * Subscribe to status snapshots from this Fred runtime.
   *
   * The listener receives an initial snapshot followed by live changes. A
   * listener exception is isolated to that notification and cannot terminate
   * the subscription fiber. The returned disposer is safe to call repeatedly.
   */
  async subscribeAgentStatus(
    listener: AgentStatusListener,
  ): Promise<AgentStatusUnsubscribe> {
    const runtime = await this.ensureRuntime();
    const notify = (snapshot: AgentStatusSnapshot): Effect.Effect<void> =>
      Effect.sync(() => listener(cloneAgentStatusSnapshot(snapshot))).pipe(
        Effect.catchAllCause(() => Effect.void),
      );
    const subscription = Effect.flatMap(AgentStatusService, (status) =>
      status.changes.pipe(Stream.runForEach(notify)),
    );
    const fiber = Runtime.runFork(runtime)(subscription);
    let active = true;

    return async () => {
      if (!active) return;
      active = false;
      await Runtime.runPromise(runtime)(Fiber.interrupt(fiber));
    };
  }

  // --- Global Variables (Promise-boundary reads; registration lives in FredBase) ---

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

  // --- Graph Workflow Execution ---

  /** Register V2, graph, or native WorkflowIR through the unified registry. */
  async defineWorkflow(config: CompilableWorkflow): Promise<void> {
    await this.runEffect(
      Effect.flatMap(PipelineService, (service) => service.defineWorkflow(config)),
      `Failed to define workflow: ${config.id}`,
    );
  }

  /** Execute any registered workflow and return the canonical unified result. */
  async executeWorkflow(
    id: string,
    input: unknown,
    options?: { conversationId?: string },
  ): Promise<WorkflowExecutionResult> {
    const runtime = await this.ensureRuntime();
    const workflow = await this.runEffect(
      Effect.flatMap(PipelineService, (service) => service.getWorkflowIR(id)),
      `Workflow not found: ${id}`,
    );
    return executeWorkflowViaRuntime(runtime, workflow, input, {
      ...options,
      tracer: this.tracer,
    });
  }

  async executeGraphWorkflow(
    id: string,
    input: string,
    options?: { conversationId?: string }
  ): Promise<GraphExecutionResult> {
    return executeGraphWorkflowViaRuntime(await this.ensureRuntime(), id, input, {
      ...options,
      tracer: this.tracer,
    });
  }

  // --- Message Processing ---

  async processMessage(message: string, options?: ProcessingOptions): Promise<AgentResponse | null> {
    return this.runEffect(
      Effect.flatMap(MessageProcessorService, (p) => p.processMessage(message, options)),
      'Failed to process message'
    );
  }

  streamMessage(message: string, options?: ProcessingOptions): StreamResult {
    const streamPromise = this.runEffect(
      this.streamMessageEffect(message, options),
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
    this.memoryDefaults = this.configInitializer.getMemoryDefaults(configPath);

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
      Effect.flatMap(MessageProcessorService, (p) =>
        p.updateConfig({ memoryDefaults: currentMemoryDefaults })
      ),
      'Failed to apply memory defaults from config'
    );

    // Delegate to config initializer
    await this.configInitializer.initialize(this as unknown as FredLike, configPath, options);
  }

  /**
   * Shutdown Fred and release all resources.
   *
   * This closes database connections, MCP clients, and other resources.
   * Call this when your application exits.
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

// Public type alias for consumers that need a stable identifier
// independent of the concrete Fred class implementation.
export type FredInstance = Fred;

// Scoped Promise client (recommended for new code)
export {
  createFred,
  FredClientClosedError,
  executeGraphWorkflowViaRuntime,
  executeWorkflowViaRuntime,
  type FredClient,
  type FredWarningListener,
  type MCPServerInfo,
  type MCPServerOperationResult,
  type MCPToolMetadata,
  type CreateFredOptions,
  type WorkflowDefinition,
  type WorkflowRunResult,
} from './client';

// Re-export all types, services, and utilities (see ./exports.ts).
// Effect-native consumers should import from '@fancyrobot/fred/effect'.
export * from './exports';
