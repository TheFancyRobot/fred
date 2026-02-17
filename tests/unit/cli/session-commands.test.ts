import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Fred } from '../../../packages/core/src';
import { ContextManager } from '../../../packages/core/src/context/manager';
import type { SessionDetails } from '../../../packages/core/src/context/context';
import { handleSessionCommand } from '../../../packages/cli/src/commands/session';

class InMemoryContextStorage {
  private sessions: Map<string, SessionDetails> = new Map();

  seed(details: SessionDetails): void {
    this.sessions.set(details.summary.id, details);
  }

  async get(id: string): Promise<SessionDetails | null> {
    return this.sessions.get(id) ?? null;
  }

  async listSessions(): Promise<SessionDetails['summary'][]> {
    return Array.from(this.sessions.values()).map((session) => session.summary);
  }

  async delete(id: string): Promise<void> {
    this.sessions.delete(id);
  }
}

function createFred(storage: InMemoryContextStorage): Fred {
  const fred = new Fred();
  const manager = new ContextManager();

  (manager as any).listSessions = () => storage.listSessions();
  (manager as any).getSession = (id: string) => storage.get(id);
  (manager as any).exportSession = async (id: string, format: 'json' | 'markdown') => {
    const session = await storage.get(id);
    if (!session) return null;
    if (format === 'markdown') {
      return `# Session: ${session.summary.title ?? 'Untitled'}\n\n## Transcript\n\n${session.messages
        .map((message) => `${message.role}: ${String(message.content)}`)
        .join('\n')}`;
    }
    return {
      id: session.summary.id,
      metadata: {
        createdAt: session.summary.createdAt.toISOString(),
        updatedAt: session.summary.updatedAt.toISOString(),
      },
      messages: session.messages.map((message) => ({ role: message.role, content: message.content })),
    };
  };
  (manager as any).deleteSession = (id: string) => storage.delete(id);

  (fred as any).getContextManager = () => manager;
  return fred;
}

function createSessionDetails(id: string, title: string, date: Date): SessionDetails {
  return {
    summary: {
      id,
      title,
      preview: 'hello world',
      createdAt: date,
      updatedAt: date,
      messageCount: 2,
    },
    metadata: {
      createdAt: date,
      updatedAt: date,
    },
    messages: [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ],
  };
}

describe('session commands', () => {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io = {
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };

  beforeEach(() => {
    stdout.length = 0;
    stderr.length = 0;
  });

  afterEach(() => {
    stdout.length = 0;
    stderr.length = 0;
  });

  test('list outputs table by default', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_1', 'Alpha', date));

    const exitCode = await handleSessionCommand(['list'], {}, { io, fred: createFred(storage) });

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain('ID');
    expect(stdout[0]).toContain('Title');
    expect(stdout[0]).toContain('conv_1');
  });

  test('list supports json output', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_2', 'Beta', date));

    const exitCode = await handleSessionCommand(['list'], { json: true }, { io, fred: createFred(storage) });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout[0] ?? '{}');
    expect(payload.command).toBe('list');
    expect(payload.data[0].id).toBe('conv_2');
  });

  test('show prints markdown transcript', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_show', 'Showcase', date));

    const exitCode = await handleSessionCommand(['show', 'conv_show'], {}, { io, fred: createFred(storage) });

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain('Session: Showcase');
    expect(stdout[0]).toContain('Transcript');
  });

  test('export writes file with default name', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_export', 'Export Session', date));

    const writeFileMock = mock(async () => Promise.resolve());

    const exitCode = await handleSessionCommand(
      ['export', 'conv_export'],
      { format: 'json' },
      {
        io,
        fred: createFred(storage),
        now: () => new Date('2026-02-08T00:00:00Z'),
        writeFile: writeFileMock,
      }
    );

    expect(exitCode).toBe(0);
    expect(writeFileMock).toHaveBeenCalled();
  });

  test('rm requires confirmation', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_rm', 'Remove Me', date));

    const confirm = mock(async () => false);
    const exitCode = await handleSessionCommand(['rm', 'conv_rm'], {}, { io, fred: createFred(storage), confirm });

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain('Aborted');
  });
});
