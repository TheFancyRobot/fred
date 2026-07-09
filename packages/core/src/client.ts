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
import type { AgentConfig, AgentInstance, AgentResponse } from './agent/agent';
import type { AnyPipelineConfig } from './pipeline/pipeline';
import { isPipelineConfigV2 } from './pipeline/pipeline';
import type { PipelineConfig } from './pipeline';
import type { GraphWorkflowConfig } from './pipeline/graph';
import type { GraphExecutionResult } from './pipeline/graph-executor';
import { executeGraphWorkflowEffect } from './pipeline/graph-executor';
import type { AgentManagerLike, HookManagerLike, PipelineResult } from './pipeline/executor';
import type {
  GraphValidationError,
  PipelineAlreadyExistsError,
  PipelineExecutionError,
} from './pipeline/errors';
import type { HookType } from './hooks';
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
import { TemplateEngine, TemplateEngineLive } from './template';

/**
 * Execute a registered graph workflow against an existing Fred runtime.
 *
 * Bridges the Effect-native graph executor to the Promise world: builds the
 * Promise-shaped agent/hook adapters the executor expects, and mirrors the
 * legacy error-to-result conversion (execution failures become a
 * `success: false` result instead of a rejection).
 */
export async function executeGraphWorkflowViaRuntime(
  runtime: FredRuntime,
  id: string,
  input: string,
  options: { conversationId?: string; tracer?: Tracer } = {}
): Promise<GraphExecutionResult> {
  const configExit = await Runtime.runPromise(runtime)(
    Effect.exit(Effect.flatMap(PipelineService, (s) => s.getGraphWorkflow(id)))
  );
  if (Exit.isFailure(configExit)) {
    throw new Error(`Graph workflow not found: ${id}`);
  }
  const config = configExit.value;

  const agents = await Runtime.runPromise(runtime)(
    Effect.flatMap(AgentService, (s) => s.getAllAgents())
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
    Effect.map(HookManagerService, (hooks): HookManagerLike => ({
      executeHooks: (hookName, event) =>
        Runtime.runPromise(runtime)(hooks.executeHooks(hookName as HookType, event)).then(() => undefined),
      executeHooksAndMerge: (hookName, event) =>
        Runtime.runPromise(runtime)(hooks.executeHooksAndMerge(hookName as HookType, event)),
    }))
  ).catch(() => undefined);

  const graphOptions = {
    agentManager,
    hookManager,
    tracer: options.tracer,
    conversationId: options.conversationId,
  };

  // Use the Effect-native path with the Fred runtime instead of the deprecated
  // function which uses Effect.runCallback without a runtime, causing hangs
  // when graph nodes call back into Runtime.runPromise.
  //
  // When a conversation/session id is given, bind it as the ambient session for
  // the whole graph run so session-aware nodes (and any nested
  // MessageProcessorService.processMessage) observe it through the environment —
  // matching the v1/v2 pipeline paths in workflows.run.
  const graphEffect = executeGraphWorkflowEffect(config, input, graphOptions);
  const scoped = options.conversationId
    ? Effect.flatMap(SessionService, (session) =>
        session.withSession(options.conversationId!, graphEffect)
      )
    : graphEffect;
  const exit = await Runtime.runPromise(runtime)(Effect.exit(scoped));

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
}

/** A workflow definition: a V1 pipeline, a V2 pipeline, or a graph workflow. */
export type WorkflowDefinition = AnyPipelineConfig | GraphWorkflowConfig;

/** Failures workflows.define can produce across the three workflow kinds. */
export type WorkflowDefineError =
  | PipelineAlreadyExistsError
  | PipelineExecutionError
  | GraphValidationError;

/** Result of workflows.run — shape depends on the workflow kind. */
export type WorkflowRunResult = AgentResponse | PipelineResult | GraphExecutionResult;

export interface FredClient {
  readonly agents: {
    register(config: AgentConfig): Promise<AgentInstance>;
    remove(id: string): Promise<boolean>;
    list(): Promise<AgentInstance[]>;
  };
  readonly workflows: {
    define(config: WorkflowDefinition): Promise<void>;
    /**
     * Run a workflow. When a session is given (`sessionId`, or the legacy
     * `conversationId` alias), it is made the ambient session for the whole run
     * — every agent/function inside reads and writes the same conversation
     * history through the Effect environment, and the exchange persists under
     * that id so a later `run` with the same id resumes the conversation.
     * Omit both for a stateless, non-persisted run.
     */
    run(
      id: string,
      input: string,
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

const isGraphWorkflowConfig = (config: WorkflowDefinition): config is GraphWorkflowConfig =>
  'nodes' in config;

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
    }),
    TemplateEngineLive({ ...options.template, basePath: process.cwd() })
  ) as Layer.Layer<FredServices | TemplateEngine>;

  const scope = Effect.runSync(Scope.make());
  const runtime = (await Effect.runPromise(
    Scope.extend(Layer.toRuntime(layer), scope)
  )) as FredRuntime;

  // One-time service initialization, mirroring the Fred facade defaults.
  await Runtime.runPromise(runtime)(
    Effect.gen(function* () {
      const tools = yield* ToolRegistryService;
      yield* tools.registerTool(createCalculatorTool() as unknown as Tool);

      if (options.tracer) {
        const agentService = yield* AgentService;
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
          Effect.flatMap(PipelineService, (s): Effect.Effect<void, WorkflowDefineError> => {
            if (isGraphWorkflowConfig(config)) {
              return s.registerGraphWorkflow(config);
            }
            if (isPipelineConfigV2(config)) {
              return s.createPipelineV2(config);
            }
            return Effect.asVoid(s.createPipeline(config as PipelineConfig));
          })
        ),
      run: async (id, input, runOptions) => {
        // The session id (explicit `conversationId` wins over the `sessionId`
        // alias). When present it becomes the ambient session for the run and
        // the persistence key; when absent the run is stateless.
        const sessionId = runOptions?.conversationId ?? runOptions?.sessionId;
        const execOptions = sessionId ? { conversationId: sessionId } : undefined;

        const kind = await run(
          Effect.flatMap(PipelineService, (s) =>
            Effect.all({
              graph: s.hasGraphWorkflow(id),
              v2: s.hasPipelineV2(id),
            })
          )
        );
        if (kind.graph) {
          if (closed) {
            throw new FredClientClosedError({ message: 'FredClient has been shut down' });
          }
          return executeGraphWorkflowViaRuntime(runtime, id, input, {
            conversationId: sessionId,
            tracer: options.tracer,
          });
        }

        const exec: Effect.Effect<WorkflowRunResult, PipelineExecutionError, PipelineService> =
          kind.v2
            ? Effect.flatMap(PipelineService, (s) => s.executePipelineV2(id, input, execOptions))
            : Effect.flatMap(PipelineService, (s) => s.executePipeline(id, input, [], execOptions));

        // Bind the ambient session for the whole run so nested agents/functions
        // observe it through the environment without manual threading.
        const scoped = sessionId
          ? Effect.flatMap(SessionService, (session) => session.withSession(sessionId, exec))
          : exec;

        return run(scoped);
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
