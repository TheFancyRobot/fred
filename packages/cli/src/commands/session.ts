/**
 * Session command handlers
 *
 * Exposes list/show/export/rm session operations via CLI.
 */

import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { createInterface } from 'node:readline/promises';
import { createFred } from '@fancyrobot/fred';
import type { FredClient, SessionDetails, SessionSummary } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { sanitizeErrorForCli } from './error-sanitize.js';
import {
  ConfigInitError,
  InvalidArgumentError,
  SessionNotFoundError,
  SessionOperationError,
  UnknownSubcommandError,
} from './errors.js';

export interface SessionCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface SessionCommandDependencies {
  fred?: FredClient;
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

/**
 * Initialize Fred instance with config, wrapped in Effect.
 */
const initializeFredEffect = (io: SessionCommandIO): Effect.Effect<FredClient, ConfigInitError> =>
  Effect.gen(function* () {
    const configResult = resolveProjectConfig();
    const fred = yield* Effect.tryPromise({
        try: () => createFred({ configPath: configResult.success ? configResult.configPath : undefined }),
        catch: (error) =>
          new ConfigInitError({ message: `Failed to initialize from config: ${sanitizeErrorForCli(error)}` }),
      }).pipe(
        Effect.catchTag('ConfigInitError', (error) =>
          Effect.zipRight(
            Effect.sync(() => io.stderr(error.message)),
            Effect.tryPromise({
              try: () => createFred(),
              catch: (cause) => new ConfigInitError({ message: sanitizeErrorForCli(cause) }),
            }),
          ),
        ),
      );
    return fred;
  });

const exportSession = (
  session: SessionDetails,
  format: SessionExportFormat,
): string | Record<string, unknown> => {
  if (format === 'markdown') {
    return session.messages
      .map((message) => `## ${message.role}\n\n${typeof message.content === 'string' ? message.content : JSON.stringify(message.content)}`)
      .join('\n\n');
  }
  return {
    id: session.summary.id,
    metadata: session.metadata,
    messages: session.messages,
  };
};

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

const parseFormat = (raw: unknown): Effect.Effect<SessionExportFormat, InvalidArgumentError> => {
  if (raw === undefined) return Effect.succeed(DEFAULT_FORMAT);
  if (raw === 'json' || raw === 'markdown') return Effect.succeed(raw);
  return Effect.fail(
    new InvalidArgumentError({ message: 'Invalid --format value. Expected "json" or "markdown".' }),
  );
};

const getSessionDetailsOrFail = (
  session: SessionDetails | null,
  id: string,
): Effect.Effect<SessionDetails, SessionNotFoundError> => {
  if (!session) {
    return Effect.fail(new SessionNotFoundError({ sessionId: id, message: `Session not found: ${id}` }));
  }
  return Effect.succeed(session);
};

/**
 * Internal Effect program for the session command.
 */
const sessionCommandEffect = (
  args: string[],
  options: Record<string, unknown>,
  dependencies: SessionCommandDependencies,
): Effect.Effect<
  number,
  InvalidArgumentError | SessionNotFoundError | SessionOperationError | UnknownSubcommandError
> =>
  Effect.gen(function* () {
    const io = dependencies.io ?? DEFAULT_IO;

    const fred = dependencies.fred
      ? dependencies.fred
      : yield* initializeFredEffect(io).pipe(
          Effect.mapError((error) =>
            new SessionOperationError({ message: error.message }),
          ),
        );

    const subcommand = args[0];
    if (!subcommand) {
      return yield* Effect.fail(
        new InvalidArgumentError({ message: 'Missing session subcommand.' }),
      );
    }

      switch (subcommand) {
      case 'list': {
        const sessions = yield* Effect.tryPromise({
          try: () => fred.sessions.list(),
          catch: (error) =>
            new SessionOperationError({ message: sanitizeErrorForCli(error) }),
        });

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
          return yield* Effect.fail(
            new InvalidArgumentError({ message: 'Missing session id.' }),
          );
        }

        const rawDetails = yield* Effect.tryPromise({
          try: () => fred.sessions.get(id),
          catch: (error) =>
            new SessionOperationError({ message: sanitizeErrorForCli(error) }),
        });
        const details = yield* getSessionDetailsOrFail(rawDetails, id);

        const exportResult = exportSession(details, 'markdown');

        io.stdout(toExportContent(exportResult));
        return 0;
      }

      case 'export': {
        const id = args[1];
        if (!id) {
          return yield* Effect.fail(
            new InvalidArgumentError({ message: 'Missing session id.' }),
          );
        }

        const format = yield* parseFormat(options.format ?? (options.json === true ? 'json' : undefined));

        const rawSession = yield* Effect.tryPromise({
          try: () => fred.sessions.get(id),
          catch: (error) =>
            new SessionOperationError({ message: sanitizeErrorForCli(error) }),
        });
        const session = yield* getSessionDetailsOrFail(rawSession, id);

        const exportResult = exportSession(session, format);

        const now = (dependencies.now ?? (() => new Date()))();
        const output = typeof options.output === 'string'
          ? options.output
          : buildDefaultExportFilename(session.summary, format, now);
        const outputPath = resolve(process.cwd(), output);

        const payload = typeof exportResult === 'string'
          ? exportResult
          : JSON.stringify(exportResult, null, 2);
        const writeFileFn = dependencies.writeFile ?? writeFile;

        yield* Effect.tryPromise({
          try: () => writeFileFn(outputPath, payload, 'utf-8'),
          catch: (error) =>
            new SessionOperationError({ message: `Failed to write file: ${sanitizeErrorForCli(error)}` }),
        });

        io.stdout(`Exported session ${id} to ${outputPath}`);
        return 0;
      }

      case 'rm': {
        const ids = args.slice(1).filter((id) => id.trim().length > 0);
        if (ids.length === 0) {
          return yield* Effect.fail(
            new InvalidArgumentError({ message: 'Missing session id.' }),
          );
        }

        // Check all sessions exist
        const missing: string[] = [];
        for (const id of ids) {
          const session = yield* Effect.tryPromise({
            try: () => fred.sessions.get(id),
            catch: (error) =>
              new SessionOperationError({ message: sanitizeErrorForCli(error) }),
          });
          if (!session) missing.push(id);
        }

        if (missing.length > 0) {
          return yield* Effect.fail(
            new SessionNotFoundError({
              sessionId: missing.join(', '),
              message: `Session not found: ${missing.join(', ')}`,
            }),
          );
        }

        const prompt = `Delete ${ids.length === 1 ? 'session' : 'sessions'} ${ids.join(', ')}? (y/N): `;
        const confirmed = yield* Effect.tryPromise({
          try: () =>
            dependencies.confirm
              ? dependencies.confirm(prompt)
              : promptForConfirmation(prompt),
          catch: (error) =>
            new SessionOperationError({ message: sanitizeErrorForCli(error) }),
        });

        if (!confirmed) {
          io.stdout('Aborted.');
          return 0;
        }

        for (const id of ids) {
          yield* Effect.tryPromise({
            try: () => fred.sessions.delete(id),
            catch: (error) =>
              new SessionOperationError({ message: sanitizeErrorForCli(error) }),
          });
        }

        io.stdout(`Deleted ${ids.length} session${ids.length === 1 ? '' : 's'}.`);
        return 0;
      }

      default:
        return yield* Effect.fail(
          new UnknownSubcommandError({
            subcommand,
            available: 'list, show, export, rm',
            message: `Unknown session subcommand: ${subcommand}.`,
          }),
        );
    }
  });

export async function handleSessionCommand(
  args: string[],
  options: Record<string, unknown>,
  dependencies: SessionCommandDependencies = {}
): Promise<number> {
  const io = dependencies.io ?? DEFAULT_IO;

  return Effect.runPromise(
    sessionCommandEffect(args, options, dependencies).pipe(
      Effect.catchTags({
        InvalidArgumentError: (error) =>
          Effect.sync(() => {
            io.stderr(error.message);
            return 1;
          }),
        SessionNotFoundError: (error) =>
          Effect.sync(() => {
            io.stderr(error.message);
            return 1;
          }),
        SessionOperationError: (error) =>
          Effect.sync(() => {
            io.stderr(error.message);
            return 1;
          }),
        UnknownSubcommandError: (error) =>
          Effect.sync(() => {
            io.stderr(error.message);
            return 1;
          }),
      }),
    ),
  );
}
