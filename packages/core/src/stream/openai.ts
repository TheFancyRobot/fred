import { Effect, Stream } from 'effect';
import type { StreamEvent } from './events';

export interface OpenAIStreamOptions {
  model: string;
  timeoutMs?: number;
  now?: () => number;
  signal?: AbortSignal;
}

export interface OpenAIChatChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: Array<{
        index: number;
        id: string;
        type: 'tool_call';
        tool_call: {
          name: string;
          arguments: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

type OpenAIChunk = OpenAIChatChunk;

const encodeToolArguments = (input: Record<string, unknown>): string => {
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return '{}';
  }
};

const mapUsage = (usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) => {
  if (!usage) {
    return undefined;
  }

  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  };
};

export const toOpenAIStream = <E extends Error, R>(
  events: Stream.Stream<StreamEvent, E, R>,
  options: OpenAIStreamOptions
): Stream.Stream<OpenAIChunk, E | Error, R> => {
  const now = options.now ?? (() => Date.now());
  const created = Math.floor(now() / 1000);
  let chunkId = '';
  let finishReason = 'stop';
  let usage: OpenAIChatChunk['usage'];

  const withTimeout = options.timeoutMs
    ? events.pipe(Stream.timeoutFail(() => new Error('Stream timeout'), options.timeoutMs))
    : events;

  const withCancellation = options.signal
    ? withTimeout.pipe(
        Stream.interruptWhen(
          Effect.async<void, never>((resume) => {
            const onAbort = () => {
              resume(Effect.succeed(undefined));
            };

            if (options.signal?.aborted) {
              onAbort();
              return;
            }

            options.signal?.addEventListener('abort', onAbort, { once: true });
            return Effect.sync(() => {
              options.signal?.removeEventListener('abort', onAbort);
            });
          })
        )
      )
    : withTimeout;

  return withCancellation.pipe(
    Stream.flatMap((event) => {
      if (!chunkId && event.runId) {
        chunkId = `chatcmpl-${event.runId}`;
      }

      switch (event.type) {
        case 'message-start':
          return Stream.succeed<OpenAIChunk>({
            id: chunkId || `chatcmpl-${event.runId}`,
            object: 'chat.completion.chunk',
            created,
            model: options.model,
            choices: [
              {
                index: 0,
                delta: { role: 'assistant' },
                finish_reason: null,
              },
            ],
          });
        case 'token':
          if (!event.delta) {
            return Stream.empty;
          }
          return Stream.succeed<OpenAIChunk>({
            id: chunkId || `chatcmpl-${event.runId}`,
            object: 'chat.completion.chunk',
            created,
            model: options.model,
            choices: [
              {
                index: 0,
                delta: { content: event.delta },
                finish_reason: null,
              },
            ],
          });
        case 'tool-call':
          return Stream.succeed<OpenAIChunk>({
            id: chunkId || `chatcmpl-${event.runId}`,
            object: 'chat.completion.chunk',
            created,
            model: options.model,
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: event.toolCallId,
                      type: 'tool_call',
                      tool_call: {
                        name: event.toolName,
                        arguments: encodeToolArguments(event.input),
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          });
        case 'message-end':
          finishReason = event.finishReason ?? finishReason;
          return Stream.empty;
        case 'usage':
          usage = mapUsage(event.usage);
          return Stream.empty;
        case 'run-end':
          return Stream.succeed<OpenAIChunk>({
            id: chunkId || `chatcmpl-${event.runId}`,
            object: 'chat.completion.chunk',
            created,
            model: options.model,
            choices: [
              {
                index: 0,
                delta: {},
                finish_reason: finishReason,
              },
            ],
            usage: usage ?? mapUsage(event.result.usage),
          });
        default:
          return Stream.empty;
      }
    }),
    Stream.ensuring(Effect.sync(() => {}))
  );
};
