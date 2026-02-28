import { Data } from 'effect';

/**
 * Error types for MessageProcessor operations
 * All errors use Data.TaggedError for type-safe error handling with Effect.
 */

/**
 * Error when message validation fails (e.g., too long)
 */
export class MessageValidationError extends Data.TaggedError('MessageValidationError')<{
  readonly message: string;
  readonly details?: string;
}> {}

/**
 * Error when no route is found for a message
 */
export class NoRouteFoundError extends Data.TaggedError('NoRouteFoundError')<{
  readonly message: string;
}> {}

/**
 * Route context metadata included in RouteExecutionError for diagnostics
 */
export interface RouteContext {
  /** The agent ID if routing selected an agent */
  readonly agentId?: string;
  /** The intent ID if routing matched an intent */
  readonly intentId?: string;
  /** The pipeline ID if routing matched a pipeline */
  readonly pipelineId?: string;
  /** The method used for route selection */
  readonly selectionType?:
    | 'agent.utterance'
    | 'intent.matching'
    | 'pipeline.utterance'
    | 'default.agent'
    | 'message.router.rule'
    | 'message.router.fallback'
    | 'unknown';
}

/**
 * Error when route execution fails
 * Includes route context metadata for diagnostics when routing has already
 * selected a target (agent, pipeline, or intent).
 */
export class RouteExecutionError extends Data.TaggedError('RouteExecutionError')<{
  /** The type of route that was being executed */
  readonly routeType: string;
  /** The underlying cause of the failure */
  readonly cause: unknown;
  /** Route context metadata - populated when routing selected a target */
  readonly routeContext?: RouteContext;
}> {}

/**
 * Error when agent handoff fails
 */
export class HandoffError extends Data.TaggedError('HandoffError')<{
  readonly fromAgentId: string;
  readonly toAgentId: string;
  readonly cause: unknown;
}> {}

/**
 * Error when conversation ID is required but not provided
 */
export class ConversationIdRequiredError extends Data.TaggedError('ConversationIdRequiredError')<{
  readonly reason?: string;
}> {}

/**
 * Error when target agent is not found during routing or handoff
 */
export class AgentNotFoundError extends Data.TaggedError('AgentNotFoundError')<{
  readonly agentId: string;
}> {}

/**
 * Error when maximum handoff depth is exceeded
 */
export class MaxHandoffDepthError extends Data.TaggedError('MaxHandoffDepthError')<{
  readonly depth: number;
  readonly maxDepth: number;
}> {}

/**
 * Union type of all MessageProcessor errors
 */
export type MessageProcessorError =
  | MessageValidationError
  | NoRouteFoundError
  | RouteExecutionError
  | HandoffError
  | ConversationIdRequiredError
  | AgentNotFoundError
  | MaxHandoffDepthError;
