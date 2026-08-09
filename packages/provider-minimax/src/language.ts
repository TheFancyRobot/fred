/**
 * MiniMax language capability adapter.
 *
 * Implements the language/chat capability for MiniMax using the
 * OpenAI-compatible Chat Completions API endpoint.
 *
 * Design choices:
 * - Uses MiniMax's OpenAI-compatible Chat Completions API (not the
 *   newer OpenAI Responses API) for maximum compatibility.
 * - Follows the same pattern as the Groq provider (custom LanguageModel
 *   via @effect/platform HttpClient) since @effect/ai-openai v0.30+
 *   defaults to the Responses API which MiniMax does not support.
 * - Uses `Data.TaggedError` for typed, catchable MiniMax errors.
 * - Uses `Effect.fn` for automatic tracing on core operations.
 */

import { Data, Effect, Layer, Redacted, Stream, Option, Schedule } from 'effect';
import * as Duration from 'effect/Duration';
import * as HttpClient from '@effect/platform/HttpClient';
import * as HttpClientRequest from '@effect/platform/HttpClientRequest';
import * as HttpBody from '@effect/platform/HttpBody';
import { FetchHttpClient } from '@effect/platform';
import * as AiError from '@effect/ai/AiError';
import * as AiModel from '@effect/ai/Model';
import * as LanguageModel from '@effect/ai/LanguageModel';
import * as Prompt from '@effect/ai/Prompt';
import * as Response from '@effect/ai/Response';
import * as Tool from '@effect/ai/Tool';
import { IdGenerator } from '@effect/ai/IdGenerator';
import type { ProviderConfig, ProviderModelDefaults } from '@fancyrobot/fred';
import { normalizeMessages } from '@fancyrobot/fred/messages';
import {
  MINIMAX_DEFAULT_BASE_URL,
  MINIMAX_API_KEY_ENV_VAR,
  classifyHttpError,
  buildRetrySchedule,
  createAuthenticatedClient,
  createAuthenticatedClientRaw,
  formatApiErrorMessage,
  type ErrorClassification,
} from './config';
import {
  MiniMaxMissingApiKeyError,
  formatMiniMaxErrorMessage,
  buildErrorFields,
} from './errors';

// Re-export for public API backward compatibility
export { MINIMAX_DEFAULT_BASE_URL } from './config';
export { MiniMaxMissingApiKeyError } from './errors';

/**
 * Capability set for the MiniMax provider.
 * Language is the only capability in this step; additional
 * capabilities (image, video, speech, voice, music) are added
 * in subsequent steps.
 */
export const MINIMAX_CAPABILITIES = new Set<import('@fancyrobot/fred').ProviderCapabilityKey>(['language']);

// ─── Error Types ──────────────────────────────────────────────────────────────

/**
 * Error thrown for MiniMax language model failures (upstream errors,
 * malformed responses, etc.).
 */
export class MiniMaxLanguageModelError extends Data.TaggedError(
  'MiniMaxLanguageModelError'
)<{
  readonly module: string;
  readonly method: string;
  readonly description: string;
  readonly cause?: unknown;
}> {
  get message(): string {
    return formatMiniMaxErrorMessage(this);
  }
}

// ─── API Response Types ──────────────────────────────────────────────────────

interface ChatCompletionMessage {
  role: string;
  content: string | null;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

interface ChatCompletionChoice {
  index: number;
  message: ChatCompletionMessage;
  finish_reason: string | null;
  delta?: ChatCompletionMessage;
}

interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ChatCompletionStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        type?: 'function';
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Language Model Creation ────────────────────────────────────────────────

/**
 * Create a MiniMax LanguageModel using the Chat Completions API.
 *
 * Uses @effect/platform HttpClient to call MiniMax's OpenAI-compatible
 * Chat Completions endpoint directly.
 */
export function createMiniMaxLanguageModel(
  apiKey: Redacted.Redacted<string>,
  apiUrl: string,
  modelId: string,
  overrides?: ProviderModelDefaults
) {
  const temperature = overrides?.temperature;
  const maxTokens = overrides?.maxTokens;

  return AiModel.make('minimax', Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const httpClient = yield* HttpClient.HttpClient;
      const clientWithBaseUrl = createAuthenticatedClientRaw(httpClient, apiKey, apiUrl);
      const clientWithBaseUrlOk = createAuthenticatedClient(httpClient, apiKey, apiUrl);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return yield* LanguageModel.make({
        generateText: Effect.fnUntraced(function* (options: LanguageModel.ProviderOptions) {
          const messages = convertPromptToMessages(options.prompt);
          const tools = convertToolsToFunctions(options.tools);
          const toolChoice = resolveToolChoice(options.toolChoice, tools);
          const responseFormat = resolveResponseFormat(options.responseFormat);

          const requestBody: Record<string, unknown> = {
            model: modelId,
            messages,
            ...(temperature !== undefined && { temperature }),
            ...(maxTokens !== undefined && { max_tokens: maxTokens }),
            ...(tools && { tools }),
            ...(toolChoice && { tool_choice: toolChoice }),
            ...(responseFormat && { response_format: responseFormat }),
          };

          const request = HttpClientRequest.post('/chat/completions', {
            body: HttpBody.unsafeJson(requestBody),
          }).pipe(HttpClientRequest.setHeader('Accept', 'text/event-stream'));

          // Wrap HTTP call with retry/backoff for transient errors
          let attemptCount = 0;
          let lastClassification: ErrorClassification | undefined;

          const httpEffect = clientWithBaseUrlOk.execute(request).pipe(
            Effect.tapError((error) =>
              Effect.sync(() => {
                attemptCount++;
                lastClassification = classifyHttpError(error);
              })
            )
          );

          const retriedHttpEffect = httpEffect.pipe(
            Effect.retry(
              buildRetrySchedule().pipe(
                Schedule.whileInput((error: unknown) => {
                  const classification = classifyHttpError(error);
                  return classification.retryable;
                })
              )
            ),
            Effect.catchAll((error) => {
              attemptCount++;
              const classification = lastClassification ?? classifyHttpError(error);
              return Effect.fail(new MiniMaxLanguageModelError({
                module: 'MiniMaxLanguageModel',
                method: 'generateText',
                description: classification.retryable
                  ? `HTTP request failed after ${attemptCount} attempt(s) (${classification.category})`
                  : `HTTP request failed: non-retryable ${classification.statusCode} error`,
                cause: error,
              }));
            })
          );

          const response = yield* retriedHttpEffect;

          const json = (yield* response.json.pipe(
            Effect.mapError((error) =>
              new MiniMaxLanguageModelError({
                module: 'MiniMaxLanguageModel',
                method: 'generateText',
                description: 'Failed to parse response JSON',
                cause: error,
              })
            )
          )) as ChatCompletionResponse;
          const choice = json.choices[0];

          if (!choice) {
            return yield* Effect.fail(new MiniMaxLanguageModelError({
              module: 'MiniMaxLanguageModel',
              method: 'generateText',
              description: 'No response choices from MiniMax API',
            }));
          }

          const parts: Array<Response.PartEncoded> = [];
          const content = choice.message.content ?? '';
          if (content.length > 0) {
            parts.push({ type: 'text', text: content });
          }

          const toolCalls = choice.message.tool_calls ?? [];
          for (const toolCall of toolCalls) {
            const parsedArgs = yield* parseToolCallArguments(toolCall.function.arguments);
            parts.push({
              type: 'tool-call',
              id: toolCall.id,
              name: toolCall.function.name,
              params: parsedArgs,
              providerExecuted: false,
            });
          }

          parts.push({
            type: 'finish',
            reason: mapFinishReason(choice.finish_reason),
            usage: mapUsage(json.usage),
          });

          return parts;
        }) as any,

        streamText: ((options: LanguageModel.ProviderOptions) => Stream.unwrapScoped(Effect.gen(function* () {
          const idGenerator = yield* IdGenerator;
          const messages = convertPromptToMessages(options.prompt);
          const tools = convertToolsToFunctions(options.tools);
          const toolChoice = resolveToolChoice(options.toolChoice, tools);
          const responseFormat = resolveResponseFormat(options.responseFormat);

          const requestBody: Record<string, unknown> = {
            model: modelId,
            messages,
            stream: true,
            ...(temperature !== undefined && { temperature }),
            ...(maxTokens !== undefined && { max_tokens: maxTokens }),
            ...(tools && { tools }),
            ...(toolChoice && { tool_choice: toolChoice }),
            ...(responseFormat && { response_format: responseFormat }),
          };

          const request = HttpClientRequest.post('/chat/completions', {
            body: HttpBody.unsafeJson(requestBody),
          }).pipe(HttpClientRequest.setHeader('Accept', 'text/event-stream'));

          const response = yield* clientWithBaseUrl.execute(request).pipe(
            Effect.timeoutFail({
              duration: Duration.seconds(120),
              onTimeout: () => new MiniMaxLanguageModelError({
                module: 'MiniMaxLanguageModel',
                method: 'streamText',
                description: 'MiniMax request timed out',
              }),
            }),
            Effect.catchAll((error) =>
              Effect.fail(new MiniMaxLanguageModelError({
                module: 'MiniMaxLanguageModel',
                method: 'streamText',
                description: 'HTTP request failed',
                cause: error,
              }))
            )
          );

          const textId = yield* idGenerator.generateId();

          type StreamState = {
            hasEmittedStart: boolean;
            pendingToolCalls: Map<number, { id: string; name: string; args: string }>;
          };
          const initialState: StreamState = {
            hasEmittedStart: false,
            pendingToolCalls: new Map(),
          };

          return parseSSEStream(response.stream).pipe(
            Stream.mapAccum(initialState, (state, chunk: ChatCompletionStreamChunk) => {
              const parts: Response.StreamPartEncoded[] = [];
              const nextState = {
                ...state,
                pendingToolCalls: new Map(state.pendingToolCalls),
              };

              if (!chunk?.choices?.length) {
                return [nextState, parts] as const;
              }

              const choice = chunk.choices[0];
              if (!choice?.delta) {
                return [nextState, parts] as const;
              }

              // Handle text content
              const content = choice.delta.content;
              if (content && content.length > 0) {
                if (!nextState.hasEmittedStart) {
                  parts.push({ type: 'text-start', id: textId });
                  nextState.hasEmittedStart = true;
                }
                parts.push({ type: 'text-delta', id: textId, delta: content });
              }

              // Handle tool calls (streamed incrementally)
              const toolCalls = choice.delta.tool_calls ?? [];
              for (const toolCall of toolCalls) {
                const idx = toolCall.index;
                const existing = nextState.pendingToolCalls.get(idx);

                if (toolCall.id || toolCall.function?.name) {
                  nextState.pendingToolCalls.set(idx, {
                    id: toolCall.id ?? existing?.id ?? `call_${idx}`,
                    name: toolCall.function?.name ?? existing?.name ?? '',
                    args: toolCall.function?.arguments ?? '',
                  });
                } else if (existing && toolCall.function?.arguments) {
                  existing.args += toolCall.function.arguments;
                }
              }

              // Handle finish
              if (choice.finish_reason) {
                if (nextState.hasEmittedStart) {
                  parts.push({ type: 'text-end', id: textId });
                }

                for (const [, tc] of nextState.pendingToolCalls) {
                  if (tc.id && tc.name) {
                    let parsedArgs = {};
                    try {
                      parsedArgs = tc.args ? JSON.parse(tc.args) : {};
                    } catch {
                      // Keep empty args on parse failure
                    }
                    parts.push({
                      type: 'tool-call',
                      id: tc.id,
                      name: tc.name,
                      params: parsedArgs,
                      providerExecuted: false,
                    });
                  }
                }

                parts.push({
                  type: 'finish',
                  reason: mapFinishReason(choice.finish_reason),
                  usage: mapUsage(chunk.usage),
                });
              }

              return [nextState, parts] as const;
            }),
            Stream.flatMap(
              (parts: readonly Response.StreamPartEncoded[]) => Stream.fromIterable(parts)
            ),
            Stream.catchAll((error) =>
              Stream.fail(new MiniMaxLanguageModelError({
                module: 'MiniMaxLanguageModel',
                method: 'streamText',
                description: 'Stream processing error',
                cause: error,
              }))
            )
          );
        }))) as any,
      });
    })
  ));
}

// ─── Message Conversion ──────────────────────────────────────────────────────

/**
 * MiniMax message format with optional tool calls.
 */
interface MiniMaxMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

/**
 * Convert @effect/ai Prompt to MiniMax Chat Completions messages format.
 *
 * The shared normalization layer keeps provider prompt handling aligned
 * with the rest of the repo before MiniMax-specific shaping happens.
 */
function convertPromptToMessages(prompt: Prompt.Prompt): MiniMaxMessage[] {
  const messages: MiniMaxMessage[] = [];
  const normalizedMessages = normalizeMessages([...prompt.content]);

  for (const message of normalizedMessages) {
    if (message.role === 'system' || message.role === 'user') {
      messages.push({
        role: message.role,
        content: flattenMessageContent(message.content),
      });
      continue;
    }

    if (message.role === 'assistant') {
      const toolCalls: MiniMaxMessage['tool_calls'] = [];
      const content = typeof message.content === 'string'
        ? message.content
        : Array.isArray(message.content)
          ? message.content
              .filter((part) => part.type === 'text')
              .map((part) => part.text)
              .join('')
          : '';

      if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (part.type === 'tool-call') {
            toolCalls.push({
              id: part.id,
              type: 'function',
              function: {
                name: part.name,
                arguments: JSON.stringify(part.params),
              },
            });
          }
        }
      }

      messages.push({
        role: 'assistant',
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      });
      continue;
    }

    if (message.role === 'tool') {
      const toolResults = Array.isArray(message.content) ? message.content : [];
      for (const part of toolResults) {
        if (part.type === 'tool-result') {
          messages.push({
            role: 'tool',
            content: typeof part.result === 'string' ? part.result : JSON.stringify(part.result),
            tool_call_id: part.id,
          });
        }
      }
    }
  }

  return messages;
}

function flattenMessageContent(content: Prompt.MessageEncoded['content']): string {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

// ─── Tool Conversion ──────────────────────────────────────────────────────────

/**
 * Convert @effect/ai tools to MiniMax function call format.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function convertToolsToFunctions(tools: ReadonlyArray<Tool.Any> | undefined): Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }> | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: Tool.getDescription(tool as any) ?? '',
      parameters: Tool.getJsonSchema(tool as any),
    },
  }));
}

function resolveToolChoice(
  toolChoice: LanguageModel.ToolChoice<any>,
  tools: Array<{ type: 'function'; function: { name: string } }> | undefined
): string | { type: 'function'; function: { name: string } } | undefined {
  if (!tools || tools.length === 0) {
    return undefined;
  }
  if (toolChoice === 'auto' || toolChoice === 'none' || toolChoice === 'required') {
    return toolChoice;
  }
  if (typeof toolChoice === 'object' && 'tool' in toolChoice) {
    return { type: 'function', function: { name: toolChoice.tool } };
  }
  if (typeof toolChoice === 'object' && 'oneOf' in toolChoice) {
    if (toolChoice.mode === 'required' && toolChoice.oneOf.length > 0) {
      return { type: 'function', function: { name: toolChoice.oneOf[0] } };
    }
    return 'auto';
  }
  return undefined;
}

function resolveResponseFormat(responseFormat: LanguageModel.ProviderOptions['responseFormat']): { type: 'json_object' } | undefined {
  if (responseFormat.type === 'json') {
    return { type: 'json_object' };
  }
  return undefined;
}

// ─── Response Mapping ──────────────────────────────────────────────────────────

function mapFinishReason(reason: string | null): typeof Response.FinishReason.Encoded {
  if (!reason) {
    return 'unknown';
  }
  switch (reason) {
    case 'tool_calls':
      return 'tool-calls';
    case 'content_filter':
      return 'content-filter';
    case 'length':
    case 'stop':
    case 'pause':
    case 'error':
    case 'other':
      return reason;
    default:
      return 'other';
  }
}

function mapUsage(usage: ChatCompletionResponse['usage'] | ChatCompletionStreamChunk['usage'] | undefined): typeof Response.Usage.Encoded {
  return {
    inputTokens: usage?.prompt_tokens,
    outputTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
  };
}

// ─── SSE Parsing ──────────────────────────────────────────────────────────────

/**
 * Parse SSE (Server-Sent Events) stream from Effect HttpClient response stream.
 * Transforms a Stream<Uint8Array> into a Stream of parsed ChatCompletionStreamChunk objects.
 */
function parseSSEStream<E>(
  bodyStream: Stream.Stream<Uint8Array, E>
): Stream.Stream<ChatCompletionStreamChunk, E | MiniMaxLanguageModelError> {
  const decoder = new TextDecoder();

  return bodyStream.pipe(
    Stream.mapAccum('', (buffer, chunk: Uint8Array) => {
      const text = buffer + decoder.decode(chunk, { stream: true });
      const lines = text.split('\n');
      const remaining = lines.pop() ?? '';
      return [remaining, lines] as const;
    }),
    Stream.flatMap((lines: readonly string[]) => Stream.fromIterable(lines)),
    Stream.filterMap((line: string) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed === 'data: [DONE]') {
        return Option.none();
      }
      if (trimmed.startsWith('data: ')) {
        const jsonStr = trimmed.slice(6);
        try {
          const parsed = JSON.parse(jsonStr) as ChatCompletionStreamChunk;
          return Option.some(parsed);
        } catch {
          return Option.none();
        }
      }
      return Option.none();
    })
  );
}

function parseToolCallArguments(
  raw: string
): Effect.Effect<unknown, MiniMaxLanguageModelError> {
  if (raw.length === 0) {
    return Effect.succeed({});
  }
  return Effect.try({
    try: () => JSON.parse(raw),
    catch: (cause) => new MiniMaxLanguageModelError({
      module: 'MiniMaxLanguageModel',
      method: 'parseToolCallArguments',
      description: 'Failed to parse tool call arguments',
      cause,
    }),
  });
}

// ─── Provider Factory ────────────────────────────────────────────────────────

/**
 * MiniMax provider pack factory.
 *
 * Implements the EffectProviderFactory interface for use as both
 * built-in and external pack pattern. Language capability uses
 * MiniMax's OpenAI-compatible Chat Completions API.
 */
export const MiniMaxProviderFactory: import('@fancyrobot/fred').EffectProviderFactory = {
  id: 'minimax',
  aliases: ['minimax'],
  connectionCapabilities: {
    providerId: 'minimax',
    auth: ['api-key'],
    login: ['manual-secret'],
  },
  load: async (config: ProviderConfig) => {
    const apiKey = config.credentials?.kind === 'api-key'
      ? config.credentials.apiKey
      : (() => {
          const envVar = config.apiKeyEnvVar ?? MINIMAX_API_KEY_ENV_VAR;
          const value = process.env[envVar];
          return value === undefined || value.trim().length === 0 ? undefined : Redacted.make(value);
        })();
    if (apiKey === undefined) {
      throw new MiniMaxMissingApiKeyError({
        provider: 'minimax',
        envVar: config.apiKeyEnvVar ?? MINIMAX_API_KEY_ENV_VAR,
      });
    }
    const baseUrl = config.baseUrl ?? MINIMAX_DEFAULT_BASE_URL;

    // Create HTTP client layer
    const layer = FetchHttpClient.layer;

    return {
      layer,
      getModel: (modelId: string, overrides?: ProviderModelDefaults) => {
        return Effect.succeed(
          createMiniMaxLanguageModel(apiKey, baseUrl, modelId, overrides)
        );
      },
    };
  },
};

// Default export for compatibility
export default MiniMaxProviderFactory;
