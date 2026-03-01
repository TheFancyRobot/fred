// Export all types and classes
export * from './intent/intent';
export * from './agent/agent';
// Note: MCPClientMetrics can be imported directly from './agent/factory' if needed
export * from './tool/tool';
export * from './tool-gate';
export type { EffectProviderFactory } from './platform/base';
export * from './platform/provider';

// Provider pack registry for external provider packages
export {
  registerBuiltinPack,
  loadBuiltinPack,
  getBuiltinPackIds,
  isBuiltinPack,
} from './platform/packs';
export * from './config/types';
export { IntentMatcher } from './intent/matcher';
export { IntentRouter } from './intent/router';
export * from './context/context';
export * from './context/session';
export { SqliteContextStorage } from './context/storage/sqlite';
export { PostgresContextStorage } from './context/storage/postgres';

// Checkpoint storage exports
export {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
  CheckpointManager,
  CheckpointCleanupTask,
} from './pipeline/checkpoint';
export type {
  CheckpointStorage,
  Checkpoint,
  CheckpointStatus,
  CheckpointManagerOptions,
  CheckpointCleanupOptions,
} from './pipeline/checkpoint';

// Pause types
export type {
  PauseSignal,
  PauseRequest,
  PendingPause,
  PauseMetadata,
  HumanInputResumeOptions,
} from './pipeline/pause/types';
export { createCalculatorTool } from './tool/calculator';

export * from './hooks/types';
export * from './routing/types';
export {
  generateRoutingExplanation,
  buildNarrative,
  detectConcerns,
} from './routing/explainer';
export { WorkflowManager } from './workflow/manager';
export type { Workflow } from './workflow/manager';
export * from './tracing';
export * from './eval/golden-trace';
export * from './eval/artifact';
export * from './eval/normalizer';
export * from './eval/storage';
export * from './eval/service';
export { GoldenTraceRecorder } from './eval/recorder';
export * from './eval/assertions';
export * from './eval/replay';
export * from './eval/comparator';
export * from './eval/suite';
export * from './eval/metrics';

// Observability exports
export { buildObservabilityLayers, annotateSpan, withFredSpan } from './observability/otel';
export type { ObservabilityLayers } from './observability/otel';
export {
  // FiberRef-based API (preferred)
  CorrelationContextRef,
  getCorrelationContext,
  getSpanIds,
  withCorrelationContext,
  // Backward-compatible sync API
  createCorrelationContext,
  getCurrentCorrelationContext,
  getCurrentSpanIds,
} from './observability/context';
export type { CorrelationContext } from './observability/context';
export { ObservabilityService, ObservabilityServiceLive } from './observability/service';
export type {
  ObservabilityServiceConfig,
  SamplingDecision,
  RunRecord,
  HookEvent,
  StepSpan,
  ToolUsage,
  ModelUsage,
} from './observability/service';

// Utility functions
export { sanitizeError } from './utils/validation';

// Stream event types and OpenAI conversion
export type { StreamEvent } from './stream/events';
export { toOpenAIStream } from './stream/openai';
