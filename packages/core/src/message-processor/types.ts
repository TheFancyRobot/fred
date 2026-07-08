import type { Effect } from 'effect';
import type { AgentInstance, AgentMessage, AgentResponse } from '../agent/agent';
import type { IntentMatcher } from '../intent/matcher';
import type { IntentRouter } from '../intent/router';
import type { RoutingDecision } from '../routing/types';
import type { Tracer } from '../tracing';
import type { ObservabilityService } from '../observability/service';

/**
 * ToolFailure record type for persistence (distinct from ToolResult).
 * Per locked decision: Tool failures are persisted as separate records, not via isFailure flag.
 * This enables accurate history reconstruction and differentiation from success records.
 */
export interface ToolFailureRecord {
  /** Discriminator for ToolFailure records in persisted result */
  __type: 'ToolFailure';
  /** Error details with code and message */
  error: {
    code: string;
    message: string;
  };
  /** Original output (typically error message string) */
  output: unknown;
}

/**
 * Type guard to check if a persisted tool result is a ToolFailure record
 */
export function isToolFailureRecord(result: unknown): result is ToolFailureRecord {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as ToolFailureRecord).__type === 'ToolFailure' &&
    typeof (result as ToolFailureRecord).error === 'object'
  );
}

/**
 * Result of routing a message to a handler
 */
export interface RouteResult {
  type: 'agent' | 'pipeline' | 'intent' | 'default' | 'none';
  agent?: AgentInstance;
  agentId?: string;
  intentId?: string;
  pipelineId?: string;
  response?: AgentResponse;
  /** Routing decision (when MessageRouter is used) */
  routingDecision?: import('../routing/types').RoutingDecision;
}

/**
 * Options for processing messages
 */
export interface ProcessingOptions {
  useSemanticMatching?: boolean;
  semanticThreshold?: number;
  conversationId?: string;
  requireConversationId?: boolean;
  /**
   * Whether to fall back to the ambient session (SessionService.current) for
   * conversation history when no explicit `conversationId` is given. Defaults
   * to `true`. Set `false` to opt a call out of ambient session history.
   * An explicit `conversationId` always takes precedence over the ambient one.
   */
  useSessionHistory?: boolean;
  sequentialVisibility?: boolean;
  userId?: string;
  role?: string;
  policyMetadata?: Record<string, unknown>;
  /** AbortSignal for user-initiated stream cancellation (e.g. /exit, Ctrl+C) */
  signal?: AbortSignal;
}

/**
 * Memory/conversation defaults
 */
export interface MemoryDefaults {
  policy?: {
    maxMessages?: number;
    maxChars?: number;
    strict?: boolean;
    isolated?: boolean;
  };
  requireConversationId?: boolean;
  sequentialVisibility?: boolean;
}

interface ProcessorContextManager {
  generateConversationId(): string;
  getHistory(conversationId: string): Promise<AgentMessage[]>;
  addMessage(conversationId: string, message: AgentMessage): Promise<void>;
}

interface ProcessorAgentMatch {
  agentId: string;
  confidence: number;
  matchType: 'exact' | 'regex' | 'semantic';
}

interface ProcessorAgentManager {
  getAgent(id: string): AgentInstance | undefined;
  matchAgentByUtterance(message: string, semanticMatcher?: SemanticMatcherFn): Promise<ProcessorAgentMatch | null>;
}

interface ProcessorPipelineMatch {
  pipelineId: string;
  confidence: number;
  matchType: 'exact' | 'regex' | 'semantic';
}

interface ProcessorPipelineManager {
  matchPipelineByUtterance(message: string, semanticMatcher?: SemanticMatcherFn): Promise<ProcessorPipelineMatch | null>;
  executePipeline(
    id: string,
    message: string,
    previousMessages: AgentMessage[],
    options?: { conversationId?: string; sequentialVisibility?: boolean }
  ): Promise<AgentResponse>;
}

interface ProcessorHookManager {
  executeHooks(hookName: string, event: unknown): Promise<void>;
}

interface ProcessorMessageRouter {
  route(message: string, context: Record<string, unknown>): Effect.Effect<RoutingDecision, unknown, unknown>;
}

/**
 * Dependencies required by MessageProcessor
 */
export interface MessageProcessorDeps {
  contextManager: ProcessorContextManager;
  agentManager: ProcessorAgentManager;
  pipelineManager: ProcessorPipelineManager;
  intentMatcher: IntentMatcher;
  intentRouter: IntentRouter;
  tracer?: Tracer;
  messageRouter?: ProcessorMessageRouter;
  memoryDefaults: MemoryDefaults;
  defaultAgentId?: string;
  hookManager?: ProcessorHookManager;
  observabilityService?: ObservabilityService;
}

/**
 * Semantic matcher function type
 * Matches the signature expected by AgentService and PipelineService
 */
export type SemanticMatcherFn = (
  msg: string,
  utterances: string[]
) => Promise<{ matched: boolean; confidence: number; utterance?: string }>;
