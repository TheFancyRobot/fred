import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import chatResponseFixture from './fixtures/legacy-chat-response.json';
import messageRequestFixture from './fixtures/legacy-message-request.json';
import messageResponseFixture from './fixtures/legacy-message-response.json';
import {
  ChatCompletionRequest,
  ChatCompletionResponse,
  InvalidRequestError,
  MessageRequest,
  MessageResponse,
  SessionHeaders,
  SimpleChatRequest,
} from '../../../packages/fred-http/src/api';

const decode = <A, I>(schema: Schema.Schema<A, I>) => Schema.decodeUnknownSync(schema);

describe('Fred HttpApi contracts', () => {
  it('decodes supported request and response fixtures', () => {
    expect(decode(ChatCompletionRequest)({
      messages: [{ role: 'user', content: 'hello' }],
    }).messages[0]?.content).toBe('hello');
    expect(decode(ChatCompletionResponse)(chatResponseFixture).object)
      .toBe('chat.completion');
    expect(decode(MessageRequest)(messageRequestFixture).message)
      .toBe('Route this message');
    expect(decode(MessageResponse)(messageResponseFixture).success).toBe(true);
  });

  it('keeps request bounds executable', () => {
    expect(() => decode(ChatCompletionRequest)({ messages: [] })).toThrow();
    expect(() => decode(ChatCompletionRequest)({
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 2.1,
    })).toThrow();
    expect(() => decode(ChatCompletionRequest)({
      messages: [{ role: 'user', content: 'hello' }],
      max_tokens: 0,
    })).toThrow();
    expect(() => decode(MessageRequest)({ message: '' })).toThrow();
    expect(() => decode(MessageRequest)({ message: 'x'.repeat(1_000_001) })).toThrow();
  });

  it('requires simple message arrays to end in a user message', () => {
    expect(() => decode(SimpleChatRequest)({
      messages: [{ role: 'assistant', content: 'done' }],
    })).toThrow();
    expect(decode(SimpleChatRequest)({ message: 'hello' }).message).toBe('hello');
  });

  it('accepts printable session ids and rejects control characters', () => {
    expect(decode(SessionHeaders)({ 'x-session-id': 'session-123' }))
      .toEqual({ 'x-session-id': 'session-123' });
    expect(() => decode(SessionHeaders)({ 'x-session-id': 'session\nspoofed' })).toThrow();
    expect(() => decode(SessionHeaders)({ 'x-session-id': 'session\u007f' })).toThrow();
  });

  it('models domain failures as tagged serializable errors', () => {
    const error = new InvalidRequestError({ message: 'Invalid request', issues: ['messages'] });
    expect(error._tag).toBe('InvalidRequestError');
    expect(Schema.encodeSync(InvalidRequestError)(error)).toEqual({
      _tag: 'InvalidRequestError',
      message: 'Invalid request',
      issues: ['messages'],
    });
  });
});
