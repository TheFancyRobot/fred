import { Schema } from 'effect';

export const SessionId = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(256),
  Schema.pattern(/^[\x20-\x7e]+$/),
  Schema.annotations({
    identifier: 'SessionId',
    description: 'Printable ASCII session identifier. Control characters are rejected.',
  })
);
export type SessionId = typeof SessionId.Type;

export const SessionHeaders = Schema.Struct({
  'x-session-id': Schema.optional(SessionId),
});

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<JsonValue>
  | { readonly [key: string]: JsonValue };

export const JsonValue: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.Number,
    Schema.String,
    Schema.Array(JsonValue),
    Schema.Record({ key: Schema.String, value: JsonValue })
  )
).annotations({ identifier: 'JsonValue' });

export const ChatRole = Schema.Literal('system', 'user', 'assistant', 'tool');
export const FinishReason = Schema.Literal('stop', 'length', 'tool_calls');

export const ToolCall = Schema.Struct({
  id: Schema.String,
  type: Schema.Literal('tool_call'),
  tool_call: Schema.Struct({
    name: Schema.String.pipe(Schema.maxLength(256)),
    arguments: Schema.String.pipe(Schema.maxLength(100_000)),
  }),
}).annotations({ identifier: 'ToolCall' });

export const ChatMessage = Schema.Struct({
  role: ChatRole,
  content: Schema.NullOr(Schema.String.pipe(Schema.maxLength(1_000_000))),
  name: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
  tool_calls: Schema.optional(Schema.Array(ToolCall).pipe(Schema.maxItems(1_000))),
  tool_call_id: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
}).annotations({ identifier: 'ChatMessage' });
export type ChatMessage = typeof ChatMessage.Type;

export const ChatCompletionRequest = Schema.Struct({
  model: Schema.optional(Schema.String.pipe(Schema.maxLength(256))),
  messages: Schema.Array(ChatMessage).pipe(Schema.minItems(1), Schema.maxItems(1_000)),
  temperature: Schema.optional(Schema.Number.pipe(Schema.between(0, 2))),
  max_tokens: Schema.optional(Schema.Int.pipe(Schema.between(1, 1_000_000))),
  stream: Schema.optional(Schema.Boolean),
}).annotations({ identifier: 'ChatCompletionRequest' });
export type ChatCompletionRequest = typeof ChatCompletionRequest.Type;

export const SimpleChatRequest = Schema.Struct({
  messages: Schema.optional(
    Schema.Array(ChatMessage).pipe(Schema.minItems(1), Schema.maxItems(1_000))
  ),
  message: Schema.optional(Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_000_000))),
  stream: Schema.optional(Schema.Boolean),
}).pipe(
  Schema.filter(
    (request) => {
      if (request.message !== undefined) return true;
      const messages = request.messages;
      return messages !== undefined && messages[messages.length - 1]?.role === 'user';
    },
    { message: () => 'Either message or a messages array ending in a user message is required' }
  ),
  Schema.annotations({ identifier: 'SimpleChatRequest' })
);
export type SimpleChatRequest = typeof SimpleChatRequest.Type;

export const MessageRequest = Schema.Struct({
  message: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_000_000)),
  options: Schema.optional(
    Schema.Struct({
      useSemanticMatching: Schema.optional(Schema.Boolean),
      semanticThreshold: Schema.optional(Schema.Number.pipe(Schema.between(0, 1))),
    })
  ),
}).annotations({ identifier: 'MessageRequest' });
export type MessageRequest = typeof MessageRequest.Type;

export const AgentResponse = Schema.Struct({
  content: Schema.String,
  output: Schema.optional(JsonValue),
  toolCalls: Schema.optional(Schema.Array(JsonValue)),
  usage: Schema.optional(
    Schema.Struct({
      inputTokens: Schema.optional(Schema.NonNegativeInt),
      outputTokens: Schema.optional(Schema.NonNegativeInt),
      totalTokens: Schema.optional(Schema.NonNegativeInt),
    })
  ),
  handoff: Schema.optional(JsonValue),
  routingExplanation: Schema.optional(JsonValue),
}).annotations({ identifier: 'AgentResponse' });

export const MessageResponse = Schema.Struct({
  success: Schema.Boolean,
  data: Schema.optional(AgentResponse),
  error: Schema.optional(Schema.String),
}).annotations({ identifier: 'MessageResponse' });

export const Usage = Schema.Struct({
  prompt_tokens: Schema.NonNegativeInt,
  completion_tokens: Schema.NonNegativeInt,
  total_tokens: Schema.NonNegativeInt,
}).annotations({ identifier: 'ChatCompletionUsage' });

export const ChatCompletionResponse = Schema.Struct({
  id: Schema.String,
  object: Schema.Literal('chat.completion'),
  created: Schema.NonNegativeInt,
  model: Schema.String,
  choices: Schema.Array(
    Schema.Struct({
      index: Schema.NonNegativeInt,
      message: ChatMessage,
      finish_reason: Schema.NullOr(FinishReason),
    })
  ),
  usage: Schema.optional(Usage),
}).annotations({ identifier: 'ChatCompletionResponse' });
export type ChatCompletionResponse = typeof ChatCompletionResponse.Type;

export const AgentRunState = Schema.Literal(
  'starting',
  'calling_model',
  'streaming',
  'running_tool',
  'paused'
);

export const AgentRunInfo = Schema.Struct({
  fiberId: Schema.String,
  agentId: Schema.String,
  workflowId: Schema.optional(Schema.String),
  sessionId: Schema.optional(SessionId),
  state: AgentRunState,
  startedAt: Schema.NonNegativeInt,
}).annotations({ identifier: 'AgentRunInfo' });

export const AgentStatusResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Array(AgentRunInfo),
  count: Schema.NonNegativeInt,
}).annotations({ identifier: 'AgentStatusResponse' });

export const HealthResponse = Schema.Struct({
  status: Schema.Literal('ok'),
  timestamp: Schema.String,
}).annotations({ identifier: 'HealthResponse' });

export const ListResponse = Schema.Struct({
  success: Schema.Boolean,
  data: Schema.Array(JsonValue),
  count: Schema.NonNegativeInt,
}).annotations({ identifier: 'ListResponse' });

export const ServerSentEvents = Schema.String.pipe(
  Schema.annotations({
    identifier: 'ServerSentEvents',
    description: 'A text/event-stream sequence of OpenAI-compatible chat completion chunks.',
  })
);
