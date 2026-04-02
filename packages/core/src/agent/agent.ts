import type { Action } from '../intent/intent';
import type { Prompt } from '@effect/ai';
import type { Effect, Stream } from 'effect';
import type { StreamEvent } from '../stream/events';

export type AgentToolChoice =
  | 'auto'
  | 'required'
  | 'none'
  | { type: 'tool'; toolName: string }
  | { tool: string }
  | { mode?: 'auto' | 'required'; oneOf: ReadonlyArray<string> };

export type ProviderToolChoice =
  | 'auto'
  | 'required'
  | 'none'
  | { tool: string }
  | { mode?: 'auto' | 'required'; oneOf: ReadonlyArray<string> };

/**
 * Supported AI platforms
 * This is a union type of all supported platforms, but the actual
 * list is dynamically determined by available provider packs
 */
export type AIPlatform = 
  | 'openai' 
  | 'groq' 
  | 'anthropic' 
  | 'google' 
  | 'mistral' 
  | 'cohere' 
  | 'vercel' 
  | 'azure-openai' 
  | 'azure-anthropic' 
  | 'azure'
  | 'fireworks' 
  | 'xai' 
  | 'ollama' 
  | 'ai21' 
  | 'nvidia' 
  | 'bedrock' 
  | 'amazon-bedrock' 
  | 'cloudflare' 
  | 'elevenlabs' 
  | 'lepton' 
  | 'perplexity' 
  | 'replicate' 
  | 'together' 
  | 'upstash'
  | string; // Allow any string for extensibility

/**
 * Agent configuration
 */
export interface AgentConfig {
  id: string;
  systemMessage?: string;
  platform: AIPlatform;
  model: string; // Model identifier (e.g., 'gpt-4', 'llama-3.1-70b-versatile', 'claude-3-opus')
  tools?: string[]; // Array of tool IDs to assign to this agent
  temperature?: number; // Optional temperature setting
  maxTokens?: number; // Optional max tokens setting
  utterances?: string[]; // Phrases that trigger this agent directly (bypasses intent matching)
  /** MCP server references (string[] of server IDs from global config) */
  mcpServers?: string[];
  maxSteps?: number; // Maximum number of steps in the agent loop (default: 20)
  toolChoice?: AgentToolChoice; // Control tool usage
  toolTimeout?: number; // Timeout for tool execution in milliseconds (default: 300000 = 5 minutes)
  persistHistory?: boolean; // Whether to persist conversation history for this agent (default: true)
  toolRetry?: ToolRetryPolicy; // Retry policy for tool execution
}

/**
 * Tool retry policy configuration
 * Only retries errors classified as RETRYABLE (transient network/rate limit errors)
 */
export interface ToolRetryPolicy {
  maxRetries?: number; // Maximum number of retry attempts (default: 3)
  backoffMs?: number; // Initial backoff delay in ms (default: 1000)
  maxBackoffMs?: number; // Maximum backoff delay in ms (default: 10000)
  jitterMs?: number; // Random jitter added to backoff in ms (default: 200)
  timeoutBackoffMs?: number; // Base delay for timeout retries in ms (default: 15000)
}

/**
 * Retry diagnostics attached to provider errors after exhausting retries.
 *
 * Providers (e.g. Groq) attach this metadata to errors so the factory
 * can propagate structured retry information to CLI consumers.
 */
export interface RetryDiagnostics {
  readonly provider: string;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly maxRetries: number;
  readonly lastStatusCode?: number;
  readonly failureCategory: string;
}

/**
 * Error with retry diagnostics attached.
 *
 * Used as a branded intersection so consumers can access diagnostics
 * without unsafe `as any` casts.
 */
export interface ErrorWithRetryDiagnostics extends Error {
  readonly _retryDiagnostics: RetryDiagnostics;
}

/**
 * Type guard for errors carrying retry diagnostics metadata.
 */
export function hasRetryDiagnostics(error: unknown): error is ErrorWithRetryDiagnostics {
  return (
    error instanceof Error &&
    '_retryDiagnostics' in error &&
    typeof (error as any)._retryDiagnostics === 'object' &&
    (error as any)._retryDiagnostics !== null
  );
}

export function normalizeToolChoice(toolChoice: AgentToolChoice | undefined): ProviderToolChoice | undefined {
  if (toolChoice === undefined) {
    return undefined;
  }

  if (toolChoice === 'auto' || toolChoice === 'required' || toolChoice === 'none') {
    return toolChoice;
  }

  if ('tool' in toolChoice) {
    return { tool: toolChoice.tool };
  }

  if ('oneOf' in toolChoice) {
    return {
      mode: toolChoice.mode,
      oneOf: toolChoice.oneOf,
    };
  }

  return { tool: toolChoice.toolName };
}

/**
 * Agent instance (created from config)
 */
export interface AgentInstance {
  id: string;
  config: AgentConfig;
  processMessage: (message: string, messages?: AgentMessage[]) => Effect.Effect<AgentResponse, Error>;
  // Stream has error and requirements channels - actual types vary by implementation
  streamMessage?: (
    message: string,
    messages?: AgentMessage[],
    options?: { threadId?: string }
  ) => Stream.Stream<StreamEvent, unknown, any>;
}

/**
 * Message to send to an agent
 * Aligned with Effect Prompt message encoding for type compatibility
 */
export type AgentMessage = Prompt.MessageEncoded;

/**
 * Agent response
 */
export interface AgentResponse {
  content: string;
  toolCalls?: Array<{
    toolId: string;
    args: Record<string, any>;
    result?: any;
    metadata?: Record<string, unknown>;
    /** Error info for failed tool calls (OpenAI API standard) */
    error?: {
      code: string;
      message: string;
    };
  }>;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  handoff?: {
    type: 'handoff';
    agentId: string;
    message: string;
    context?: Record<string, any>;
  };
  /** Routing explanation (populated when routing explainability is enabled) */
  routingExplanation?: import('../routing/types').RoutingExplanation;
}
