import { Context, Effect, Layer, Ref } from 'effect';
import type { PipelineConfigV2 } from './pipeline';
import type { PipelineResult } from './executor';
import { isGraphWorkflowConfig, type GraphWorkflowConfig } from './graph';
import type { GraphExecutionResult } from './graph-executor';
import type { GraphWorkflowBuilder } from './graph-builder';
import type {
  AgentInvocationMetadata,
  AgentMessage,
} from '../agent/agent';
import type { ResumeOptions, ResumeResult } from './resume';
import type { HumanInputResumeOptions } from './pause/types';
import type { CheckpointStatus } from './checkpoint/types';
import type { PipelineContext } from './context';
import {
  PipelineNotFoundError,
  PipelineAlreadyExistsError,
  PipelineExecutionError,
  GraphValidationError,
  ResumeCheckpointNotFoundError,
  ResumeCheckpointExpiredError,
  ResumeInvalidStateError,
  ResumePipelineNotFoundError,
  ResumeStepNotResolvableError,
  ResumeNotPausedError,
  type ResumeError
} from './errors';
import { AgentService } from '../agent/service';
import {
  WorkflowInputValidationError,
  WorkflowOutputValidationError,
} from '../workflow/errors';
import { HookManagerService } from '../hooks/service';
import { resolveAmbientConversationId } from '../context/session-service';
import { CheckpointService } from './checkpoint/service';
import { PauseService } from './pause/service';
import { validateGraphWorkflow } from './graph-validator';
import { validateId } from '../utils/validation';
import {
  type AgentManagerLike,
  ExecutorService,
  type ExecutorService as ExecutorServiceApi,
  type ExtendedExecutionOptions,
} from './executor';
import {
  GraphExecutorService,
  type GraphExecutorService as GraphExecutorServiceApi,
} from './graph-executor';
import {
  compileGraphWorkflow,
  compilePipelineV2,
  compileWorkflow,
  isPipelineV2Definition,
  isWorkflowIR,
  type CompilableWorkflow,
} from '../workflow/compile';
import type { WorkflowIR } from '../workflow/ir';
import { describeWorkflow, type WorkflowDescriptor } from '../workflow/contracts';
import {
  executeWorkflowEffect,
  getPublicWorkflowOutputs,
  workflowInputToMessage,
} from '../workflow/execute';

/**
 * PipelineService interface for Effect-based pipeline management
 */
export interface PipelineService {
  /** Clear all registered V2, graph, and native workflows. */
  clear(): Effect.Effect<void>;

  /** Register any workflow dialect through the single IR compile path. */
  defineWorkflow(
    config: CompilableWorkflow,
  ): Effect.Effect<void, PipelineAlreadyExistsError | PipelineExecutionError | GraphValidationError>;

  /** Get the canonical compiled representation for any registered workflow. */
  getWorkflowIR(id: string): Effect.Effect<WorkflowIR, PipelineNotFoundError>;

  /** List immutable transport-neutral descriptors from the canonical registry. */
  listWorkflows(): Effect.Effect<readonly WorkflowDescriptor[]>;

  /** Describe one registered workflow without exposing its executable IR. */
  describeWorkflow(id: string): Effect.Effect<WorkflowDescriptor, PipelineNotFoundError>;

  /** Check the unified workflow registry. */
  hasWorkflowIR(id: string): Effect.Effect<boolean>;

  // ==========================================
  // V2 Pipeline Methods
  // ==========================================

  /**
   * Create a V2 pipeline from configuration
   */
  createPipelineV2(config: PipelineConfigV2): Effect.Effect<void, PipelineAlreadyExistsError | PipelineExecutionError>;

  /**
   * Get a V2 pipeline by ID
   */
  getPipelineV2(id: string): Effect.Effect<PipelineConfigV2, PipelineNotFoundError>;

  /**
   * Check if a V2 pipeline exists
   */
  hasPipelineV2(id: string): Effect.Effect<boolean>;

  /**
   * Get all V2 pipelines
   */
  getAllPipelinesV2(): Effect.Effect<PipelineConfigV2[]>;

  /**
   * Execute a V2 pipeline
   */
  executePipelineV2(
    pipelineId: string,
    input: string,
    options?: {
      conversationId?: string;
      history?: Array<{ role: string; content: string }>;
    }
  ): Effect.Effect<PipelineResult, PipelineExecutionError>;

  // ==========================================
  // Resume Methods
  // ==========================================

  /**
   * Resume a V2 pipeline from a checkpoint.
   * Restores checkpoint state as source of truth and continues execution.
   */
  resume(runId: string, options?: ResumeOptions): Effect.Effect<ResumeResult, ResumeError | PipelineExecutionError>;

  /**
   * Resume a paused V2 pipeline with human input.
   * Only unblocks paused checkpoints and preserves non-input checkpoint state.
   */
  resumeWithHumanInput(
    runId: string,
    options: HumanInputResumeOptions
  ): Effect.Effect<ResumeResult, ResumeError | PipelineExecutionError>;

  // ==========================================
  // Graph Workflow Methods
  // ==========================================

  /**
   * Register a graph workflow configuration
   */
  registerGraphWorkflow(config: GraphWorkflowConfig): Effect.Effect<void, GraphValidationError>;

  /**
   * Get a graph workflow by ID
   */
  getGraphWorkflow(id: string): Effect.Effect<GraphWorkflowConfig, PipelineNotFoundError>;

  /**
   * Check if a graph workflow exists
   */
  hasGraphWorkflow(id: string): Effect.Effect<boolean>;

  /**
   * Get all graph workflows
   */
  getAllGraphWorkflows(): Effect.Effect<GraphWorkflowConfig[]>;

  /**
   * Execute a graph workflow with structured concurrency
   * Fork nodes create parallel fibers, join nodes collect results
   */
  executeGraphWorkflow(
    id: string,
    input: string,
    options?: { conversationId?: string }
  ): Effect.Effect<GraphExecutionResult, PipelineExecutionError>;

  /**
   * Create a graph workflow from a builder and register it
   */
  createGraphWorkflowFromBuilder(builder: GraphWorkflowBuilder): Effect.Effect<GraphWorkflowConfig, GraphValidationError>;

  // ==========================================
  // Pause Manager Access
  // ==========================================

  /**
   * Get the pause service for direct access
   */
  getPauseService(): Effect.Effect<PauseService>;
}

export const PipelineService = Context.GenericTag<PipelineService>('PipelineService');

/**
 * Implementation of PipelineService
 */
class PipelineServiceImpl implements PipelineService {
  constructor(
    private pipelinesV2: Ref.Ref<Map<string, PipelineConfigV2>>,
    private graphWorkflows: Ref.Ref<Map<string, GraphWorkflowConfig>>,
    private workflows: Ref.Ref<Map<string, WorkflowIR>>,
    private agentService: AgentService,
    private executorService: ExecutorServiceApi,
    private graphExecutorService: GraphExecutorServiceApi,
    private hookService: HookManagerService,
    private checkpointService: CheckpointService,
    private pauseService: PauseService
  ) {}

  clear(): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      yield* Ref.set(self.pipelinesV2, new Map());
      yield* Ref.set(self.graphWorkflows, new Map());
      yield* Ref.set(self.workflows, new Map());
    });
  }

  defineWorkflow(
    config: CompilableWorkflow,
  ): Effect.Effect<void, PipelineAlreadyExistsError | PipelineExecutionError | GraphValidationError> {
    const self = this;
    if (isGraphWorkflowConfig(config)) return self.registerGraphWorkflow(config);
    if (!isWorkflowIR(config)) {
      if (!isPipelineV2Definition(config)) {
        const unsupportedConfig: unknown = config;
        const pipelineId = typeof unsupportedConfig === 'object' &&
          unsupportedConfig !== null &&
          'id' in unsupportedConfig
          ? String(unsupportedConfig.id)
          : '(unknown)';
        return Effect.fail(new PipelineExecutionError({
          pipelineId,
          step: 0,
          cause: new Error(
            'Unsupported workflow definition. Expected a V2 workflow with a steps array, a graph workflow, or native WorkflowIR.',
          ),
        }));
      }
      return self.createPipelineV2(config);
    }

    return Effect.gen(function* () {
      yield* Effect.try({
        try: () => validateId(config.id, 'Workflow ID'),
        catch: (error) => new GraphValidationError({
          workflowId: config.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      });
      const workflows = yield* Ref.get(self.workflows);
      if (workflows.has(config.id)) {
        return yield* new PipelineAlreadyExistsError({ id: config.id });
      }
      const workflow = yield* Effect.try({
        try: () => compileWorkflow(config),
        catch: (error) => new GraphValidationError({
          workflowId: config.id,
          message: error instanceof Error ? error.message : String(error),
        }),
      });
      const next = new Map(workflows);
      next.set(workflow.id, workflow);
      yield* Ref.set(self.workflows, next);
    });
  }

  getWorkflowIR(id: string): Effect.Effect<WorkflowIR, PipelineNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const workflow = (yield* Ref.get(self.workflows)).get(id);
      if (!workflow) return yield* new PipelineNotFoundError({ id });
      return workflow;
    });
  }

  listWorkflows(): Effect.Effect<readonly WorkflowDescriptor[]> {
    return Ref.get(this.workflows).pipe(
      Effect.map((workflows) => Object.freeze([...workflows.values()].map(describeWorkflow))),
    );
  }

  describeWorkflow(id: string): Effect.Effect<WorkflowDescriptor, PipelineNotFoundError> {
    return this.getWorkflowIR(id).pipe(Effect.map(describeWorkflow));
  }

  hasWorkflowIR(id: string): Effect.Effect<boolean> {
    return Ref.get(this.workflows).pipe(Effect.map((workflows) => workflows.has(id)));
  }

  // ==========================================
  // V2 Pipeline Methods (simplified implementation)
  // ==========================================

  createPipelineV2(config: PipelineConfigV2): Effect.Effect<void, PipelineAlreadyExistsError | PipelineExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      // Validate ID using Effect.try
      yield* Effect.try({
        try: () => validateId(config.id, 'Pipeline ID'),
        catch: (error) => new PipelineExecutionError({
          pipelineId: config.id,
          step: 0,
          cause: error
        })
      });

      const pipelines = yield* Ref.get(self.pipelinesV2);
      const workflows = yield* Ref.get(self.workflows);
      if (pipelines.has(config.id) || workflows.has(config.id)) {
        return yield* Effect.fail(new PipelineAlreadyExistsError({ id: config.id }));
      }
      const workflow = yield* Effect.try({
        try: () => compilePipelineV2(config),
        catch: (error) => new PipelineExecutionError({
          pipelineId: config.id,
          step: 0,
          cause: error,
        }),
      });
      const newPipelines = new Map(pipelines);
      newPipelines.set(config.id, config);
      yield* Ref.set(self.pipelinesV2, newPipelines);
      yield* Ref.update(self.workflows, (workflows) => {
        const next = new Map(workflows);
        next.set(config.id, workflow);
        return next;
      });
    });
  }

  getPipelineV2(id: string): Effect.Effect<PipelineConfigV2, PipelineNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelinesV2);
      const config = pipelines.get(id);
      if (!config) return yield* Effect.fail(new PipelineNotFoundError({ id }));
      return config;
    });
  }

  hasPipelineV2(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelinesV2);
      return pipelines.has(id);
    });
  }

  getAllPipelinesV2(): Effect.Effect<PipelineConfigV2[]> {
    const self = this;
    return Effect.gen(function* () {
      const pipelines = yield* Ref.get(self.pipelinesV2);
      return Array.from(pipelines.values());
    });
  }

  executePipelineV2(
    pipelineId: string,
    input: string,
    options?: { conversationId?: string; history?: Array<{ role: string; content: string }> }
  ): Effect.Effect<PipelineResult, PipelineExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      // Get V2 pipeline config from service state
      const config = yield* self.getPipelineV2(pipelineId).pipe(
        Effect.mapError(() => new PipelineExecutionError({
          pipelineId,
          step: 0,
          cause: new Error(`V2 Pipeline not found: ${pipelineId}`)
        }))
      );

      // Fall back to the ambient session id when the caller doesn't pass one,
      // so `withSession(id, executePipelineV2(input))` runs under that session
      // without threading a conversationId by hand (explicit still wins).
      const conversationId = yield* resolveAmbientConversationId(options?.conversationId);

      const executorOptions: ExtendedExecutionOptions = {
        agentManager: self.createExecutorAgentManager(),
        conversationId,
        history: options?.history,
      };

      const result = yield* self.executorService.executePipelineV2(config, input, executorOptions).pipe(
        Effect.mapError((error) => new PipelineExecutionError({
          pipelineId,
          step: 0,
          cause: error.cause,
        }))
      );

      // If executor returned a failed result, fail the Effect
      if (!result.success && result.status === 'failed') {
        return yield* Effect.fail(new PipelineExecutionError({
          pipelineId,
          step: 0,
          cause: result.error ?? new Error('Pipeline execution failed')
        }));
      }

      return result;
    });
  }

  private createExecutorAgentManager(): AgentManagerLike {
    const self = this;
    return {
      getAgent: (id: string) => {
        // Create a lazy agent wrapper that resolves the real agent on demand
        // processMessage returns Effect, bridged to Promise via Effect.runPromise in executor
        return {
          id,
          config: { id } as any,
          processMessage: (
            message: string,
            history?: AgentMessage[],
            metadata?: AgentInvocationMetadata
          ) => {
            return Effect.gen(function* () {
              const agent = yield* self.agentService.getAgent(id);
              return yield* agent.processMessage(message, history, metadata);
            });
          },
        } as any;
      },
      hasAgent: (id: string) => {
        // Synchronous check - run Effect synchronously
        try {
          return Effect.runSync(self.agentService.hasAgent(id));
        } catch {
          return false;
        }
      },
    };
  }

  // ==========================================
  // Resume Methods - Standalone Effect State Machine
  // ==========================================

  /**
   * Resume a V2 pipeline from a checkpoint.
   *
   * State machine flow:
   * 1. Load checkpoint by runId
   * 2. Validate checkpoint state (not expired, resumable status)
   * 3. Load pipeline config
   * 4. Compute start step based on resume mode
   * 5. Execute from computed step with restored context
   * 6. Return typed ResumeResult
   */
  resume(runId: string, options?: ResumeOptions): Effect.Effect<ResumeResult, ResumeError | PipelineExecutionError> {
    const self = this;
    const mode = options?.mode ?? 'skip';

    return Effect.gen(function* () {
      // Step 1: Load checkpoint
      const checkpointResult = yield* Effect.either(
        self.checkpointService.getLatestCheckpoint(runId)
      );

      if (checkpointResult._tag === 'Left') {
        return yield* Effect.fail(new ResumeCheckpointNotFoundError({ runId }));
      }

      const checkpoint = checkpointResult.right;

      // Step 2: Validate checkpoint state
      // Check expiry
      const now = new Date();
      if (checkpoint.expiresAt && checkpoint.expiresAt < now) {
        return yield* Effect.fail(new ResumeCheckpointExpiredError({
          runId,
          pipelineId: checkpoint.pipelineId,
          expiresAt: checkpoint.expiresAt,
        }));
      }

      // Check status is resumable (not completed, not failed for normal resume)
      const resumableStatuses: CheckpointStatus[] = ['in_progress', 'paused', 'pending'];
      if (!resumableStatuses.includes(checkpoint.status)) {
        return yield* Effect.fail(new ResumeInvalidStateError({
          runId,
          pipelineId: checkpoint.pipelineId,
          step: checkpoint.step,
          status: checkpoint.status,
          expectedStatus: 'in_progress, paused, or pending',
        }));
      }

      // Step 3: Load pipeline config
      const configResult = yield* Effect.either(
        self.getPipelineV2(checkpoint.pipelineId)
      );

      if (configResult._tag === 'Left') {
        return yield* Effect.fail(new ResumePipelineNotFoundError({
          runId,
          pipelineId: checkpoint.pipelineId,
        }));
      }

      const config = configResult.right;

      // Step 4: Compute start step based on mode
      let startStep: number;
      switch (mode) {
        case 'skip':
          // Start from step after checkpoint
          startStep = checkpoint.step + 1;
          break;
        case 'retry':
          // Re-execute checkpointed step
          startStep = checkpoint.step;
          break;
        case 'restart':
          // Start from beginning with restored context
          startStep = 0;
          break;
        default:
          startStep = checkpoint.step + 1;
      }

      // Best-effort step validation: if startStep exceeds pipeline length, try to find step by name
      if (startStep >= config.steps.length && checkpoint.stepName) {
        const stepIndex = config.steps.findIndex(s => s.name === checkpoint.stepName);
        if (stepIndex >= 0) {
          // Found step by name, adjust startStep
          startStep = mode === 'skip' ? stepIndex + 1 : stepIndex;
        }
      }

      // Special case: if mode is 'skip' and startStep equals pipeline length,
      // the pipeline has completed all steps - return completed result
      if (mode === 'skip' && startStep === config.steps.length) {
        const workflow = compilePipelineV2(config);
        const outputs = getPublicWorkflowOutputs(workflow, checkpoint.context.outputs);
        return {
          success: true,
          status: 'completed',
          context: { ...checkpoint.context, outputs },
          finalOutput: outputs,
          runId,
          resumedFromStep: checkpoint.step,
        } as ResumeResult;
      }

      // If still out of bounds, fail with resolvable error
      if (startStep >= config.steps.length) {
        return yield* Effect.fail(new ResumeStepNotResolvableError({
          runId,
          pipelineId: checkpoint.pipelineId,
          step: checkpoint.step,
          stepName: checkpoint.stepName,
          availableSteps: config.steps.map(s => s.name),
        }));
      }

      // Step 5: Execute from computed step with restored context
      const executorOptions: ExtendedExecutionOptions = {
        agentManager: self.createExecutorAgentManager(),
        conversationId: options?.conversationId ?? checkpoint.context.conversationId,
        history: checkpoint.context.history as Array<{ role: string; content: string }>,
        runId,
        startStep,
        restoredContext: checkpoint.context,
      };

      const result = yield* self.executorService.executePipelineV2(
        config,
        workflowInputToMessage(checkpoint.context.input),
        executorOptions,
      ).pipe(
        Effect.mapError((error) => new PipelineExecutionError({
          pipelineId: checkpoint.pipelineId,
          step: startStep,
          cause: error.cause,
        }))
      );

      // If executor returned a failed result, fail the Effect
      if (!result.success && result.status === 'failed') {
        return yield* Effect.fail(new PipelineExecutionError({
          pipelineId: checkpoint.pipelineId,
          step: startStep,
          cause: result.error ?? new Error('Pipeline execution failed'),
        }));
      }

      // Step 6: Return typed ResumeResult
      return {
        ...result,
        runId,
        resumedFromStep: checkpoint.step,
      } as ResumeResult;
    });
  }

  /**
   * Resume a paused V2 pipeline with human input.
   *
   * Only unblocks paused checkpoints. Validates:
   * 1. Checkpoint exists
   * 2. Checkpoint is in 'paused' status
   * 3. Checkpoint is not expired
   *
   * Preserves all non-input checkpoint state (outputs, metadata, history).
   */
  resumeWithHumanInput(
    runId: string,
    options: HumanInputResumeOptions
  ): Effect.Effect<ResumeResult, ResumeError | PipelineExecutionError> {
    const self = this;

    return Effect.gen(function* () {
      // Step 1: Load checkpoint
      const checkpointResult = yield* Effect.either(
        self.checkpointService.getLatestCheckpoint(runId)
      );

      if (checkpointResult._tag === 'Left') {
        return yield* Effect.fail(new ResumeCheckpointNotFoundError({ runId }));
      }

      const checkpoint = checkpointResult.right;

      // Step 2: Validate checkpoint is paused (strict check for human input resume)
      if (checkpoint.status !== 'paused') {
        return yield* Effect.fail(new ResumeNotPausedError({
          runId,
          pipelineId: checkpoint.pipelineId,
          step: checkpoint.step,
          status: checkpoint.status,
        }));
      }

      // Step 3: Check expiry
      const now = new Date();
      if (checkpoint.expiresAt && checkpoint.expiresAt < now) {
        return yield* Effect.fail(new ResumeCheckpointExpiredError({
          runId,
          pipelineId: checkpoint.pipelineId,
          expiresAt: checkpoint.expiresAt,
        }));
      }

      // Step 4: Load pipeline config
      const configResult = yield* Effect.either(
        self.getPipelineV2(checkpoint.pipelineId)
      );

      if (configResult._tag === 'Left') {
        return yield* Effect.fail(new ResumePipelineNotFoundError({
          runId,
          pipelineId: checkpoint.pipelineId,
        }));
      }

      const config = configResult.right;

      // Step 5: Determine resume behavior
      const resumeBehavior = options.resumeBehavior ??
        checkpoint.pauseMetadata?.resumeBehavior ??
        'continue';

      // Compute start step based on resume behavior
      let startStep: number;
      if (resumeBehavior === 'rerun') {
        // Re-execute the paused step with human input
        startStep = checkpoint.step;
      } else {
        // Continue to next step after pause point
        startStep = checkpoint.step + 1;
      }

      // Step 6: Inject human input into context
      const enrichedContext: PipelineContext = {
        ...checkpoint.context,
        metadata: {
          ...checkpoint.context.metadata,
          humanInput: options.humanInput,
        },
      };

      // Step 7: Update checkpoint status to in_progress before resuming
      yield* self.checkpointService.updateStatus(runId, checkpoint.step, 'in_progress');

      // Step 8: Execute from computed step with enriched context
      const executorOptions: ExtendedExecutionOptions = {
        agentManager: self.createExecutorAgentManager(),
        conversationId: options.conversationId ?? checkpoint.context.conversationId,
        history: enrichedContext.history as Array<{ role: string; content: string }>,
        runId,
        startStep,
        restoredContext: enrichedContext,
      };

      const result = yield* self.executorService.executePipelineV2(
        config,
        workflowInputToMessage(enrichedContext.input),
        executorOptions,
      ).pipe(
        Effect.mapError((error) => new PipelineExecutionError({
          pipelineId: checkpoint.pipelineId,
          step: startStep,
          cause: error.cause,
        }))
      );

      // If executor returned a failed result, fail the Effect
      if (!result.success && result.status === 'failed') {
        return yield* Effect.fail(new PipelineExecutionError({
          pipelineId: checkpoint.pipelineId,
          step: startStep,
          cause: result.error ?? new Error('Pipeline execution failed'),
        }));
      }

      // Return typed ResumeResult
      return {
        ...result,
        runId,
        resumedFromStep: checkpoint.step,
      } as ResumeResult;
    });
  }

  // ==========================================
  // Graph Workflow Methods
  // ==========================================

  registerGraphWorkflow(config: GraphWorkflowConfig): Effect.Effect<void, GraphValidationError> {
    const self = this;
    return Effect.gen(function* () {
      // Validate ID using Effect.try
      yield* Effect.try({
        try: () => validateId(config.id, 'Graph workflow ID'),
        catch: (error) => new GraphValidationError({
          workflowId: config.id,
          message: error instanceof Error ? error.message : String(error)
        })
      });

      const workflows = yield* Ref.get(self.graphWorkflows);
      const compiled = yield* Ref.get(self.workflows);
      if (workflows.has(config.id) || compiled.has(config.id)) {
        return yield* Effect.fail(new GraphValidationError({
          workflowId: config.id,
          message: `Graph workflow already exists: ${config.id}`
        }));
      }

      // Validate graph structure using Effect.try
      yield* Effect.try({
        try: () => validateGraphWorkflow(config),
        catch: (error) => new GraphValidationError({
          workflowId: config.id,
          message: error instanceof Error ? error.message : String(error)
        })
      });

      const newWorkflows = new Map(workflows);
      newWorkflows.set(config.id, config);
      yield* Ref.set(self.graphWorkflows, newWorkflows);
      yield* Ref.update(self.workflows, (compiled) => {
        const next = new Map(compiled);
        next.set(config.id, compileGraphWorkflow(config));
        return next;
      });
    });
  }

  getGraphWorkflow(id: string): Effect.Effect<GraphWorkflowConfig, PipelineNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      const workflows = yield* Ref.get(self.graphWorkflows);
      const config = workflows.get(id);
      if (!config) return yield* Effect.fail(new PipelineNotFoundError({ id }));
      return config;
    });
  }

  hasGraphWorkflow(id: string): Effect.Effect<boolean> {
    const self = this;
    return Effect.gen(function* () {
      const workflows = yield* Ref.get(self.graphWorkflows);
      return workflows.has(id);
    });
  }

  getAllGraphWorkflows(): Effect.Effect<GraphWorkflowConfig[]> {
    const self = this;
    return Effect.gen(function* () {
      const workflows = yield* Ref.get(self.graphWorkflows);
      return Array.from(workflows.values());
    });
  }

  executeGraphWorkflow(
    id: string,
    input: string,
    options?: { conversationId?: string }
  ): Effect.Effect<GraphExecutionResult, PipelineExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      const config = yield* self.getGraphWorkflow(id).pipe(
        Effect.mapError(() => new PipelineExecutionError({
          pipelineId: id,
          step: 0,
          cause: new Error(`Graph workflow not found: ${id}`)
        }))
      );

      return yield* self.graphExecutorService.executeGraphWorkflow(config, input, {
        agentManager: self.createExecutorAgentManager(),
        conversationId: options?.conversationId,
      }).pipe(
        Effect.mapError((error) => new PipelineExecutionError({
          pipelineId: id,
          step: 0,
          cause: error,
        }))
      );
    });
  }

  createGraphWorkflowFromBuilder(builder: GraphWorkflowBuilder): Effect.Effect<GraphWorkflowConfig, GraphValidationError> {
    const self = this;
    return Effect.gen(function* () {
      const config = builder.build();
      yield* self.registerGraphWorkflow(config);
      return config;
    });
  }

  getPauseService(): Effect.Effect<PauseService> {
    return Effect.succeed(this.pauseService);
  }
}

/**
 * Live layer providing PipelineService
 * Requires AgentService, HookManagerService, CheckpointService, PauseService
 */
export const PipelineServiceLive = Layer.effect(
  PipelineService,
  Effect.gen(function* () {
    const agentService = yield* AgentService;
    const executorService = yield* ExecutorService;
    const graphExecutorService = yield* GraphExecutorService;
    const hookService = yield* HookManagerService;
    const checkpointService = yield* CheckpointService;
    const pauseService = yield* PauseService;

    const pipelinesV2 = yield* Ref.make(new Map<string, PipelineConfigV2>());
    const graphWorkflows = yield* Ref.make(new Map<string, GraphWorkflowConfig>());
    const workflows = yield* Ref.make(new Map<string, WorkflowIR>());

    return new PipelineServiceImpl(
      pipelinesV2,
      graphWorkflows,
      workflows,
      agentService,
      executorService,
      graphExecutorService,
      hookService,
      checkpointService,
      pauseService
    );
  })
);
