/**
 * Fred Service Composition
 *
 * This module provides the aggregate FredLayers layer that composes all
 * Effect services, plus runtime creation utilities.
 */

import { Effect, Layer, Runtime, Scope, Ref } from 'effect';

// Import all services
import { ToolRegistryService, ToolRegistryServiceLive } from './tool/service';
import { ToolGateService, ToolGateServiceLive } from './tool-gate/service';
import type { ToolGateServiceApi } from './tool-gate/types';
import { HookManagerService, HookManagerServiceLive } from './hooks/service';
import { ProviderRegistryService, ProviderRegistryServiceLive } from './platform/service';
import {
  ProviderConnectionService,
  makeInMemoryProviderConnectionLayer,
} from './platform/connections';
import {
  ContextStorageService,
  ContextStorageServiceLive,
  ContextStorageServiceLiveWithAdapter,
} from './context/service';
import type { ContextStorage } from './context/context';
import { SessionService, SessionServiceLive } from './context/session-service';
import { AgentService, AgentServiceLive, makeAgentServiceLive } from './agent/service';
import {
  DefaultPromptSourceLayer,
  PromptSourceService,
  type PromptSourceService as PromptSourceServiceApi,
} from './agent/prompt-source';
import { WorkflowService, WorkflowServiceLive } from './workflow/service';
import {
  CheckpointService,
  CheckpointServiceLive as makeCheckpointServiceLive,
} from './pipeline/checkpoint/service';
import { CheckpointNotFoundError } from './pipeline/errors';
import { PauseService, PauseServiceLive } from './pipeline/pause/service';
import { PipelineService, PipelineServiceLive } from './pipeline/service';
import { ExecutorServiceLive } from './pipeline/executor';
import { GraphExecutorServiceLive } from './pipeline/graph-executor';
import { MessageProcessorService, MessageProcessorServiceLive } from './message-processor/service';
import { IntentMatcherService, IntentMatcherServiceLive } from './intent/service';
import { IntentRouterService, IntentRouterServiceLive } from './intent/service';
import { SubagentService, SubagentServiceLive } from './subagent/service';
import {
  MessageRouterService,
  MessageRouterServiceLive,
  MessageRouterServiceLiveWithConfig,
} from './routing/service';
import { ObservabilityService, ObservabilityServiceLive } from './observability/service';
import { AgentStatusService, AgentStatusServiceLive } from './observability/status';
import type { ObservabilityLayers } from './observability/otel';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from './pipeline/checkpoint/types';
import type { RoutingConfig } from './routing/types';

/**
 * Core Fred service types included in FredLayers.
 */
export type FredServices =
  | ToolRegistryService
  | ToolGateServiceApi
  | HookManagerService
  | ProviderRegistryService
  | ProviderConnectionService
  | ContextStorageService
  | PromptSourceServiceApi
  | AgentService
  | WorkflowService
  | CheckpointService
  | PauseService
  | PipelineService
  | MessageProcessorService
  | SubagentService
  | IntentMatcherService
  | IntentRouterService
  | MessageRouterService
  | SessionService
  | ObservabilityService
  | AgentStatusService;

/**
 * Fred runtime type with all services
 */
export type FredRuntime = Runtime.Runtime<FredServices>;

/**
 * In-memory checkpoint storage for default layer composition
 */
class InMemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints = new Map<string, Checkpoint[]>();

  async save(checkpoint: Checkpoint): Promise<void> {
    const key = checkpoint.runId;
    const existing = this.checkpoints.get(key) || [];
    // Remove any existing checkpoint at the same step
    const filtered = existing.filter((cp) => cp.step !== checkpoint.step);
    filtered.push(checkpoint);
    this.checkpoints.set(key, filtered);
  }

  async get(runId: string, step: number): Promise<Checkpoint | null> {
    const checkpoints = this.checkpoints.get(runId);
    return checkpoints?.find((cp) => cp.step === step) || null;
  }

  async getLatest(runId: string): Promise<Checkpoint | null> {
    const checkpoints = this.checkpoints.get(runId);
    if (!checkpoints || checkpoints.length === 0) return null;
    return checkpoints.reduce((latest, cp) =>
      cp.step > latest.step ? cp : latest
    );
  }

  async getLatestByPipelineId(pipelineId: string): Promise<Checkpoint | null> {
    let latest: Checkpoint | null = null;
    for (const checkpoints of this.checkpoints.values()) {
      for (const cp of checkpoints) {
        if (cp.pipelineId === pipelineId) {
          if (!latest || cp.updatedAt > latest.updatedAt) {
            latest = cp;
          }
        }
      }
    }
    return latest;
  }

  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    const checkpoints = this.checkpoints.get(runId);
    if (checkpoints) {
      const checkpoint = checkpoints.find((cp) => cp.step === step);
      if (checkpoint) {
        checkpoint.status = status;
        checkpoint.updatedAt = new Date();
      }
    }
  }

  async deleteRun(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    let count = 0;
    for (const [runId, checkpoints] of this.checkpoints.entries()) {
      const filtered = checkpoints.filter((cp) => {
        if (cp.expiresAt && cp.expiresAt < now) {
          count++;
          return false;
        }
        return true;
      });
      if (filtered.length === 0) {
        this.checkpoints.delete(runId);
      } else {
        this.checkpoints.set(runId, filtered);
      }
    }
    return count;
  }

  async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
    const result: Checkpoint[] = [];
    for (const checkpoints of this.checkpoints.values()) {
      for (const cp of checkpoints) {
        if (cp.status === status) {
          result.push(cp);
        }
      }
    }
    return result;
  }

  async close(): Promise<void> {
    this.checkpoints.clear();
  }
}

/**
 * Default in-memory CheckpointService layer
 */
const inMemoryStorage = new InMemoryCheckpointStorage();
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const CheckpointServiceLive = Layer.effect(
  CheckpointService,
  Effect.gen(function* () {
    const defaultTtlMs = yield* Ref.make(DEFAULT_TTL_MS);
    const service: CheckpointService = {
      generateRunId: () => Effect.sync(() => crypto.randomUUID()),

      saveCheckpoint: (options) =>
        Effect.gen(function* () {
          const now = new Date();
          const ttl = yield* Ref.get(defaultTtlMs);
          const expiresAt = options.expiresAt ?? new Date(now.getTime() + ttl);
          yield* Effect.promise(() =>
            inMemoryStorage.save({
              runId: options.runId,
              pipelineId: options.pipelineId,
              step: options.step,
              status: options.status,
              context: options.context,
              createdAt: now,
              updatedAt: now,
              expiresAt,
              stepName: options.stepName,
              pauseMetadata: options.pauseMetadata,
            })
          );
        }),

      getLatestCheckpoint: (runId) =>
        Effect.gen(function* () {
          const checkpoint = yield* Effect.promise(() => inMemoryStorage.getLatest(runId));
          if (!checkpoint) {
            return yield* Effect.fail(new CheckpointNotFoundError({ runId }));
          }
          return checkpoint;
        }),

      getCheckpoint: (runId, step) =>
        Effect.gen(function* () {
          const checkpoint = yield* Effect.promise(() => inMemoryStorage.get(runId, step));
          if (!checkpoint) {
            return yield* Effect.fail(new CheckpointNotFoundError({ runId, step }));
          }
          return checkpoint;
        }),

      updateStatus: (runId, step, status) =>
        Effect.promise(() => inMemoryStorage.updateStatus(runId, step, status)),

      markCompleted: (runId, step) =>
        Effect.promise(() => inMemoryStorage.updateStatus(runId, step, 'completed')),

      markFailed: (runId, step) =>
        Effect.promise(() => inMemoryStorage.updateStatus(runId, step, 'failed')),

      deleteRun: (runId) => Effect.promise(() => inMemoryStorage.deleteRun(runId)),

      deleteExpired: () => Effect.promise(() => inMemoryStorage.deleteExpired()),

      getLatestByPipelineId: (pipelineId) =>
        Effect.promise(() => inMemoryStorage.getLatestByPipelineId(pipelineId)),

      getStorage: () => Effect.succeed(inMemoryStorage),
    };
    return service;
  })
);

/**
 * Base layers with no external dependencies
 * Wave 1: ToolRegistry, HookManager, Observability
 */
const agentStatusLayer = AgentStatusServiceLive;
const hookManagerLayer = HookManagerServiceLive.pipe(
  Layer.provide(agentStatusLayer),
  Layer.provide(ObservabilityServiceLive)
);

const baseLayer = Layer.mergeAll(
  ToolRegistryServiceLive,
  hookManagerLayer,
  ObservabilityServiceLive,
  agentStatusLayer
);

/**
 * ToolGate layer depends on ToolRegistry
 */
const toolGateLayer = ToolGateServiceLive.pipe(
  Layer.provide(baseLayer)
);

/**
 * Agent layer depends on Tool and Provider
 * Wave 3: AgentService
 */
const subagentLayer = SubagentServiceLive;

/**
 * Default MessageRouterService for base FredLayers.
 *
 * Starts unconfigured (route/testRoute fail with NoAgentsAvailableError) and
 * accepts live routing configuration via `setConfig`, so changing routing
 * never requires rebuilding the runtime. Providing
 * MessageRouterServiceLiveWithConfig still works for config-at-build usage.
 */
const defaultRouterLayer = MessageRouterServiceLive;

/**
 * Complete Fred layers - all services composed
 *
 * Dependency graph:
 * ```
 * ToolRegistryService (Wave 1)
 * HookManagerService (Wave 1)
 * ObservabilityService (Wave 1)
 *       |
 *       v
 * ProviderRegistryService (Wave 2)
 * ContextStorageService (Wave 2)
 * CheckpointService (Wave 2)
 *       |
 *       v
 * PauseService (Wave 2.5 - depends on Checkpoint)
 *       |
 *       v
 * AgentService (Wave 3 - depends on Tool, Provider)
 *       |
 *       v
 * PipelineService (Wave 4 - depends on Agent, Hook, Checkpoint, Pause)
 *       |
 *       v
 * MessageProcessorService (Wave 5 - depends on Agent, Pipeline, Context)
 *       |
 *       v
 * IntentMatcherService (Wave 6)
 * IntentRouterService (Wave 6 - depends on Agent)
 * MessageRouterService (Wave 6 - default no-op)
 * ```
 */
export const makeFredLayers = (
  promptSourceLayer: Layer.Layer<PromptSourceServiceApi, never, never> = DefaultPromptSourceLayer,
  contextStorageLayer: Layer.Layer<ContextStorageService> = ContextStorageServiceLive,
  checkpointServiceLayer: Layer.Layer<CheckpointService> = CheckpointServiceLive,
  messageRouterLayer?: Layer.Layer<MessageRouterService>,
) => {
  const selectedCoreLayer = Layer.mergeAll(
    ProviderRegistryServiceLive,
    makeInMemoryProviderConnectionLayer(),
    contextStorageLayer,
    checkpointServiceLayer,
  );
  const selectedPauseLayer = PauseServiceLive.pipe(
    Layer.provide(checkpointServiceLayer),
  );
  const selectedAgentLayer = makeAgentServiceLive(promptSourceLayer).pipe(
    Layer.provide(baseLayer),
    Layer.provide(toolGateLayer),
    Layer.provide(ProviderRegistryServiceLive)
  );

  const selectedWorkflowLayer = WorkflowServiceLive.pipe(
    Layer.provide(selectedAgentLayer)
  );

  const selectedPipelineLayer = PipelineServiceLive.pipe(
    Layer.provide(selectedAgentLayer),
    Layer.provide(ExecutorServiceLive),
    Layer.provide(GraphExecutorServiceLive),
    Layer.provide(hookManagerLayer),
    Layer.provide(checkpointServiceLayer),
    Layer.provide(selectedPauseLayer)
  );

  const messageProcessorDependencies = MessageProcessorServiceLive.pipe(
    Layer.provide(selectedAgentLayer),
    Layer.provide(selectedPipelineLayer),
    Layer.provide(contextStorageLayer),
    Layer.provide(SessionServiceLive)
  );
  const selectedMessageProcessorLayer = messageRouterLayer
    ? messageProcessorDependencies.pipe(Layer.provide(messageRouterLayer))
    : messageProcessorDependencies;

  const selectedIntentLayer = Layer.mergeAll(
    IntentMatcherServiceLive,
    IntentRouterServiceLive.pipe(Layer.provide(selectedAgentLayer))
  );

  return Layer.mergeAll(
    baseLayer,
    toolGateLayer,
    selectedCoreLayer,
    selectedPauseLayer,
    promptSourceLayer,
    selectedAgentLayer,
    selectedWorkflowLayer,
    selectedPipelineLayer,
    selectedMessageProcessorLayer,
    subagentLayer,
    selectedIntentLayer,
    messageRouterLayer ?? defaultRouterLayer,
    SessionServiceLive
  );
};

export const FredLayers = makeFredLayers();

/**
 * Build Fred layers with a config-driven MessageRouterService.
 *
 * Composes FredLayers (which includes a default no-op router) with the
 * config-driven MessageRouterService. Layer.merge gives the second (right)
 * layer priority, so the config-driven router replaces the no-op default.
 */
export const makeFredLayersWithLeafRouting = (
  routerConfig: RoutingConfig,
  promptSourceLayer: Layer.Layer<PromptSourceServiceApi, never, never> = DefaultPromptSourceLayer
) => {
  const messageRouterLayer = MessageRouterServiceLiveWithConfig(routerConfig);
  return makeFredLayers(
    promptSourceLayer,
    ContextStorageServiceLive,
    CheckpointServiceLive,
    messageRouterLayer,
  );
};

export interface FredLayerOptions {
  routingConfig?: RoutingConfig;
  observabilityLayers?: ObservabilityLayers;
  promptSourceLayer?: Layer.Layer<PromptSourceServiceApi, never, never>;
  storage?: ContextStorage;
  checkpointStorage?: CheckpointStorage;
  checkpointTtlMs?: number;
}

/**
 * Compose Fred layers from runtime options.
 */
export const makeFredRuntimeLayer = (options: FredLayerOptions = {}): Layer.Layer<FredServices> => {
  const promptSourceLayer = options.promptSourceLayer ?? DefaultPromptSourceLayer;
  const contextStorageLayer = options.storage
    ? ContextStorageServiceLiveWithAdapter(options.storage)
    : ContextStorageServiceLive;
  const checkpointServiceLayer = options.checkpointStorage
    ? makeCheckpointServiceLive({
        storage: options.checkpointStorage,
        defaultTtlMs: options.checkpointTtlMs,
      })
    : CheckpointServiceLive;
  const messageRouterLayer = options.routingConfig
    ? MessageRouterServiceLiveWithConfig(options.routingConfig)
    : undefined;
  const base = makeFredLayers(
    promptSourceLayer,
    contextStorageLayer,
    checkpointServiceLayer,
    messageRouterLayer,
  );

  if (!options.observabilityLayers) {
    return base;
  }

  return Layer.mergeAll(
    base,
    options.observabilityLayers.tracerLayer,
    options.observabilityLayers.loggerLayer
  );
};

/**
 * Create a Fred runtime from runtime composition options.
 */
export const createFredRuntimeWithOptions = (
  options: FredLayerOptions = {}
): Effect.Effect<FredRuntime, never, Scope.Scope> => {
  return Layer.toRuntime(makeFredRuntimeLayer(options));
};

/**
 * Create a Fred runtime with all services.
 *
 * The runtime is scoped and will clean up resources when the scope closes.
 * Use this for applications that need long-running Fred instances.
 *
 * @example
 * ```typescript
 * const runtime = await createFredRuntime();
 *
 * // Use runtime to run Effects
 * const result = await Effect.runPromise(
 *   myEffect.pipe(Effect.provide(runtime))
 * );
 * ```
 */
export const createFredRuntime = (): Effect.Effect<FredRuntime, never, Scope.Scope> => {
  return createFredRuntimeWithOptions();
};

/**
 * Create a scoped Fred runtime that auto-cleans up.
 *
 * @example
 * ```typescript
 * const runtime = await createScopedFredRuntime();
 * // runtime is ready to use
 * // cleanup happens when process exits
 * ```
 */
export const createScopedFredRuntime = (): Promise<FredRuntime> => {
  return Effect.runPromise(
    Effect.scoped(createFredRuntime())
  );
};

// Re-export all services for convenience
export {
  ToolRegistryService,
  ToolRegistryServiceLive,
  ToolGateService,
  ToolGateServiceLive,
  HookManagerService,
  HookManagerServiceLive,
  ProviderRegistryService,
  ProviderRegistryServiceLive,
  ProviderConnectionService,
  ContextStorageService,
  ContextStorageServiceLive,
  ContextStorageServiceLiveWithAdapter,
  SessionService,
  SessionServiceLive,
  PromptSourceService,
  DefaultPromptSourceLayer,
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
  AgentStatusService,
  AgentStatusServiceLive,
};
