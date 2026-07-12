import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { FredClient } from '../../../packages/core/src';
import type { SessionDetails } from '../../../packages/core/src/context/context';
import { handleSessionCommand } from '../../../packages/cli/src/commands/session';
import {
  createMockContextManager,
  createMockFredClient,
  shutdownMockFredClients,
} from './fixtures/fred-smoke-contract';

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

const createFred = (storage: InMemoryContextStorage): Promise<FredClient> =>
  createMockFredClient({
    contextManager: createMockContextManager({
      listSessions: () => storage.listSessions(),
      getSession: (id) => storage.get(id),
      deleteSession: (id) => storage.delete(id),
    }),
  });

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

  afterEach(async () => {
    stdout.length = 0;
    stderr.length = 0;
    await shutdownMockFredClients();
  });

  test('list outputs table by default', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_1', 'Alpha', date));

    const exitCode = await handleSessionCommand(['list'], {}, { io, fred: await createFred(storage) });

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain('ID');
    expect(stdout[0]).toContain('Title');
    expect(stdout[0]).toContain('conv_1');
  });

  test('list supports json output', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_2', 'Beta', date));

    const exitCode = await handleSessionCommand(['list'], { json: true }, { io, fred: await createFred(storage) });

    expect(exitCode).toBe(0);
    const payload = JSON.parse(stdout[0] ?? '{}');
    expect(payload.command).toBe('list');
    expect(payload.data[0].id).toBe('conv_2');
  });

  test('show prints markdown transcript', async () => {
    const storage = new InMemoryContextStorage();
    const date = new Date('2026-02-08T18:00:00Z');
    storage.seed(createSessionDetails('conv_show', 'Showcase', date));

    const exitCode = await handleSessionCommand(['show', 'conv_show'], {}, { io, fred: await createFred(storage) });

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain('## user');
    expect(stdout[0]).toContain('hi');
    expect(stdout[0]).toContain('## assistant');
    expect(stdout[0]).toContain('hello');
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
        fred: await createFred(storage),
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
    const exitCode = await handleSessionCommand(['rm', 'conv_rm'], {}, { io, fred: await createFred(storage), confirm });

    expect(exitCode).toBe(0);
    expect(stdout[0]).toContain('Aborted');
  });
});
