import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import type { Prompt } from '@effect/ai';
import { ContextManager } from '../../../../packages/core/src/context/manager';
import { SqliteContextStorage } from '../../../../packages/core/src/context/storage/sqlite';
import type { ConversationContext } from '../../../../packages/core/src/context/context';
import {
  deriveSessionTitle,
  deriveSessionPreview,
  exportSessionToJson,
  exportSessionToMarkdown,
} from '../../../../packages/core/src/context/session';

const createMessage = (role: Prompt.MessageEncoded['role'], content: Prompt.MessageEncoded['content']) => ({
  role,
  content,
} as Prompt.MessageEncoded);

describe('session helpers', () => {
  test('deriveSessionTitle uses metadata title when present', () => {
    const metadata = {
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:05:00Z'),
      title: 'Billing follow-up',
    };

    const title = deriveSessionTitle(metadata as any, [
      createMessage('user', 'Hello there'),
    ]);

    expect(title).toBe('Billing follow-up');
  });

  test('deriveSessionTitle falls back to first user message', () => {
    const metadata = {
      createdAt: new Date('2024-01-01T10:00:00Z'),
      updatedAt: new Date('2024-01-01T10:05:00Z'),
    };

    const title = deriveSessionTitle(metadata as any, [
      createMessage('system', 'System prompt'),
      createMessage('user', 'Let us talk about deployments.'),
      createMessage('assistant', 'Sure.'),
    ]);

    expect(title).toBe('Let us talk about deployments.');
  });

  test('deriveSessionPreview uses latest user/assistant message without role prefix', () => {
    const preview = deriveSessionPreview([
      createMessage('user', 'First message'),
      createMessage('assistant', 'Intermediate response'),
      createMessage('user', 'Latest user note'),
    ]);

    expect(preview).toBe('Latest user note');
  });

  test('exportSessionToJson preserves metadata and tool parts', () => {
    const context: ConversationContext = {
      id: 'session-1',
      metadata: {
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:05:00Z'),
        title: 'Tool session',
        agentId: 'agent-1',
      },
      messages: [
        createMessage('assistant', [
          { type: 'text', text: 'Let me check.' },
          {
            type: 'tool-call',
            id: 'call-1',
            name: 'weather',
            params: { city: 'Oslo' },
            providerExecuted: false,
          },
        ]),
        createMessage('tool', [
          {
            type: 'tool-result',
            id: 'call-1',
            name: 'weather',
            result: { temp: 4 },
            isFailure: false,
            providerExecuted: false,
          },
        ]),
      ],
    };

    const exported = exportSessionToJson(context);

    expect(exported.metadata.createdAt).toBe('2024-01-01T10:00:00.000Z');
    expect(exported.metadata.updatedAt).toBe('2024-01-01T10:05:00.000Z');
    expect(exported.metadata.title).toBe('Tool session');

    const firstMessage = exported.messages[0] as any;
    expect(firstMessage.content[1].type).toBe('tool-call');
    expect(firstMessage.content[1].name).toBe('weather');

    const toolMessage = exported.messages[1] as any;
    expect(toolMessage.content[0].type).toBe('tool-result');
    expect(toolMessage.content[0].result).toEqual({ temp: 4 });
  });

  test('exportSessionToMarkdown formats tool call and result sections', () => {
    const context: ConversationContext = {
      id: 'session-2',
      metadata: {
        createdAt: new Date('2024-01-01T10:00:00Z'),
        updatedAt: new Date('2024-01-01T10:05:00Z'),
        title: 'Markdown export',
      },
      messages: [
        createMessage('assistant', [
          { type: 'text', text: 'Checking now.' },
          {
            type: 'tool-call',
            id: 'call-1',
            name: 'weather',
            params: { city: 'Oslo' },
            providerExecuted: false,
          },
        ]),
        createMessage('tool', [
          {
            type: 'tool-result',
            id: 'call-1',
            name: 'weather',
            result: { temp: 4 },
            isFailure: false,
            providerExecuted: false,
          },
        ]),
      ],
    };

    const markdown = exportSessionToMarkdown(context);

    expect(markdown).toContain('# Session: Markdown export');
    expect(markdown).toContain('Tool Call: weather');
    expect(markdown).toContain('Tool Result: weather');
    expect(markdown).toContain('"temp": 4');
  });
});

describe('ContextManager session APIs', () => {
  let storage: SqliteContextStorage;
  let manager: ContextManager;

  beforeEach(() => {
    storage = new SqliteContextStorage({ path: ':memory:' });
    manager = new ContextManager(storage);
  });

  afterEach(() => {
    storage.close();
  });

  test('deleteSession removes messages and metadata', async () => {
    await manager.addMessage('conv-1', { role: 'user', content: 'Hello' });

    const sessionsBefore = await manager.listSessions();
    expect(sessionsBefore).toHaveLength(1);

    await manager.deleteSession('conv-1');

    const sessionAfter = await manager.getSession('conv-1');
    expect(sessionAfter).toBeNull();

    const sessionsAfter = await manager.listSessions();
    expect(sessionsAfter).toHaveLength(0);
  });
});
