import { createInterface } from 'node:readline/promises';
import { Effect, Schema } from 'effect';
import type {
  LegacyPostgresStoreImportResult,
  LegacyStoreModule,
} from '@fancyrobot/fred-postgres';

const MODULES = ['context', 'checkpoints', 'http-api-keys', 'http-rate-limits'] as const;
const OPTIONS = new Set(['modules', 'schema', 'dry-run', 'yes', 'json', 'help']);
const SCHEMA_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const USAGE = 'Usage: fred postgres import-legacy [--modules <a,b>] [--schema <name>] [--dry-run] [--yes] [--json]';
const encodeJson = Schema.encodeSync(Schema.parseJson(Schema.Unknown));

export class PostgresCommandError extends Schema.TaggedError<PostgresCommandError>()(
  'PostgresCommandError',
  { code: Schema.Literal('usage', 'cancelled', 'preflight', 'verify', 'internal'), message: Schema.String },
) {}

export interface LegacyImportRequest {
  readonly schema?: string;
  readonly modules?: readonly LegacyStoreModule[];
  readonly dryRun?: boolean;
}

export interface PostgresCommandDependencies {
  readonly io?: { readonly stdout: (message: string) => void; readonly stderr: (message: string) => void };
  readonly importLegacy?: (request: LegacyImportRequest) => Promise<readonly LegacyPostgresStoreImportResult[]>;
  readonly confirm?: (message: string) => Promise<boolean>;
  readonly isTTY?: boolean;
  readonly defaultSchema?: string;
}

const DEFAULT_IO = {
  stdout: (message: string) => console.log(message),
  stderr: (message: string) => console.error(message),
};

const isLegacyStoreModule = (value: string): value is LegacyStoreModule =>
  MODULES.some((module) => module === value);

const commandError = (
  code: PostgresCommandError['code'],
  message: string,
) => new PostgresCommandError({ code, message });

const parseModules = (raw: unknown): Effect.Effect<readonly LegacyStoreModule[], PostgresCommandError> => {
  if (raw === undefined) return Effect.succeed(MODULES);
  if (typeof raw !== 'string') return Effect.fail(commandError('usage', '--modules requires a comma-separated value.'));
  const modules = [...new Set(raw.split(',').map((value) => value.trim()).filter(Boolean))];
  if (modules.length === 0 || modules.some((module) => !isLegacyStoreModule(module))) {
    return Effect.fail(commandError('usage', `--modules must contain only: ${MODULES.join(', ')}.`));
  }
  return Effect.succeed(modules.filter(isLegacyStoreModule));
};

const parseSchema = (raw: unknown, fallback: string | undefined): Effect.Effect<string | undefined, PostgresCommandError> => {
  const schema = raw ?? fallback;
  if (schema === undefined) return Effect.as(Effect.void, undefined);
  if (typeof schema !== 'string' || !SCHEMA_PATTERN.test(schema)) {
    return Effect.fail(commandError('usage', '--schema must be a valid PostgreSQL identifier.'));
  }
  return Effect.succeed(schema);
};

const safeImportError = (error: unknown): PostgresCommandError => {
  if (typeof error === 'object' && error !== null && '_tag' in error) {
    if (error._tag === 'LegacyPostgresImportError' && 'operation' in error) {
      return error.operation === 'verify'
        ? commandError('verify', 'Legacy import verification failed.')
        : commandError('preflight', 'Legacy import preflight failed.');
    }
  }
  return commandError('internal', 'Legacy import failed.');
};

const formatRows = (heading: string, rows: readonly LegacyPostgresStoreImportResult[]): string => [
  heading,
  ...rows.map((row) => `  ${row.status.padEnd(8)} ${row.sourceTable} -> ${row.destinationTable} (${row.rowCount} rows, checksum ${row.checksum})`),
].join('\n');

const promptForConfirmation = async (message: string): Promise<boolean> => {
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return ['y', 'yes'].includes((await prompt.question(message)).trim().toLowerCase());
  } finally {
    prompt.close();
  }
};

const executePostgresCommand = (
  args: string[],
  options: Record<string, unknown>,
  dependencies: PostgresCommandDependencies,
  importLegacy: (request: LegacyImportRequest) => Promise<readonly LegacyPostgresStoreImportResult[]>,
): Effect.Effect<number, PostgresCommandError> => Effect.gen(function* () {
  const io = dependencies.io ?? DEFAULT_IO;
  if (options.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  if (args[0] !== 'import-legacy' || args.length !== 1) {
    return yield* commandError('usage', USAGE);
  }
  const modules = yield* parseModules(options.modules);
  const schema = yield* parseSchema(options.schema, dependencies.defaultSchema);
  const request = { ...(schema === undefined ? {} : { schema }), modules };
  const preflight = yield* Effect.tryPromise({
    try: () => importLegacy({ ...request, dryRun: true }),
    catch: safeImportError,
  });

  if (options['dry-run'] === true) {
    if (options.json === true) {
      io.stdout(encodeJson({ ok: true, command: 'postgres import-legacy', dryRun: true, changed: false, data: preflight }));
    } else {
      io.stdout(formatRows('Legacy import preflight passed:', preflight));
    }
    return 0;
  }

  if (!preflight.some((row) => row.status === 'pending')) {
    if (options.json === true) {
      io.stdout(encodeJson({ ok: true, command: 'postgres import-legacy', dryRun: false, changed: false, preflight, data: preflight }));
    } else {
      io.stdout(formatRows('Legacy import is already verified; no copy is needed:', preflight));
    }
    return 0;
  }

  if (options.yes !== true) {
    if (options.json === true || dependencies.isTTY === false) {
      return yield* commandError('usage', 'Use --yes to run a legacy import non-interactively.');
    }
    io.stdout(formatRows('Legacy import preflight passed:', preflight));
    const confirmed = yield* Effect.tryPromise({
      try: () => (dependencies.confirm ?? promptForConfirmation)('Copy these legacy tables into the Fred schema? (y/N): '),
      catch: () => commandError('cancelled', 'Legacy import confirmation was cancelled.'),
    });
    if (!confirmed) {
      io.stdout('Aborted.');
      return 0;
    }
  }

  const results = yield* Effect.tryPromise({
    try: () => importLegacy(request),
    catch: safeImportError,
  });
  if (options.json === true) {
    io.stdout(encodeJson({ ok: true, command: 'postgres import-legacy', dryRun: false, changed: results.some((row) => row.imported), preflight, data: results }));
  } else {
    io.stdout(formatRows('Legacy import completed and verified:', results));
  }
  return 0;
});

const defaultImport = async (
  connectionString: string,
  request: LegacyImportRequest,
): Promise<readonly LegacyPostgresStoreImportResult[]> => {
  const [{ Pool }, postgres] = await Promise.all([import('pg'), import('@fancyrobot/fred-postgres')]);
  const pool = new Pool({ connectionString });
  try {
    return await Effect.runPromise(postgres.importLegacyFredPostgresStores({ pool, ...request }));
  } finally {
    await pool.end().catch(() => undefined);
  }
};

export const handlePostgresCommand = async (
  args: string[],
  options: Record<string, unknown>,
  dependencies: PostgresCommandDependencies = {},
): Promise<number> => {
  const io = dependencies.io ?? DEFAULT_IO;
  if (options.help === true) {
    io.stdout(USAGE);
    return 0;
  }
  const unknownOptions = Object.keys(options).filter((option) => !OPTIONS.has(option));
  if (unknownOptions.length > 0) {
    const message = `Unknown option${unknownOptions.length === 1 ? '' : 's'}: ${unknownOptions.map((option) => `--${option}`).join(', ')}. ${USAGE}`;
    if (options.json === true) io.stdout(encodeJson({ ok: false, command: 'postgres import-legacy', error: { code: 'usage', message } }));
    else io.stderr(message);
    return 2;
  }
  const connectionString = dependencies.importLegacy === undefined ? process.env.FRED_POSTGRES_URL : undefined;
  const importLegacy = dependencies.importLegacy
    ?? (connectionString === undefined ? undefined : (request: LegacyImportRequest) => defaultImport(connectionString, request));
  if (importLegacy === undefined) {
    const error = commandError('usage', 'FRED_POSTGRES_URL is required; connection strings are not accepted in command arguments.');
    if (options.json === true) io.stdout(encodeJson({ ok: false, command: 'postgres import-legacy', error: { code: error.code, message: error.message } }));
    else io.stderr(error.message);
    return 2;
  }

  return Effect.runPromise(executePostgresCommand(args, options, {
    ...dependencies,
    defaultSchema: dependencies.defaultSchema ?? process.env.FRED_POSTGRES_SCHEMA,
    isTTY: dependencies.isTTY ?? process.stdin.isTTY ?? false,
  }, importLegacy).pipe(
    Effect.catchTag('PostgresCommandError', (error) => Effect.sync(() => {
      if (options.json === true) io.stdout(encodeJson({ ok: false, command: 'postgres import-legacy', error: { code: error.code, message: error.message } }));
      else io.stderr(error.message);
      return error.code === 'usage' ? 2 : error.code === 'cancelled' ? 5 : 1;
    })),
  ));
};
