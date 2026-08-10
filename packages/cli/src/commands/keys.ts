import { Effect } from 'effect';

interface KeysCommandOptions {
  readonly sqlite?: string;
  readonly postgres?: string;
  readonly memory?: boolean | string;
  readonly scopes?: string;
  readonly scope?: string;
  readonly id?: string;
  readonly verifier?: string;
  readonly 'expires-at'?: string;
  readonly 'rate-limit-max'?: string;
  readonly 'rate-limit-window-ms'?: string;
}

type FredHttpApiKeyModule = typeof import('@fancyrobot/fred-http');

const parsePositiveInteger = (value: string | undefined, flag: string): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
};

const parseScopes = (value: string | undefined): readonly string[] => {
  if (value === undefined || value.trim() === '') return [];
  const scopes = [...new Set(value.split(',').map((scope) => scope.trim()))];
  if (scopes.some((scope) => !/^[A-Za-z0-9:_-]+$/.test(scope))) {
    throw new Error('Scopes must be comma-separated names containing only letters, numbers, colon, underscore, or dash');
  }
  return scopes.sort();
};

const parseIsoTimestamp = (value: string | undefined): Date | undefined => {
  if (value === undefined) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) throw new Error('--expires-at must be a valid ISO-8601 timestamp');
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth
    || hour > 23 || minute > 59 || second > 59) {
    throw new Error('--expires-at must be a valid ISO-8601 timestamp');
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('--expires-at must be a valid ISO-8601 timestamp');
  return parsed;
};

export async function handleKeysCommand(
  args: string[],
  options: KeysCommandOptions,
  loadFredHttp: () => Promise<FredHttpApiKeyModule> = () => import('@fancyrobot/fred-http'),
): Promise<number> {
  if (args[0] !== 'create') {
    console.error('Usage: fred keys create (--sqlite <path> | --postgres <url>) [--scopes <a,b>] [--verifier <id>] [--expires-at <ISO-8601>]');
    return 1;
  }
  if (options.memory !== undefined) {
    console.error('fred keys create requires durable SQLite or Postgres storage; memory is not supported');
    return 1;
  }
  if ((options.sqlite === undefined) === (options.postgres === undefined)) {
    console.error('Specify exactly one durable store: --sqlite <path> or --postgres <url>');
    return 1;
  }

  let close: (() => Promise<void>) | undefined;
  try {
    const http = await loadFredHttp();
    const scopes = parseScopes(options.scopes ?? options.scope);
    const maxRequests = parsePositiveInteger(options['rate-limit-max'], '--rate-limit-max');
    const windowMs = parsePositiveInteger(options['rate-limit-window-ms'], '--rate-limit-window-ms');
    if ((maxRequests === undefined) !== (windowMs === undefined)) {
      throw new Error('--rate-limit-max and --rate-limit-window-ms must be supplied together');
    }

    let store: import('@fancyrobot/fred-http').ApiKeyStoreService;
    if (options.sqlite !== undefined) {
      store = http.makeSqliteApiKeyStore(options.sqlite);
    } else {
      const { Pool } = await import('pg');
      const pool = new Pool({ connectionString: options.postgres });
      close = () => pool.end();
      const postgres = await import('@fancyrobot/fred-postgres');
      const schema = process.env.FRED_POSTGRES_SCHEMA ?? postgres.DEFAULT_POSTGRES_SCHEMA;
      const database = await Effect.runPromise(postgres.makeFredPostgres({ pool, schema }));
      await Effect.runPromise(database.migrate(
        postgres.fredPostgresStoreMigrations(schema).filter((migration) => migration.module === 'http-api-keys'),
      ));
      store = http.makePostgresApiKeyStore(pool, { schema });
    }

    const expiresAt = parseIsoTimestamp(options['expires-at']);
    const supportedVerifierIds: ReadonlySet<string> = new Set([
      http.API_KEY_VERIFIER_IDS.argon2id,
      http.API_KEY_VERIFIER_IDS.scrypt,
      http.API_KEY_VERIFIER_IDS.pbkdf2,
    ]);
    if (options.verifier !== undefined && !supportedVerifierIds.has(options.verifier)) {
      throw new Error('--verifier must be argon2id-v1, scrypt-v1, or pbkdf2-sha256-v1; HMAC and custom verifiers require a programmatic registry');
    }
    const generated = await Effect.runPromise(http.generateApiKey(scopes, {
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(options.verifier === undefined ? {} : { verifierId: options.verifier }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
      ...(maxRequests === undefined || windowMs === undefined
        ? {}
        : { rateLimit: { maxRequests, windowMs } }),
    }));
    await Effect.runPromise(store.initialize.pipe(Effect.andThen(store.insert(generated.record))));
    console.log(generated.token);
    return 0;
  } catch (cause) {
    console.error(`Unable to create API key: ${cause instanceof Error ? cause.message : String(cause)}`);
    return 1;
  } finally {
    await close?.().catch(() => undefined);
  }
}
