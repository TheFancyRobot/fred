import { HttpApiEndpoint, HttpApiGroup, OpenApi } from '@effect/platform';
import { OpenAiErrorResponse } from './errors';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  SessionHeaders,
} from './schemas';

export const FredOpenAiApi = HttpApiGroup.make('openai').add(
  HttpApiEndpoint.post('chatCompletions', '/v1/chat/completions')
    .setHeaders(SessionHeaders)
    .setPayload(ChatCompletionRequest)
    .addSuccess(ChatCompletionResponse)
    .addError(OpenAiErrorResponse, { status: 400 })
    .addError(OpenAiErrorResponse, { status: 401 })
    .addError(OpenAiErrorResponse, { status: 408 })
    .addError(OpenAiErrorResponse, { status: 413 })
    .addError(OpenAiErrorResponse, { status: 429 })
    .addError(OpenAiErrorResponse, { status: 500 })
    .annotate(OpenApi.Transform, (operation) => {
      const success = operation.responses[200];
      return {
        ...operation,
        security: [{ bearerAuth: [] }],
        responses: {
          ...operation.responses,
          200: {
            ...success,
            headers: {
              'X-Session-Id': {
                description: 'The session used for this request.',
                schema: { type: 'string', maxLength: 256 },
              },
            },
            content: {
              ...success?.content,
              'text/event-stream': {
                schema: {
                  type: 'string',
                  description: 'OpenAI-compatible server-sent events when stream=true.',
                },
              },
            },
          },
        },
      };
    })
);
