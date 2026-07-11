import { HttpApiEndpoint, HttpApiGroup, OpenApi } from '@effect/platform';
import { GenericErrorResponse } from './errors';
import {
  ChatCompletionResponse,
  MessageRequest,
  MessageResponse,
  SessionHeaders,
  SimpleChatRequest,
} from './schemas';

export const FredMessageApi = HttpApiGroup.make('message')
  .add(
    HttpApiEndpoint.post('message', '/message')
      .setHeaders(SessionHeaders)
      .setPayload(MessageRequest)
      .addSuccess(MessageResponse)
      .addError(GenericErrorResponse, { status: 400 })
      .addError(GenericErrorResponse, { status: 401 })
      .addError(GenericErrorResponse, { status: 408 })
      .addError(GenericErrorResponse, { status: 413 })
      .addError(GenericErrorResponse, { status: 429 })
      .addError(GenericErrorResponse, { status: 500 })
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
            },
          },
        };
      })
  )
  .add(
    HttpApiEndpoint.post('chat', '/chat')
      .setHeaders(SessionHeaders)
      .setPayload(SimpleChatRequest)
      .addSuccess(ChatCompletionResponse)
      .addError(GenericErrorResponse, { status: 400 })
      .addError(GenericErrorResponse, { status: 401 })
      .addError(GenericErrorResponse, { status: 408 })
      .addError(GenericErrorResponse, { status: 413 })
      .addError(GenericErrorResponse, { status: 429 })
      .addError(GenericErrorResponse, { status: 500 })
      .addError(GenericErrorResponse, { status: 501 })
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
            },
          },
        };
      })
  );
