import { Fred, toOpenAIStream } from '@fancyrobot/fred';
import type { StreamEvent } from '@fancyrobot/fred';
import type { ChatCompletionRequest, ChatCompletionResponse, ChatCompletionChunk } from './chat';
import { Stream } from 'effect';
import type { Prompt } from '@effect/ai';

interface ChatContextService {
  generateConversationId(): string;
  addMessage(conversationId: string, message: Prompt.MessageEncoded): Promise<void>;
}

export class ChatHandlers {
  private fred: Fred;
  private contextManager: ChatContextService;

  constructor(fred: Fred, contextManager: ChatContextService) {
    this.fred = fred;
    this.contextManager = contextManager;
  }

  async handleChatCompletion(
    request: ChatCompletionRequest
  ): Promise<ChatCompletionResponse> {
    const conversationId = request.conversation_id || this.contextManager.generateConversationId();

    const modelMessages = request.messages.map((msg) => ({
      role: msg.role as Prompt.MessageEncoded['role'],
      content: msg.content || '',
    })) as Prompt.MessageEncoded[];

    const lastUserMessage = modelMessages[modelMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage.content);

    const response = await this.fred.processMessage(userMessageText, {
      conversationId,
    });

    if (!response) {
      throw new Error('No response from agent');
    }

    await this.contextManager.addMessage(conversationId, lastUserMessage);

    const assistantMessage: Prompt.MessageEncoded = {
      role: 'assistant',
      content: response.content,
    };
    await this.contextManager.addMessage(conversationId, assistantMessage);

    return {
      id: `chatcmpl-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'fred-agent',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: response.content,
          },
          finish_reason: 'stop',
        },
      ],
    };
  }

  async *handleStreamingChat(
    request: ChatCompletionRequest
  ): AsyncGenerator<ChatCompletionChunk, void, unknown> {
    const conversationId = request.conversation_id || this.contextManager.generateConversationId();

    const modelMessages = request.messages.map((msg) => ({
      role: msg.role as Prompt.MessageEncoded['role'],
      content: msg.content || '',
    })) as Prompt.MessageEncoded[];

    const lastUserMessage = modelMessages[modelMessages.length - 1];
    if (!lastUserMessage || lastUserMessage.role !== 'user') {
      throw new Error('Last message must be from user');
    }

    const userMessageText = typeof lastUserMessage.content === 'string'
      ? lastUserMessage.content
      : JSON.stringify(lastUserMessage.content);

    const stream = Stream.fromAsyncIterable(
      this.fred.streamMessage(userMessageText, {
        conversationId,
      }),
      (error) => error as Error
    );

    const openAIStream = toOpenAIStream(stream as Stream.Stream<StreamEvent>, {
      model: request.model ?? 'fred-agent',
    });

    let finalResponse: { content?: string } = {};

    for await (const chunk of Stream.toAsyncIterable(openAIStream)) {
      yield chunk as ChatCompletionChunk;
      if ((chunk as any).object === 'chat.completion') {
        const completion = chunk as any;
        finalResponse = {
          content: completion.choices?.[0]?.message?.content ?? '',
        };
      }
    }

    if (finalResponse.content) {
      const assistantMessage: Prompt.MessageEncoded = {
        role: 'assistant',
        content: finalResponse.content,
      };
      await this.contextManager.addMessage(conversationId, assistantMessage);
    }
  }
}
