import { HttpApiBuilder, HttpServerResponse } from '@effect/platform';
import type { AgentResponse } from '@fancyrobot/fred';
import { MessageProcessorService } from '@fancyrobot/fred/effect';
import { Effect, Either, Schema } from 'effect';
import { FredHttpApi } from '../api';
import { JsonValue, type ChatMessage } from '../api/schemas';
import { resolveSessionId, useSession, withSessionHeader } from './session';

const toJson = Schema.decodeUnknown(JsonValue);

const optionalJson = (value: unknown) =>
  value === undefined
    ? Effect.void
    : toJson(value).pipe(
        Effect.catchTag('ParseError', () => Effect.succeed(String(value))),
        Effect.map((decoded) => decoded as JsonValue),
      );

const toMessageResponse = Effect.fn('FredHttp.toMessageResponse')(
  function* (response: AgentResponse) {
    const output = yield* optionalJson(response.output);
    const toolCalls = yield* optionalJson(response.toolCalls);
    const handoff = yield* optionalJson(response.handoff);
    const routingExplanation = yield* optionalJson(response.routingExplanation);
    return {
      success: true,
      data: {
        content: response.content,
        ...(output === undefined ? {} : { output }),
        ...(Array.isArray(toolCalls) ? { toolCalls } : {}),
        ...(response.usage === undefined ? {} : { usage: response.usage }),
        ...(handoff === undefined ? {} : { handoff }),
        ...(routingExplanation === undefined ? {} : { routingExplanation }),
      },
    };
  },
);

export const lastUserMessage = (
  messages: ReadonlyArray<ChatMessage>,
): string | undefined => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'user' && message.content !== null) return message.content;
  }
  return undefined;
};

const chatMessages = (messages: ReadonlyArray<ChatMessage>) =>
  messages.map((message) => ({ role: message.role, content: message.content ?? '' }));

const completionResponse = (response: AgentResponse, model: string, now: number) => ({
  id: `chatcmpl-${now}`,
  object: 'chat.completion' as const,
  created: Math.floor(now / 1000),
  model,
  choices: [{
    index: 0,
    message: { role: 'assistant' as const, content: response.content },
    finish_reason: 'stop' as const,
  }],
  ...(response.usage === undefined ? {} : {
    usage: {
      prompt_tokens: response.usage.inputTokens ?? 0,
      completion_tokens: response.usage.outputTokens ?? 0,
      total_tokens: response.usage.totalTokens ?? 0,
    },
  }),
});

const jsonWithSession = (body: unknown, sessionId: string, status = 200) =>
  Effect.succeed(withSessionHeader(HttpServerResponse.unsafeJson(body, { status }), sessionId));

export const FredMessageHandlersLive = HttpApiBuilder.group(
  FredHttpApi,
  'message',
  (handlers) =>
    handlers
      .handle('message', ({ headers, payload }) =>
        Effect.gen(function* () {
          const processor = yield* MessageProcessorService;
          const used = yield* useSession(
            resolveSessionId(headers['x-session-id']),
            Effect.either(processor.processMessage(payload.message, payload.options)),
          );
          if (Either.isLeft(used.result)) {
            return yield* jsonWithSession(
              { success: false, error: used.result.left.message },
              used.sessionId,
              500,
            );
          }
          const body = yield* toMessageResponse(used.result.right);
          return yield* jsonWithSession(body, used.sessionId);
        }),
      )
      .handle('chat', ({ headers, payload }) =>
        Effect.gen(function* () {
          const processor = yield* MessageProcessorService;
          const messages = payload.messages ?? [{ role: 'user' as const, content: payload.message ?? '' }];
          const used = yield* useSession(
            resolveSessionId(headers['x-session-id'], payload.conversation_id),
            Effect.either(processor.processChatMessage(chatMessages(messages))),
          );
          if (Either.isLeft(used.result)) {
            return yield* jsonWithSession(
              { success: false, error: used.result.left.message },
              used.sessionId,
              500,
            );
          }
          const clock = yield* Effect.clock;
          return yield* jsonWithSession(
            completionResponse(used.result.right, 'fred-agent', clock.unsafeCurrentTimeMillis()),
            used.sessionId,
          );
        }),
      ),
);
