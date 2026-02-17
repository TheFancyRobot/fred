/**
 * CLI Command Error Types
 *
 * Typed error definitions for CLI command handlers using Schema.TaggedError.
 * These replace raw try/catch + string errors with structured, tagged errors
 * that can be matched with Effect.catchTag / Effect.catchTags.
 */

import { Schema } from 'effect';

/**
 * Error initializing Fred from project config.
 */
export class ConfigInitError extends Schema.TaggedError<ConfigInitError>()(
  'ConfigInitError',
  {
    message: Schema.String,
  },
) {}

/**
 * Error initializing or bootstrapping the Fred instance.
 */
export class FredInitError extends Schema.TaggedError<FredInitError>()(
  'FredInitError',
  {
    message: Schema.String,
  },
) {}

/**
 * Error during intent matching.
 */
export class IntentMatchError extends Schema.TaggedError<IntentMatchError>()(
  'IntentMatchError',
  {
    message: Schema.String,
  },
) {}

/**
 * Error during routing evaluation.
 */
export class RoutingError extends Schema.TaggedError<RoutingError>()(
  'RoutingError',
  {
    message: Schema.String,
  },
) {}

/**
 * Error when a requested agent is not found.
 */
export class AgentNotFoundError extends Schema.TaggedError<AgentNotFoundError>()(
  'AgentNotFoundError',
  {
    agentId: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Error during message processing.
 */
export class MessageProcessError extends Schema.TaggedError<MessageProcessError>()(
  'MessageProcessError',
  {
    message: Schema.String,
    retryDiagnostics: Schema.optional(Schema.Unknown),
  },
) {}

/**
 * Error when a session is not found.
 */
export class SessionNotFoundError extends Schema.TaggedError<SessionNotFoundError>()(
  'SessionNotFoundError',
  {
    sessionId: Schema.String,
    message: Schema.String,
  },
) {}

/**
 * Error during session operations (list, export, delete).
 */
export class SessionOperationError extends Schema.TaggedError<SessionOperationError>()(
  'SessionOperationError',
  {
    message: Schema.String,
  },
) {}

/**
 * Error for invalid CLI arguments or options.
 */
export class InvalidArgumentError extends Schema.TaggedError<InvalidArgumentError>()(
  'InvalidArgumentError',
  {
    message: Schema.String,
  },
) {}

/**
 * Error during MCP server operations.
 */
export class McpOperationError extends Schema.TaggedError<McpOperationError>()(
  'McpOperationError',
  {
    serverId: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

/**
 * Error for unknown subcommands.
 */
export class UnknownSubcommandError extends Schema.TaggedError<UnknownSubcommandError>()(
  'UnknownSubcommandError',
  {
    subcommand: Schema.String,
    available: Schema.String,
    message: Schema.String,
  },
) {}
