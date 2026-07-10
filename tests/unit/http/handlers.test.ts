import { describe, expect, test } from 'bun:test';
import {
  FredAdminHandlersLive,
  FredHttpHandlersLive,
  FredMessageHandlersLive,
  FredOpenAiHandlersLive,
  lastUserMessage,
} from '../../../packages/fred-http/src/handlers/index';

describe('Effect-native HTTP handlers', () => {
  test('exports independently composable group layers and the aggregate layer', () => {
    expect(FredAdminHandlersLive).toBeDefined();
    expect(FredMessageHandlersLive).toBeDefined();
    expect(FredOpenAiHandlersLive).toBeDefined();
    expect(FredHttpHandlersLive).toBeDefined();
  });

  test('selects the latest user message for OpenAI streaming', () => {
    expect(lastUserMessage([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'reply' },
      { role: 'user', content: 'latest' },
    ])).toBe('latest');
  });
});
