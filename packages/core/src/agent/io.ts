import { Effect, Either, Schema } from 'effect';
import type * as SchemaTypes from 'effect/Schema';
import { AgentInputValidationError } from './errors';

export interface DecodedAgentInput<A> {
  readonly value: A;
  readonly message: string;
}

const JsonText = Schema.parseJson(Schema.Unknown);

const isStructuredProcessMessage = (message: string): boolean => {
  const trimmed = message.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
};

const serializeEncodedInput = (input: unknown): string => {
  if (typeof input === 'string') {
    return input;
  }

  const serialized = Schema.encodeUnknownEither(JsonText)(input);
  return Either.isRight(serialized) ? serialized.right : String(input);
};

const encodeValidatedInput = <S extends SchemaTypes.Schema.AnyNoContext>(
  agentId: string,
  schema: S,
  value: SchemaTypes.Schema.Type<S>,
): Effect.Effect<DecodedAgentInput<SchemaTypes.Schema.Type<S>>, AgentInputValidationError> =>
  Schema.encode(schema, { errors: 'all' })(value).pipe(
    Effect.map((encoded) => ({
      value,
      message: serializeEncodedInput(encoded),
    })),
    Effect.mapError((cause) => new AgentInputValidationError({
      agentId,
      message: `Input validation failed for agent "${agentId}".`,
      cause,
    })),
  );

/** Parse a conversational string into a structured candidate when possible. */
const parseProcessMessageInput = (message: string): unknown => {
  const trimmed = message.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return message;
  }

  const parsed = Schema.decodeUnknownEither(JsonText)(trimmed);
  return Either.isRight(parsed) ? parsed.right : message;
};

/** Validate, transform, and encode one agent input at the execution boundary. */
export const decodeAgentInput = <S extends SchemaTypes.Schema.AnyNoContext>(
  agentId: string,
  schema: S,
  input: unknown
): Effect.Effect<DecodedAgentInput<SchemaTypes.Schema.Type<S>>, AgentInputValidationError> =>
  Schema.decodeUnknown(schema, { errors: 'all' })(input).pipe(
    Effect.flatMap((value) => encodeValidatedInput(agentId, schema, value)),
    Effect.mapError((cause) => cause instanceof AgentInputValidationError
      ? cause
      : new AgentInputValidationError({
          agentId,
          message: `Input validation failed for agent "${agentId}".`,
          cause,
        }))
  );

/**
 * Decode the compatibility string entrypoint without assuming which side of a
 * schema owns JSON parsing. Raw string decoding wins; object/array parsing is a
 * fallback for schemas whose encoded side is already structured.
 */
export const decodeProcessMessageInput = <S extends SchemaTypes.Schema.AnyNoContext>(
  agentId: string,
  schema: S,
  message: string,
): Effect.Effect<DecodedAgentInput<SchemaTypes.Schema.Type<S> | string>, AgentInputValidationError> => {
  const recover = (
    rawError: AgentInputValidationError
  ): Effect.Effect<DecodedAgentInput<SchemaTypes.Schema.Type<S> | string>, AgentInputValidationError> => {
    if (!isStructuredProcessMessage(message)) {
      return Effect.succeed({ value: message, message });
    }

    const candidate = parseProcessMessageInput(message);
    return candidate === message
      ? Effect.fail(rawError)
      : decodeAgentInput(agentId, schema, candidate);
  };

  return Effect.catchAll(decodeAgentInput(agentId, schema, message), recover);
};

/** Validate a direct `run()` value on the schema's Type side, then encode it. */
export const validateAgentInput = <S extends SchemaTypes.Schema.AnyNoContext>(
  agentId: string,
  schema: S,
  input: unknown,
): Effect.Effect<DecodedAgentInput<SchemaTypes.Schema.Type<S>>, AgentInputValidationError> =>
  Schema.validate(schema, { errors: 'all' })(input).pipe(
    Effect.flatMap((value) => encodeValidatedInput(agentId, schema, value)),
    Effect.mapError((cause) => cause instanceof AgentInputValidationError
      ? cause
      : new AgentInputValidationError({
          agentId,
          message: `Input validation failed for agent "${agentId}".`,
          cause,
        })),
  );

export const decodeStringAgentInput = (
  agentId: string,
  input: unknown
): Effect.Effect<DecodedAgentInput<string>, AgentInputValidationError> =>
  decodeAgentInput(agentId, Schema.String, input);

export const validateStringAgentInput = (
  agentId: string,
  input: unknown,
): Effect.Effect<DecodedAgentInput<string>, AgentInputValidationError> =>
  validateAgentInput(agentId, Schema.String, input);
