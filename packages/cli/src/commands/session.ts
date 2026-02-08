/**
 * Session command handlers
 *
 * Exposes list/show/export/rm session operations via CLI.
 */

import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { createInterface } from 'node:readline/promises';
import { Fred } from '@fancyrobot/fred';
import type { SessionDetails, SessionSummary } from '@fancyrobot/fred';
import { resolveProjectConfig } from '../project/resolve-config.js';

export interface SessionCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface SessionCommandDependencies {
  fred?: Fred;
  io?: SessionCommandIO;
  confirm?: (message: string) => Promise<boolean>;
  now?: () => Date;
  writeFile?: (path: string, data: string, encoding: BufferEncoding) => Promise<void>;
}

type SessionExportFormat = 'json' | 'markdown';

const DEFAULT_FORMAT: SessionExportFormat = 'markdown';

const DEFAULT_IO: SessionCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

const formatDate = (date: Date): string => {
  const iso = date.toISOString();
  return iso.replace('T', ' ').slice(0, 16);
};

const slugify = (value: string): string => {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'session';
};

const buildDefaultExportFilename = (
  summary: SessionSummary,
  format: SessionExportFormat,
  now: Date
): string => {
  const title = summary.title ?? 'session';
  const datePart = now.toISOString().slice(0, 10);
  const extension = format === 'json' ? 'json' : 'md';
  return `${slugify(title)}-${datePart}.${extension}`;
};

const formatSessionsTable = (sessions: SessionSummary[]): string => {
  const rows = sessions.map((session) => ({
    id: session.id,
    title: session.title ?? 'Untitled',
    createdAt: formatDate(session.createdAt),
    updatedAt: formatDate(session.updatedAt),
  }));

  const headers = ['ID', 'Title', 'Created', 'Updated'];
  const widths = headers.map((header, index) => {
    const values = rows.map((row) => Object.values(row)[index] as string);
    return Math.max(header.length, ...values.map((value) => value.length));
  });

  const formatRow = (cells: string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');

  const headerLine = formatRow(headers);
  const divider = widths.map((width) => '-'.repeat(width)).join('  ');
  const body = rows.map((row) => formatRow(Object.values(row) as string[]));

  return [headerLine, divider, ...body].join('\n');
};

const toJsonListPayload = (sessions: SessionSummary[]) =>
  sessions.map((session) => ({
    id: session.id,
    title: session.title ?? null,
    preview: session.preview ?? null,
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    messageCount: session.messageCount,
    agent: session.agent ?? null,
  }));

const toExportContent = (exported: SessionDetails | string | Record<string, unknown>): string => {
  if (typeof exported === 'string') {
    return exported;
  }
  return JSON.stringify(exported, null, 2);
};

async function initializeFred(io: SessionCommandIO): Promise<Fred> {
  const fred = new Fred();
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.configPath) {
    try {
      await fred.initializeFromConfig(configResult.configPath);
    } catch (error) {
      io.stderr(`Failed to initialize from config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return fred;
}

async function promptForConfirmation(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(message);
    const normalized = answer.trim().toLowerCase();
    return normalized === 'y' || normalized === 'yes';
  } finally {
    rl.close();
  }
}

function parseFormat(raw: unknown): SessionExportFormat {
  if (raw === undefined) return DEFAULT_FORMAT;
  if (raw === 'json' || raw === 'markdown') return raw;
  throw new Error('Invalid --format value. Expected "json" or "markdown".');
}

function getSessionDetailsOrError(session: SessionDetails | null, id: string): SessionDetails {
  if (!session) {
    throw new Error(`Session not found: ${id}`);
  }
  return session;
}

export async function handleSessionCommand(
  args: string[],
  options: Record<string, unknown>,
  dependencies: SessionCommandDependencies = {}
): Promise<number> {
  const io = dependencies.io ?? DEFAULT_IO;
  const fred = dependencies.fred ?? await initializeFred(io);
  const contextManager = fred.getContextManager();

  const subcommand = args[0];
  if (!subcommand) {
    io.stderr('Missing session subcommand.');
    return 1;
  }

  try {
    switch (subcommand) {
      case 'list': {
        const sessions = await contextManager.listSessions();
        if (options.json === true) {
          io.stdout(JSON.stringify({ ok: true, command: 'list', data: toJsonListPayload(sessions) }, null, 2));
          return 0;
        }

        if (sessions.length === 0) {
          io.stdout('No sessions found.');
          return 0;
        }

        io.stdout(formatSessionsTable(sessions));
        return 0;
      }

      case 'show': {
        const id = args[1];
        if (!id) {
          io.stderr('Missing session id.');
          return 1;
        }

        const details = getSessionDetailsOrError(await contextManager.getSession(id), id);
        const exportResult = await contextManager.exportSession(id, 'markdown');
        if (!exportResult) {
          io.stderr(`Session not found: ${id}`);
          return 1;
        }

        io.stdout(typeof exportResult === 'string' ? exportResult : toExportContent(details));
        return 0;
      }

      case 'export': {
        const id = args[1];
        if (!id) {
          io.stderr('Missing session id.');
          return 1;
        }

        const format = parseFormat(options.format ?? (options.json === true ? 'json' : undefined));
        const session = getSessionDetailsOrError(await contextManager.getSession(id), id);
        const exportResult = await contextManager.exportSession(id, format);
        if (!exportResult) {
          io.stderr(`Session not found: ${id}`);
          return 1;
        }

        const now = (dependencies.now ?? (() => new Date()))();
        const output = typeof options.output === 'string'
          ? options.output
          : buildDefaultExportFilename(session.summary, format, now);
        const outputPath = resolve(process.cwd(), output);

        const payload = typeof exportResult === 'string'
          ? exportResult
          : JSON.stringify(exportResult, null, 2);
        const writeFileFn = dependencies.writeFile ?? writeFile;
        await writeFileFn(outputPath, payload, 'utf-8');

        io.stdout(`Exported session ${id} to ${outputPath}`);
        return 0;
      }

      case 'rm': {
        const ids = args.slice(1).filter((id) => id.trim().length > 0);
        if (ids.length === 0) {
          io.stderr('Missing session id.');
          return 1;
        }

        const missing: string[] = [];
        for (const id of ids) {
          const session = await contextManager.getSession(id);
          if (!session) missing.push(id);
        }

        if (missing.length > 0) {
          io.stderr(`Session not found: ${missing.join(', ')}`);
          return 1;
        }

        const prompt = `Delete ${ids.length === 1 ? 'session' : 'sessions'} ${ids.join(', ')}? (y/N): `;
        const confirmed = dependencies.confirm
          ? await dependencies.confirm(prompt)
          : await promptForConfirmation(prompt);

        if (!confirmed) {
          io.stdout('Aborted.');
          return 0;
        }

        for (const id of ids) {
          await contextManager.deleteSession(id);
        }

        io.stdout(`Deleted ${ids.length} session${ids.length === 1 ? '' : 's'}.`);
        return 0;
      }

      default:
        io.stderr(`Unknown session subcommand: ${subcommand}.`);
        return 1;
    }
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
