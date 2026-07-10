import { Data, Schema } from 'effect';

export const getAgentNotFoundMessage = (id: string): string => `Agent \"${id}\" was not found`;
export const getAgentAlreadyExistsMessage = (id: string): string => `Agent \"${id}\" is already registered`;
export const getAgentCreationMessage = (id: string): string => `Failed to create agent \"${id}\"`;

/**
 * Error thrown when an agent is not found by ID.
 */
export class AgentNotFoundError extends Data.TaggedError("AgentNotFoundError")<{
  readonly id: string;
  readonly message?: string;
}> {}

/**
 * Error thrown when attempting to create an agent with an ID that already exists.
 */
export class AgentAlreadyExistsError extends Data.TaggedError("AgentAlreadyExistsError")<{
  readonly id: string;
  readonly message?: string;
}> {}

/**
 * Error thrown when agent creation fails.
 */
export class AgentCreationError extends Data.TaggedError("AgentCreationError")<{
  readonly id: string;
  readonly message?: string;
  readonly cause: unknown;
}> {}

/**
 * Error thrown when agent execution fails.
 */
export class AgentExecutionError extends Data.TaggedError("AgentExecutionError")<{
  readonly agentId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Raised before provider/tool execution when an agent input fails its schema. */
export class AgentInputValidationError extends Schema.TaggedError<AgentInputValidationError>(
  '@fancyrobot/fred/AgentInputValidationError'
)('AgentInputValidationError', {
  agentId: Schema.String,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

/** Raised after malformed structured output retries are exhausted. */
export class AgentOutputValidationError extends Schema.TaggedError<AgentOutputValidationError>(
  '@fancyrobot/fred/AgentOutputValidationError'
)('AgentOutputValidationError', {
  agentId: Schema.String,
  attempts: Schema.Number,
  maxRetries: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

/** Raised when a BAML prompt is used without the fred-baml adapter layer. */
export class MissingPromptSourceAdapterError extends Schema.TaggedError<MissingPromptSourceAdapterError>(
  '@fancyrobot/fred/MissingPromptSourceAdapterError'
)('MissingPromptSourceAdapterError', {
  agentId: Schema.String,
  functionName: Schema.String,
  message: Schema.String,
}) {}

/** Raised when a configured prompt source cannot be rendered. */
export class PromptResolutionError extends Schema.TaggedError<PromptResolutionError>(
  '@fancyrobot/fred/PromptResolutionError'
)('PromptResolutionError', {
  agentId: Schema.String,
  source: Schema.Literal('string', 'template', 'baml'),
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

/**
 * Error thrown when parsing or validating an agent markdown file fails.
 */
export class AgentFileParseError extends Data.TaggedError("AgentFileParseError")<{
  readonly filePath: string;
  readonly message: string;
}> {}

/**
 * Union type for all agent errors, enabling exhaustive catchTag handling.
 */
export type AgentError =
  | AgentNotFoundError
  | AgentAlreadyExistsError
  | AgentCreationError
  | AgentExecutionError
  | AgentInputValidationError
  | AgentOutputValidationError
  | MissingPromptSourceAdapterError
  | PromptResolutionError
  | AgentFileParseError;
