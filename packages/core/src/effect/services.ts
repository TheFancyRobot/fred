/**
 * Effect Services for Fred
 *
 * Import individual services for targeted dependency injection:
 * ```typescript
 * import { AgentService, AgentServiceLive } from 'fred/effect';
 *
 * const program = Effect.gen(function* () {
 *   const agents = yield* AgentService;
 *   return yield* agents.getAllAgents();
 * });
 * ```
 */

// Core services
export {
  ToolRegistryService,
  ToolRegistryServiceLive,
} from '../tool/service';

export {
  HookManagerService,
  HookManagerServiceLive,
} from '../hooks/service';

export {
  ProviderRegistryService,
  ProviderRegistryServiceLive,
} from '../platform/service';

export {
  ContextStorageService,
  ContextStorageServiceLive,
} from '../context/service';

export {
  SessionService,
  SessionServiceLive,
  SessionId,
  makeSessionId,
} from '../context/session-service';

export {
  AgentService,
  AgentServiceLive,
  AgentServiceLayer,
  makeAgentServiceLive,
} from '../agent/service';

export {
  PromptSourceService,
  DefaultPromptSourceService,
  DefaultPromptSourceLayer,
  PromptSourceServiceLive,
  resolveDefaultPromptSource,
} from '../agent/prompt-source';

export {
  WorkflowService,
  WorkflowServiceLive,
} from '../workflow/service';

export {
  CheckpointService,
} from '../pipeline/checkpoint/service';

export {
  CheckpointServiceLive,
} from '../services';

export {
  PauseService,
  PauseServiceLive,
} from '../pipeline/pause/service';

export {
  PipelineService,
  PipelineServiceLive,
} from '../pipeline/service';

export {
  ToolGateService,
  ToolGateServiceLive,
} from '../tool-gate/service';

export {
  MessageProcessorService,
  MessageProcessorServiceLive,
} from '../message-processor/service';
export type { MessageProcessorError } from '../message-processor/service';

export {
  SubagentService,
  SubagentServiceLive,
} from '../subagent/service';

export {
  IntentMatcherService,
  IntentMatcherServiceLive,
  IntentRouterService,
  IntentRouterServiceLive,
} from '../intent/service';

export {
  MessageRouterService,
  MessageRouterServiceLive,
  MessageRouterServiceLiveWithConfig,
  MessageRouterConfig,
} from '../routing/service';

export {
  ObservabilityService,
  ObservabilityServiceLive,
} from '../observability/service';

export {
  AgentRunAnnotationRef,
  AgentStatusService,
  AgentStatusServiceLive,
  trackAgentRun,
  type AgentRunAnnotation,
  type AgentRunInfo,
  type AgentRunState,
  type AgentStatusListener,
  type AgentStatusSnapshot,
  type AgentStatusUnsubscribe,
} from '../observability/status';

export {
  TemplateEngine,
  TemplateEngineLive,
} from '../template';

// Aggregate exports
export {
  FredLayers,
  makeFredLayers,
  makeFredLayersWithLeafRouting,
  makeFredRuntimeLayer,
  createFredRuntime,
  createFredRuntimeWithOptions,
  createScopedFredRuntime,
} from '../services';

// Type exports
export type {
  FredLayerOptions,
  FredRuntime,
  FredServices,
} from '../services';

export type { SessionHandle } from '../context/session-service';
