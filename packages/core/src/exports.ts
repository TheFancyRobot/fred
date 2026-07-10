import { normalizeRunRecord, normalizeLegacyGoldenTrace } from './eval/normalizer';
import { FileTraceStorageLive } from './eval/storage';
import { compare } from './eval/comparator';
import { createReplayOrchestrator, replay, replayWithStorage } from './eval/replay';
import { runSuite, parseSuiteManifest, decodeSuiteManifest } from './eval/suite';
import { calculateIntentMetrics } from './eval/metrics';

// ─── Intent Types ───────────────────────────────────────────────────────────
export type { ActionType, Action, Intent, IntentMatch } from './intent/intent';

// ─── Agent Types ────────────────────────────────────────────────────────────
export type {
  AIPlatform, AgentConfig, AgentInvocationMetadata, AgentOutputRetryPolicy, AgentPrompt,
  AgentPromptVariable, AgentTemplatePrompt, AgentBamlPrompt,
  AgentStreamOptions, ToolRetryPolicy, RetryDiagnostics, AgentInstance, AnyAgentConfig,
  AnyAgentInstance, AgentMessage, AgentResponse,
} from './agent/agent';
export { hasRetryDiagnostics, type ErrorWithRetryDiagnostics } from './agent/agent';
export {
  AgentInputValidationError,
  AgentOutputValidationError,
  MissingPromptSourceAdapterError,
  PromptResolutionError,
} from './agent/errors';
export {
  PromptSourceService,
  DefaultPromptSourceService,
  DefaultPromptSourceLayer,
  PromptSourceServiceLive,
  isAgentTemplatePrompt,
  isAgentBamlPrompt,
  resolveDefaultPromptSource,
  type PromptSourceContext,
  type PromptSourceError,
} from './agent/prompt-source';

// ─── Tool Types ─────────────────────────────────────────────────────────────
export {
  BUILTIN_TOOL_CAPABILITIES,
  type BuiltinToolCapability, type ToolCapability,
  type ToolCapabilityMetadata, type ToolSchemaMetadata,
  type ToolSchemaDefinition, type Tool, type ToolResult,
} from './tool/tool';
export { createHandoffTool } from './tool/handoff';
export type { HandoffToolConfig } from './pipeline/handoff-tool';

// ─── Tool Gate ──────────────────────────────────────────────────────────────
// Note: ToolGateService and ToolGateServiceLive are re-exported from index.ts services block
export { ToolGateToolNotFoundError } from './tool-gate/errors';
export type {
  ToolGateContext, ToolGateDecision, ToolGateFilterResult,
  ToolGateRuleEvaluation, ToolGateScope, ToolGateServiceApi,
} from './tool-gate/types';

// ─── Provider Types ─────────────────────────────────────────────────────────
export type { EffectProviderFactory } from './platform/base';
export type {
  ProviderConfig, ProviderConfigInput, ProviderDefinition,
  ProviderRegistration, ProviderModelDefaults, ProviderAlias,
} from './platform/provider';

// Provider capability types
export type { ProviderCapabilityKey } from './platform/provider-capabilities';
export {
  ProviderCapabilityKeys,
  UnsupportedProviderCapabilityError,
  hasCapability,
  getCapability,
} from './platform/provider-capabilities';

// Provider pack registry
export {
  registerBuiltinPack,
  loadBuiltinPack,
  getBuiltinPackIds,
  isBuiltinPack,
} from './platform/packs';

// ─── Config Types ───────────────────────────────────────────────────────────
export type {
  FrameworkConfig, ConfigFormat, PersistenceConfig, PersistenceAdapter,
  TemplateConfig,
  ObservabilityConfig, ToolPoliciesConfig, ToolPolicyRule, ToolPolicyOverride,
  ToolPolicyCondition, ToolPolicyMetadataPredicate,
  ProviderPackConfig, PluginDeclaration, PluginObjectDeclaration,
  MCPGlobalServerConfig, CheckpointConfig,
  MemoryConfig, ToolConfig,
  ConfigStep, ConfigStepBase, ConfigAgentStep, ConfigFunctionRefStep,
  ConfigConditionalStep, ConfigPipelineRefStep, ExtendedPipelineConfig,
} from './config/types';

// ─── Schema-first config (Phase 61) ──────────────────────────────────────────
// Effect Schema, semantic validation, structured errors, and layer compilation
// for config files. `loadValidatedConfig` is the schema-first load path.
export { loadValidatedConfig, validateParsedConfig } from './config/load';
export { FrameworkConfigSchema } from './config/schema';
export { validateFrameworkConfig } from './config/validate';
export { configToLayers, configToLayerOptions } from './config/compile';
export {
  ConfigError,
  ConfigValidationError,
  configValidationError,
  formatConfigIssues,
} from './config/errors';

// ─── Template Types ──────────────────────────────────────────────────────────
export {
  TemplateEngine,
  TemplateEngineLive,
  containsEtaSyntax,
  TemplateCompileError,
  TemplateResolutionError,
  filterEnvVars,
  DEFAULT_ENV_ALLOWLIST,
  buildFrontmatterContext,
  buildBodyContext,
  validateAllTemplates,
  previewTemplate,
  securityLintTemplate,
  compileTemplate,
  resolveAgentTemplate,
} from './template';
export type {
  TemplateEngineConfig,
  FrontmatterContext,
  BodyContext,
  TemplateError,
  ValidationResult,
} from './template';

// ─── Context Types ──────────────────────────────────────────────────────────
export type {
  ConversationPolicy, ConversationMetadata, ConversationContext,
  SessionAgentMetadata, SessionSummary, SessionDetails,
  SessionExportJson, SessionExportMarkdown, ContextStorage,
} from './context/context';

// Session utilities
export {
  extractAgentMetadata, extractMessagePreviewText,
  deriveSessionTitle, deriveSessionPreview,
  buildSessionSummary, buildSessionDetails,
  exportSessionToJson, exportSessionToMarkdown,
} from './context/session';

// Ambient session context (Phase 62)
export { SessionService, SessionServiceLive, SessionId, makeSessionId } from './context/session-service';
export type { SessionHandle } from './context/session-service';

// ─── Checkpoint Types ───────────────────────────────────────────────────────
export {
  PostgresCheckpointStorage,
  SqliteCheckpointStorage,
} from './pipeline/checkpoint';
export type {
  CheckpointStorage, Checkpoint, CheckpointStatus,
} from './pipeline/checkpoint';

// ─── Pause Types ────────────────────────────────────────────────────────────
export type {
  PauseSignal, PauseRequest, PendingPause,
  PauseMetadata, HumanInputResumeOptions,
} from './pipeline/pause/types';

// ─── Pipeline Builders ──────────────────────────────────────────────────────
export { PipelineBuilder } from './pipeline/builder';
export { GraphWorkflowBuilder } from './pipeline/graph-builder';
export type {
  PipelineConfigV2, AnyPipelineConfig,
} from './pipeline/pipeline';
export { isPipelineConfigV2 } from './pipeline/pipeline';
export type {
  GraphWorkflowConfig, GraphNode, BranchCondition,
} from './pipeline/graph';
export type { GraphExecutionResult } from './pipeline/graph-executor';

// ─── Hooks Types ────────────────────────────────────────────────────────────
export type {
  HookType, HookCorrelationContext, HookEvent,
  HookResult, HookHandler,
  PipelineHookEventData, StepHookEventData,
} from './hooks/types';

// ─── Routing Types ──────────────────────────────────────────────────────────
export type {
  RuleMatcher, RoutingRule, RoutingConfig, MatchType,
  RouteMatch, RoutingDecision, RoutingAlternative,
  CalibrationMetadata, RoutingConcern, RoutingExplanation,
} from './routing/types';
export {
  generateRoutingExplanation, buildNarrative, detectConcerns,
} from './routing/explainer';

// ─── Workflow Types ─────────────────────────────────────────────────────────
export type { Workflow } from './workflow/manager';
export type {
  WorkflowIR,
  WorkflowSource,
  IRNode,
  IREdge,
  EdgeGuard,
  JoinPolicy,
} from './workflow/ir';
export {
  defineWorkflow,
  compileWorkflow,
  compilePipelineV1,
  compilePipelineV2,
  compileGraphWorkflow,
  isWorkflowIR,
} from './workflow/compile';
export type { CompilableWorkflow } from './workflow/compile';
export { validateWorkflowIR, WorkflowValidationError } from './workflow/validate';
export type { WorkflowExecutionResult, WorkflowExecutionOptions } from './workflow/execute';

// ─── Subagents ───────────────────────────────────────────────────────────────
export type {
  SpawnSubagentOptions,
  ExecuteSubagentOptions,
  SubagentExecutionSummary,
  SubagentInfo,
  ExecuteSubagentResult,
  SubagentStatus,
} from './subagent/service';
export {
  SubagentAlreadyExistsError,
  SubagentNotFoundError,
  SubagentBusyError,
  SubagentDestroyedError,
  SubagentExecutionError,
  SubagentTimeoutError,
} from './subagent/errors';

// ─── Tracing ────────────────────────────────────────────────────────────────
export type { Tracer } from './tracing/tracer';
export { NoOpTracer } from './tracing/noop-tracer';

// ─── Eval Exports ───────────────────────────────────────────────────────────
// Primary eval API is available via @fancyrobot/fred/eval sub-path.
// Re-exported here for backward compatibility on the main entrypoint.
export type {
  GoldenTrace, GoldenTraceSpan, GoldenTraceToolCall,
  GoldenTraceHandoff, GoldenTraceData, GoldenTraceMetadata,
  LegacyGoldenTrace,
} from './eval/golden-trace';
export {
  GOLDEN_TRACE_VERSION, validateGoldenTrace,
  parseGoldenTraceVersion, generateGoldenTraceFilename,
} from './eval/golden-trace';
export type {
  EvaluationArtifact, EvalEnvironmentMetadata, EvalTiming,
  EvalRoutingArtifact, EvalResponseArtifact, EvalStepArtifact,
  EvalToolCallArtifact, EvalCheckpointArtifact, EvalHandoffArtifact,
  EvaluationArtifactSummary,
} from './eval/artifact';
export {
  EVAL_ARTIFACT_VERSION, validateEvaluationArtifact,
  stableTupleId, deriveTraceId, toDeterministicValue, stringifyEvaluationArtifact,
} from './eval/artifact';
export type {
  NormalizationCheckpoint, NormalizeRunRecordInput, NormalizeLegacyTraceInput,
} from './eval/normalizer';
export {
  normalizeRunRecord, normalizeLegacyGoldenTrace, normalizeCheckpointsFromRun,
} from './eval/normalizer';
export { TraceStorageService, FileTraceStorageLive } from './eval/storage';
export type { TraceStorageApi, FileTraceStorageOptions } from './eval/storage';
export {
  EvaluationService, EvaluationServiceLive,
  type EvaluationRunNotFoundError, type EvaluationTraceNotFoundError,
  type EvaluationRecordOptions, type EvaluationServiceApi,
} from './eval/service';
export { GoldenTraceRecorder } from './eval/recorder';
export { compare } from './eval/comparator';
export type {
  CompareOptions, CompareRegression, CompareScorecard, CompareResult,
} from './eval/comparator';
export {
  runAssertion, decodeAssertionSpecs,
  loadGoldenTrace, runTestCase, runTestCases, runAssertions,
  formatTestResults,
  AssertionSpecSchema, AssertionSuiteSchema,
  type TestCase, type TestResult, type AssertionResult, type AssertionSpec,
  type ToolCallsAssertionSpec, type RoutingAssertionSpec,
  type ResponseAssertionSpec, type CheckpointAssertionSpec, type SchemaAssertionSpec,
} from './eval/assertions';
export {
  createReplayOrchestrator, replay, replayWithStorage,
  deterministicReplayHash, runEffectWithTestClock, deriveClockAdjustmentsFromOffsets,
  buildReplayToolMocks,
  MissingToolMockResponseError, ToolMockSignatureMismatchError,
  ReplayTraceNotFoundError, ReplayCheckpointNotFoundError,
  type ReplayRuntimeAdapter, type ReplayMode, type ReplayOptions,
  type ReplayDependencies, type ReplayResumeInput, type ReplayResult,
  type ReplayToolMocks,
} from './eval/replay';
export {
  runSuite, parseSuiteManifest, decodeSuiteManifest,
  type SuiteManifest, type SuiteCaseDefinition,
  type SuiteCaseExecutionResult, type SuiteCaseReport,
  type SuiteReport, type SuiteCompareConfig, type SuiteReplayConfig,
} from './eval/suite';
export {
  calculateIntentMetrics, normalizeIntentLabel,
  collectIntentLabels, buildConfusionMatrix,
  NONE_INTENT_LABEL,
  type IntentLabelPair, type IntentMetric, type ConfusionMatrix, type IntentMetricsReport,
} from './eval/metrics';

// ─── Observability ──────────────────────────────────────────────────────────
// Note: ObservabilityService and ObservabilityServiceLive are re-exported from index.ts services block
export { buildObservabilityLayers, annotateSpan, withFredSpan } from './observability/otel';
export type { ObservabilityLayers } from './observability/otel';
export {
  CorrelationContextRef, getCorrelationContext, getSpanIds,
  withCorrelationContext,
  createCorrelationContext, getCurrentCorrelationContext, getCurrentSpanIds,
} from './observability/context';
export type { CorrelationContext } from './observability/context';
export type {
  ObservabilityServiceConfig, SamplingDecision,
  RunRecord, HookEvent as ObservabilityHookEvent, StepSpan, ToolUsage, ModelUsage,
  MetricsSnapshot, OtelMetricsExport,
} from './observability/service';
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
} from './observability/status';

// ─── Utilities ──────────────────────────────────────────────────────────────
export { sanitizeError } from './utils/validation';

// ─── Stream Types ───────────────────────────────────────────────────────────
export type { StreamEvent } from './stream/events';
export { toOpenAIStream, type OpenAIChatChunk } from './stream/openai';

// ─── Stream Utilities ───────────────────────────────────────────────────────
export { createTextSmoother, smoothStream } from './stream/smooth-text';
export type {
  TextSmoother,
  TextSmootherOptions,
  ChunkingStrategy,
  SmoothStreamOptions,
} from './stream/smooth-text';

// ─── Stream Result Types ────────────────────────────────────────────────────
export type { StreamResult, TokenUsage, StreamStatus, ToolCallInfo } from './stream/result';

// ─── Effect Services and Layer Composition ──────────────────────────────────
// The full Effect-native API is also available via '@fancyrobot/fred/effect'.
export {
  // Layer composition
  FredLayers,
  makeFredLayers,
  makeFredLayersWithLeafRouting,
  makeFredRuntimeLayer,
  createFredRuntime,
  createScopedFredRuntime,
  createFredRuntimeWithOptions,
  type FredLayerOptions,
  type FredRuntime,
  type FredServices,
  // Service tags + Live layers
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

// ─── MessageProcessor Error Types ───────────────────────────────────────────
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

// ─── Evaluation Helpers ─────────────────────────────────────────────────────
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
