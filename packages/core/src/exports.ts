// ─── Intent Types ───────────────────────────────────────────────────────────
export type { ActionType, Action, Intent, IntentMatch } from './intent/intent';

// ─── Agent Types ────────────────────────────────────────────────────────────
export type {
  AIPlatform, AgentConfig, ToolRetryPolicy, RetryDiagnostics,
  AgentInstance, AgentMessage, AgentResponse,
} from './agent/agent';
export { hasRetryDiagnostics, type ErrorWithRetryDiagnostics } from './agent/agent';

// ─── Tool Types ─────────────────────────────────────────────────────────────
export {
  BUILTIN_TOOL_CAPABILITIES,
  type BuiltinToolCapability, type ToolCapability,
  type ToolCapabilityMetadata, type ToolSchemaMetadata,
  type ToolSchemaDefinition, type Tool, type ToolResult,
} from './tool/tool';

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
} from './template';
export type {
  TemplateEngineConfig,
  FrontmatterContext,
  BodyContext,
  TemplateError,
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

// ─── Utilities ──────────────────────────────────────────────────────────────
export { sanitizeError } from './utils/validation';

// ─── Stream Types ───────────────────────────────────────────────────────────
export type { StreamEvent } from './stream/events';
export { toOpenAIStream } from './stream/openai';
