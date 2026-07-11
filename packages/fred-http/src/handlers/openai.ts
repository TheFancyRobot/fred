import { HttpApiBuilder, HttpServerResponse } from '@effect/platform';
import { toOpenAIStream } from '@fancyrobot/fred';
import { MessageProcessorService } from '@fancyrobot/fred/effect';
import { Effect, Either } from 'effect';
import { FredHttpApi } from '../api';
import { lastUserMessage } from './message';
import { resolveSessionId, useSession, useSessionStream, withSessionHeader } from './session';
import { encodeOpenAiSse, openAiSseResponse } from './sse';

export const FredOpenAiHandlersLive = HttpApiBuilder.group(
  FredHttpApi,
  'openai',
  (handlers) =>
    handlers.handle('chatCompletions', ({ headers, payload }) =>
      Effect.gen(function* () {
        const sessionId = resolveSessionId(headers['x-session-id'], payload.conversation_id);
        const message = lastUserMessage(payload.messages);
        const model = payload.model ?? 'fred-agent';

        if (message === undefined) {
          const response = HttpServerResponse.unsafeJson({
            error: {
              message: 'At least one user message is required',
              type: 'invalid_request_error',
              code: 'missing_user_message',
            },
          }, { status: 400 });
          return yield* Effect.succeed(
            sessionId === undefined ? response : withSessionHeader(response, sessionId),
          );
        }
        // TypeScript does not retain generator narrowing across `yield*`; the
        // undefined branch has already returned the 400 response above.
        const userMessage = message ?? '';
        const processor = yield* MessageProcessorService;

        if (payload.stream === true) {
          const used = yield* useSessionStream(
            sessionId,
            processor.streamMessage(userMessage),
          );
          const chunks = toOpenAIStream(used.stream, { model });
          return openAiSseResponse(encodeOpenAiSse(chunks), used.sessionId);
        }

        const used = yield* useSession(
          sessionId,
          Effect.either(processor.processChatMessage(
            payload.messages.map((item) => ({ role: item.role, content: item.content ?? '' })),
          )),
        );
        if (Either.isLeft(used.result)) {
          return withSessionHeader(HttpServerResponse.unsafeJson({
            error: {
              message: used.result.left.message,
              type: 'processing_error',
            },
          }, { status: 500 }), used.sessionId);
        }
        const clock = yield* Effect.clock;
        const now = clock.unsafeCurrentTimeMillis();
        return withSessionHeader(HttpServerResponse.unsafeJson({
          id: `chatcmpl-${now}`,
          object: 'chat.completion' as const,
          created: Math.floor(now / 1000),
          model,
          choices: [{
            index: 0,
            message: { role: 'assistant' as const, content: used.result.right.content },
            finish_reason: 'stop' as const,
          }],
        }), used.sessionId);
      }),
    ),
);
