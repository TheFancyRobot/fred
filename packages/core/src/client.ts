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
import type * as Schema from 'effect/Schema';
import type {
  AgentConfig,
  AgentInstance,
  AgentResponse,
  AnyAgentInstance,
} from './agent/agent';
import type { AnyPipelineConfig } from './pipeline/pipeline';
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
import type { Tool } from './tool/tool';
import { createCalculatorTool } from './tool/calculator';
import type { ProviderConfig, ProviderDefinition } from './platform/provider';
import type { Tracer } from './tracing';
import type { RoutingConfig } from './routing/types';
import { buildObservabilityLayers } from './observability/otel';
import type { ObservabilityConfig, TemplateConfig } from './config/types';
import type { ContextStorage, SessionDetails, SessionSummary } from './context/context';
import { buildSessionDetails } from './context/session';
import {
  makeFredRuntimeLayer,
  type FredLayerOptions,
  type FredRuntime,
  type FredServices,
  ToolRegistryService,
  AgentService,
  PipelineService,
  ContextStorageService,
  ProviderRegistryService,
  HookManagerService,
  MessageProcessorService,
  SubagentService,
  SessionService,
} from './services';
import type { SessionHandle } from './context/session-service';
import { resolveAmbientConversationId } from './context/session-service';
import { TemplateEngine, TemplateEngineLive } from './template';

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
      return nestedResult.finalResponse ?? nestedResult.finalOutput;
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

/** A workflow definition: a V1 pipeline, a V2 pipeline, or a graph workflow. */
export type WorkflowDefinition = AnyPipelineConfig | GraphWorkflowConfig | WorkflowIR;

/** Failures workflows.define can produce across the three workflow kinds. */
export type WorkflowDefineError =
  | PipelineAlreadyExistsError
  | PipelineExecutionError
  | GraphValidationError;

/** Result of workflows.run — shape depends on the workflow kind. */
export type WorkflowRunResult =
  | AgentResponse
  | PipelineResult
  | GraphExecutionResult
  | WorkflowExecutionResult;

export interface FredClient {
  readonly agents: {
    register<
      InputSchema extends Schema.Schema.AnyNoContext = typeof Schema.String,
      OutputSchema extends Schema.Schema.AnyNoContext = typeof Schema.Unknown,
    >(
      config: AgentConfig<InputSchema, OutputSchema>
    ): Promise<AgentInstance<InputSchema, OutputSchema>>;
    remove(id: string): Promise<boolean>;
    list(): Promise<AnyAgentInstance[]>;
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
  /**
   * Escape hatch to the Effect world: run custom Effects against the same
   * runtime (and therefore the same service state) the client uses.
   */
  readonly runtime: FredRuntime;
  /** Release all resources. Idempotent; further client calls reject with FredClientClosedError. */
  shutdown(): Promise<void>;
}

/**
 * Create a Fred client with an initialized Effect runtime.
 */
export async function createFred(options: CreateFredOptions = {}): Promise<FredClient> {
  const layer = Layer.mergeAll(
    makeFredRuntimeLayer({
      routingConfig: options.routing,
      observabilityLayers: options.observability
        ? buildObservabilityLayers(options.observability)
        : undefined,
      promptSourceLayer: options.promptSourceLayer,
    }),
    TemplateEngineLive({ ...options.template, basePath: process.cwd() })
  ) as Layer.Layer<FredServices | TemplateEngine>;

  const scope = Effect.runSync(Scope.make());
  const clientRuntime = (await Effect.runPromise(
    Scope.extend(Layer.toRuntime(layer), scope)
  )) as Runtime.Runtime<FredServices | TemplateEngine>;

  // One-time service initialization, mirroring the Fred facade defaults.
  await Runtime.runPromise(clientRuntime)(
    Effect.gen(function* () {
      const tools = yield* ToolRegistryService;
      const agentService = yield* AgentService;
      const templateEngine = yield* TemplateEngine;
      yield* tools.registerTool(createCalculatorTool() as unknown as Tool);

      yield* agentService.setTemplateEngine(templateEngine);

      if (options.tracer) {
        const processor = yield* MessageProcessorService;
        yield* agentService.setTracer(options.tracer);
        yield* processor.updateConfig({ tracer: options.tracer });
      }

      if (options.storage) {
        const context = yield* ContextStorageService;
        yield* context.replaceStorage(options.storage);
      }
    })
  );

  const runtime = clientRuntime as FredRuntime;

  let closed = false;

  const run = <A, E>(effect: Effect.Effect<A, E, FredServices>): Promise<A> => {
    if (closed) {
      return Promise.reject(
        new FredClientClosedError({ message: 'FredClient has been shut down' })
      );
    }
    // Wrap with Effect.exit so failures never surface as unhandled fiber
    // errors; rethrow the squashed cause for a clean Promise rejection.
    return Runtime.runPromise(runtime)(Effect.exit(effect)).then((exit) => {
      if (Exit.isSuccess(exit)) {
        return exit.value;
      }
      const error = Cause.squash(exit.cause);
      throw error instanceof Error ? error : new Error(String(error));
    });
  };

  return {
    agents: {
      register: (config) => run(Effect.flatMap(AgentService, (s) => s.createAgent(config))),
      remove: (id) => run(Effect.flatMap(AgentService, (s) => s.removeAgent(id))),
      list: () => run(Effect.flatMap(AgentService, (s) => s.getAllAgents())),
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
          case 'v1':
            if (!result.finalResponse) throw new Error(`Workflow did not produce a response: ${id}`);
            return result.finalResponse;
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

    runtime,

    shutdown: async () => {
      if (closed) {
        return;
      }
      closed = true;

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

      await Effect.runPromise(Scope.close(scope, Exit.void));
    },
  };
}
