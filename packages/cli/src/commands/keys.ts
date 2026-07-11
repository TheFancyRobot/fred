import { Effect } from 'effect';

interface KeysCommandOptions {
  readonly sqlite?: string;
  readonly postgres?: string;
  readonly memory?: boolean | string;
  readonly scopes?: string;
  readonly scope?: string;
  readonly id?: string;
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

export async function handleKeysCommand(
  args: string[],
  options: KeysCommandOptions,
  loadFredHttp: () => Promise<FredHttpApiKeyModule> = () => import('@fancyrobot/fred-http'),
): Promise<number> {
  if (args[0] !== 'create') {
    console.error('Usage: fred keys create (--sqlite <path> | --postgres <url>) [--scopes <a,b>]');
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
      store = http.makePostgresApiKeyStore(pool);
    }

    const generated = http.generateApiKey(scopes, {
      ...(options.id === undefined ? {} : { id: options.id }),
      ...(maxRequests === undefined || windowMs === undefined
        ? {}
        : { rateLimit: { maxRequests, windowMs } }),
    });
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
