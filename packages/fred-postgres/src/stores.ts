import { createHash } from 'node:crypto';
import { Effect } from 'effect';
import { Pool } from 'pg';
import type {
  Checkpoint,
  CheckpointStatus,
  CheckpointStorage,
  ContextStorage,
  ConversationContext,
  ConversationMetadata,
  SessionSummary,
} from '@fancyrobot/fred';
import {
  DEFAULT_POSTGRES_SCHEMA,
  fredPostgresTable,
  quotePostgresIdentifier,
  type FredPostgres,
  type FredPostgresMigration,
} from './postgres';
import { LegacyPostgresImportError, PostgresOperationError } from './errors';

export interface PostgresStoreQueryResult {
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number | null;
}

export interface PostgresStoreClient {
  query(text: string, values?: unknown[]): Promise<PostgresStoreQueryResult>;
  release(): void;
}

export interface PostgresStorePool {
  connect(): Promise<PostgresStoreClient>;
  end?(): Promise<void>;
}

export interface PostgresStoreOptions {
  readonly connectionString?: string;
  readonly pool?: PostgresStorePool;
  readonly schema?: string;
}

const resolvePool = (options: PostgresStoreOptions, name: string): readonly [PostgresStorePool, boolean] => {
  if (options.pool !== undefined && options.connectionString !== undefined) {
    throw new Error(`${name} accepts either connectionString or pool, not both`);
  }
  if (options.pool !== undefined) return [options.pool, false];
  if (options.connectionString !== undefined) return [new Pool({ connectionString: options.connectionString }), true];
  throw new Error(`${name} requires either connectionString or pool`);
};

const jsonMarker = '__$type';
const encodeJson = (value: unknown): unknown => {
  if (value instanceof Date) return { [jsonMarker]: 'Date', value: value.toISOString() };
  if (value instanceof URL) return { [jsonMarker]: 'URL', value: value.href };
  if (value instanceof Uint8Array) return { [jsonMarker]: 'Uint8Array', value: Buffer.from(value).toString('base64') };
  if (Array.isArray(value)) return value.map(encodeJson);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, encodeJson(item)]));
  }
  return value;
};

const decodeJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(decodeJson);
  if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if (record[jsonMarker] === 'Date' && typeof record.value === 'string') return new Date(record.value);
    if (record[jsonMarker] === 'URL' && typeof record.value === 'string') return new URL(record.value);
    if (record[jsonMarker] === 'Uint8Array' && typeof record.value === 'string') return new Uint8Array(Buffer.from(record.value, 'base64'));
    return Object.fromEntries(Object.entries(record).map(([key, item]) => [key, decodeJson(item)]));
  }
  return value;
};

// JSONB is untyped at the database boundary; callers select the expected stored shape.
const parseJson = <Value>(value: unknown): Value => decodeJson(typeof value === 'string' ? JSON.parse(value) : value) as Value;
const stringifyJson = (value: unknown): string => JSON.stringify(encodeJson(value));
const asObject = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected JSON object');
  return value as Record<string, unknown>;
};
const asString = (value: unknown, name: string): string => {
  if (typeof value !== 'string') throw new Error(`Expected ${name} to be a string`);
  return value;
};
const asDate = (value: unknown, name: string): Date => {
  const date = value instanceof Date ? value : new Date(asString(value, name));
  if (Number.isNaN(date.valueOf())) throw new Error(`Expected ${name} to be a valid date`);
  return date;
};

const preview = (message: ConversationContext['messages'][number]): string | undefined => {
  const content = message.content;
  const text = typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content.map((part) => {
          if (typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string') return part.text;
          return '';
        }).filter(Boolean).join(' ')
      : '';
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized ? (normalized.length <= 120 ? normalized : `${normalized.slice(0, 119).trimEnd()}…`) : undefined;
};

const sessionAgent = (metadata: ConversationMetadata): SessionSummary['agent'] | undefined => {
  const agent = metadata.agent;
  const id = typeof metadata.agentId === 'string' ? metadata.agentId : typeof agent?.id === 'string' ? agent.id : undefined;
  const name = typeof metadata.agentName === 'string' ? metadata.agentName : typeof agent?.name === 'string' ? agent.name : undefined;
  return id === undefined && name === undefined ? undefined : { id, name };
};

export const fredPostgresStoreMigrations = (
  schema = DEFAULT_POSTGRES_SCHEMA,
): readonly FredPostgresMigration[] => {
  const conversations = fredPostgresTable(schema, 'conversations');
  const messages = fredPostgresTable(schema, 'messages');
  const checkpoints = fredPostgresTable(schema, 'checkpoints');
  const apiKeys = fredPostgresTable(schema, 'fred_api_keys');
  const rateLimits = fredPostgresTable(schema, 'fred_rate_limit_buckets');
  const legacyImports = fredPostgresTable(schema, 'legacy_imports');
  const migrations = [
    {
      module: 'context', version: 1, sql: `
CREATE TABLE ${conversations} (id TEXT PRIMARY KEY, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), metadata JSONB NOT NULL DEFAULT '{}'::jsonb);
CREATE INDEX idx_conversations_created_at ON ${conversations} (created_at);
CREATE INDEX idx_conversations_updated_at ON ${conversations} (updated_at);
CREATE TABLE ${messages} (conversation_id TEXT NOT NULL REFERENCES ${conversations}(id) ON DELETE CASCADE, sequence INTEGER NOT NULL, payload JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (conversation_id, sequence));
CREATE INDEX idx_messages_conversation_id ON ${messages} (conversation_id);`,
    },
    {
      module: 'checkpoints', version: 1, sql: `
CREATE TABLE ${checkpoints} (run_id TEXT NOT NULL, pipeline_id TEXT NOT NULL, step INTEGER NOT NULL, status TEXT NOT NULL, context JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), expires_at TIMESTAMPTZ, step_name TEXT, pause_metadata JSONB, PRIMARY KEY (run_id, step));
CREATE INDEX idx_checkpoints_run_id ON ${checkpoints} (run_id);
CREATE INDEX idx_checkpoints_pipeline_id ON ${checkpoints} (pipeline_id);
CREATE INDEX idx_checkpoints_status ON ${checkpoints} (status);
CREATE INDEX idx_checkpoints_expires_at ON ${checkpoints} (expires_at) WHERE expires_at IS NOT NULL;`,
    },
    {
      module: 'http-api-keys', version: 1, sql: `
CREATE TABLE ${apiKeys} (id TEXT PRIMARY KEY, hash TEXT NOT NULL, scopes JSONB NOT NULL, rate_limit JSONB, revoked BOOLEAN NOT NULL DEFAULT FALSE, verifier_id TEXT, verifier_version INTEGER, verifier_metadata JSONB, expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL);`,
    },
    {
      module: 'http-rate-limits', version: 1, sql: `
CREATE TABLE ${rateLimits} (bucket_key TEXT PRIMARY KEY, window_start BIGINT NOT NULL, request_count INTEGER NOT NULL, expires_at BIGINT NOT NULL, decision_id TEXT);
CREATE INDEX idx_fred_rate_limit_buckets_expires_at ON ${rateLimits} (expires_at);`,
    },
    {
      module: 'legacy-imports', version: 1, sql: `
CREATE TABLE ${legacyImports} (source_table TEXT PRIMARY KEY, source_count BIGINT NOT NULL, source_checksum TEXT NOT NULL, destination_count BIGINT NOT NULL, destination_checksum TEXT NOT NULL, imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW());`,
    },
  ];
  const schemaPrefix = `${quotePostgresIdentifier(schema)}.`;
  return migrations.map((migration) => ({
    ...migration,
    // SHA-256 identifies immutable migration SQL; no credential material is hashed.
    // codeql[js/insufficient-password-hash]
    checksum: createHash('sha256')
      .update(`${migration.module}\0${migration.version}\0${migration.sql.replaceAll(schemaPrefix, '"$schema".')}`)
      .digest('hex'),
  }));
};

/** Apply the complete adapter schema before constructing a Postgres store. */
export const migrateFredPostgresStores = (database: FredPostgres) =>
  database.diagnostics.pipe(
    Effect.flatMap(({ schema }) => database.migrate(fredPostgresStoreMigrations(schema))),
  );

export type LegacyStoreModule = 'context' | 'checkpoints' | 'http-api-keys' | 'http-rate-limits';

export interface LegacyPostgresStoreImportOptions {
  readonly pool: PostgresStorePool;
  readonly schema?: string;
  readonly modules?: readonly LegacyStoreModule[];
  readonly dryRun?: boolean;
}

export interface LegacyPostgresStoreImportResult {
  readonly sourceTable: string;
  readonly destinationTable: string;
  readonly rowCount: number;
  readonly checksum: string;
  readonly imported: boolean;
  readonly status: 'pending' | 'imported' | 'verified';
}

const legacyTables = (schema: string): ReadonlyArray<{
  readonly module: LegacyStoreModule;
  readonly name: string;
  readonly columns: readonly string[];
  readonly primaryKey: readonly string[];
  readonly source: string;
  readonly destination: string;
}> => [
  { module: 'context', name: 'conversations', columns: ['id', 'created_at', 'updated_at', 'metadata'], primaryKey: ['id'], source: fredPostgresTable('public', 'conversations'), destination: fredPostgresTable(schema, 'conversations') },
  { module: 'context', name: 'messages', columns: ['conversation_id', 'sequence', 'payload', 'created_at'], primaryKey: ['conversation_id', 'sequence'], source: fredPostgresTable('public', 'messages'), destination: fredPostgresTable(schema, 'messages') },
  { module: 'checkpoints', name: 'checkpoints', columns: ['run_id', 'pipeline_id', 'step', 'status', 'context', 'created_at', 'updated_at', 'expires_at', 'step_name', 'pause_metadata'], primaryKey: ['run_id', 'step'], source: fredPostgresTable('public', 'checkpoints'), destination: fredPostgresTable(schema, 'checkpoints') },
  { module: 'http-api-keys', name: 'fred_api_keys', columns: ['id', 'hash', 'scopes', 'rate_limit', 'revoked', 'verifier_id', 'verifier_version', 'verifier_metadata', 'expires_at', 'created_at'], primaryKey: ['id'], source: fredPostgresTable('public', 'fred_api_keys'), destination: fredPostgresTable(schema, 'fred_api_keys') },
  { module: 'http-rate-limits', name: 'fred_rate_limit_buckets', columns: ['bucket_key', 'window_start', 'request_count', 'expires_at', 'decision_id'], primaryKey: ['bucket_key'], source: fredPostgresTable('public', 'fred_rate_limit_buckets'), destination: fredPostgresTable(schema, 'fred_rate_limit_buckets') },
];

const importFailure = (operation: string, table: string, cause: unknown) => new LegacyPostgresImportError({
  operation,
  table,
  message: cause instanceof Error ? cause.message : String(cause),
});

const summary = async (
  client: PostgresStoreClient,
  table: ReturnType<typeof legacyTables>[number],
  relation: string,
) => {
  const values = table.columns.map((column) => `source_row.${quotePostgresIdentifier(column)}`).join(', ');
  const order = table.primaryKey.map((column) => `source_row.${quotePostgresIdentifier(column)}`).join(', ');
  const result = await client.query(`SELECT COUNT(*)::text AS row_count, md5(COALESCE(string_agg(md5(json_build_array(${values})::text), '' ORDER BY ${order}), '')) AS checksum FROM ${relation} AS source_row`);
  const row = result.rows[0];
  const rowCount = Number(row?.row_count);
  const checksum = row?.checksum;
  if (!Number.isSafeInteger(rowCount) || rowCount < 0 || typeof checksum !== 'string') throw new Error('Invalid table summary');
  return { rowCount, checksum };
};

/**
 * Copy known legacy public tables into the Fred schema without modifying the
 * source. Run migrateFredPostgresStores first; this operation never creates
 * tables, auto-adopts a matching name, or replaces a non-empty destination.
 */
export const importLegacyFredPostgresStores = (
  options: LegacyPostgresStoreImportOptions,
): Effect.Effect<readonly LegacyPostgresStoreImportResult[], LegacyPostgresImportError | PostgresOperationError> =>
  Effect.tryPromise({
    try: async () => {
      const schema = options.schema ?? DEFAULT_POSTGRES_SCHEMA;
      const requested = options.modules ?? ['context', 'checkpoints', 'http-api-keys', 'http-rate-limits'];
      const selected = legacyTables(schema).filter((table) => requested.includes(table.module));
      if (selected.length === 0) throw importFailure('preflight', 'all', 'Select at least one legacy store module');
      const client = await options.pool.connect();
      try {
        const ledger = fredPostgresTable(schema, 'legacy_imports');
        const completed = await client.query(`SELECT source_table, source_count, source_checksum, destination_count, destination_checksum FROM ${ledger}`);
        const imported = new Map(completed.rows.map((row) => [row.source_table, row]));
        const pending: Array<{ readonly table: (typeof selected)[number]; readonly source: { readonly rowCount: number; readonly checksum: string } }> = [];
        const results: LegacyPostgresStoreImportResult[] = [];
        for (const table of selected) {
          const previous = imported.get(table.name);
          const source = await summary(client, table, table.source);
          const destination = await summary(client, table, table.destination);
          if (previous !== undefined) {
            if (Number(previous.source_count) !== source.rowCount || previous.source_checksum !== source.checksum || Number(previous.destination_count) !== destination.rowCount || previous.destination_checksum !== destination.checksum) {
              throw importFailure('verify', table.name, 'Legacy import ledger no longer matches source or destination');
            }
            results.push({ sourceTable: table.source, destinationTable: table.destination, ...source, imported: false, status: 'verified' });
            continue;
          }
          const columns = await client.query('SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name', ['public', table.name]);
          const found = columns.rows.map((row) => row.column_name).filter((column): column is string => typeof column === 'string').sort();
          const expected = [...table.columns].sort();
          if (found.length !== expected.length || found.some((column, index) => column !== expected[index])) {
            throw importFailure('preflight', table.name, 'Legacy source columns do not exactly match the supported shape');
          }
          if (destination.rowCount !== 0) throw importFailure('preflight', table.name, 'Destination is non-empty without an import ledger entry');
          pending.push({ table, source });
        }
        if (options.dryRun === true) {
          return [
            ...results,
            ...pending.map(({ table, source }) => ({
              sourceTable: table.source,
              destinationTable: table.destination,
              ...source,
              imported: false,
              status: 'pending' as const,
            })),
          ];
        }
        if (pending.length === 0) return results;
        await client.query('BEGIN');
        for (const { table } of pending) {
          const quotedColumns = table.columns.map(quotePostgresIdentifier).join(', ');
          await client.query(`INSERT INTO ${table.destination} (${quotedColumns}) SELECT ${quotedColumns} FROM ${table.source}`);
          const source = await summary(client, table, table.source);
          const destination = await summary(client, table, table.destination);
          if (source.rowCount !== destination.rowCount || source.checksum !== destination.checksum) throw importFailure('verify', table.name, 'Copied rows do not match the untouched source');
          await client.query(`INSERT INTO ${ledger} (source_table, source_count, source_checksum, destination_count, destination_checksum) VALUES ($1, $2, $3, $4, $5)`, [table.name, source.rowCount, source.checksum, destination.rowCount, destination.checksum]);
          results.push({ sourceTable: table.source, destinationTable: table.destination, ...source, imported: true, status: 'imported' });
        }
        await client.query('COMMIT');
        return results;
      } catch (cause) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw cause;
      } finally {
        client.release();
      }
    },
    catch: (cause) => cause instanceof LegacyPostgresImportError
      ? cause
      : new PostgresOperationError({ operation: 'importLegacyStores', message: cause instanceof Error ? cause.message : String(cause) }),
  });

export class PostgresContextStorage implements ContextStorage {
  private readonly pool: PostgresStorePool;
  private readonly ownsPool: boolean;
  private readonly conversations: string;
  private readonly messages: string;

  constructor(options: PostgresStoreOptions) {
    [this.pool, this.ownsPool] = resolvePool(options, 'PostgresContextStorage');
    const schema = options.schema ?? DEFAULT_POSTGRES_SCHEMA;
    this.conversations = fredPostgresTable(schema, 'conversations');
    this.messages = fredPostgresTable(schema, 'messages');
  }

  async get(id: string): Promise<ConversationContext | null> {
    const client = await this.pool.connect();
    try {
      const conversation = await client.query(`SELECT id, created_at, updated_at, metadata FROM ${this.conversations} WHERE id = $1`, [id]);
      const row = conversation.rows[0];
      if (row === undefined) return null;
      const result = await client.query(`SELECT payload FROM ${this.messages} WHERE conversation_id = $1 ORDER BY sequence ASC`, [id]);
      const messages: ConversationContext['messages'] = [];
      for (const [index, messageRow] of result.rows.entries()) {
        try {
          messages.push(parseJson<ConversationContext['messages'][number]>(messageRow.payload));
        } catch (cause) {
          console.warn(`[PostgresContextStorage] Warning: Failed to deserialize message at sequence ${index} for conversation ${id}:`, cause instanceof Error ? cause.message : String(cause));
        }
      }
      const metadata = asObject(parseJson(row.metadata));
      return {
        id: asString(row.id, 'conversation id'),
        messages,
        metadata: { createdAt: asDate(row.created_at, 'created_at'), updatedAt: asDate(row.updated_at, 'updated_at'), ...metadata },
      };
    } finally {
      client.release();
    }
  }

  async set(id: string, context: ConversationContext): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { createdAt, updatedAt, ...metadata } = context.metadata;
      await client.query(
        `INSERT INTO ${this.conversations} (id, created_at, updated_at, metadata) VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT (id) DO UPDATE SET updated_at = EXCLUDED.updated_at, metadata = EXCLUDED.metadata`,
        [id, createdAt, updatedAt, stringifyJson(metadata)],
      );
      await client.query(`DELETE FROM ${this.messages} WHERE conversation_id = $1`, [id]);
      if (context.messages.length > 0) {
        await client.query(`INSERT INTO ${this.messages} (conversation_id, sequence, payload, created_at) SELECT $1, (ordinality - 1)::integer, payload, NOW() FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS messages(payload, ordinality)`, [id, stringifyJson(context.messages)]);
      }
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  }

  async listSessions(): Promise<SessionSummary[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`SELECT c.id, c.created_at, c.updated_at, c.metadata, COUNT(m.sequence) AS message_count, (SELECT m2.payload FROM ${this.messages} m2 WHERE m2.conversation_id = c.id AND (m2.payload->>'role' IN ('user', 'assistant') OR m2.payload->>'_tag' IN ('UserMessage', 'AssistantMessage')) ORDER BY m2.sequence DESC LIMIT 1) AS last_payload FROM ${this.conversations} c LEFT JOIN ${this.messages} m ON m.conversation_id = c.id GROUP BY c.id ORDER BY c.updated_at DESC`);
      return result.rows.map((row) => {
        const metadata = asObject(parseJson(row.metadata));
        const createdAt = asDate(row.created_at, 'created_at');
        const updatedAt = asDate(row.updated_at, 'updated_at');
        const typedMetadata: ConversationMetadata = { createdAt, updatedAt, ...metadata };
        const message = row.last_payload === null || row.last_payload === undefined
          ? undefined
          : parseJson<ConversationContext['messages'][number]>(row.last_payload);
        const title = typeof metadata.title === 'string' ? metadata.title : typeof metadata.sessionTitle === 'string' ? metadata.sessionTitle : undefined;
        return { id: asString(row.id, 'conversation id'), title, preview: message === undefined ? undefined : preview(message), createdAt, updatedAt, messageCount: Number(row.message_count ?? 0), agent: sessionAgent(typedMetadata) };
      });
    } finally {
      client.release();
    }
  }

  async delete(id: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${this.conversations} WHERE id = $1`, [id]);
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  }

  async clear(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${this.conversations}`);
      await client.query('COMMIT');
    } catch (cause) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.ownsPool) await this.pool.end?.();
  }
}

const checkpointStatuses: readonly CheckpointStatus[] = ['pending', 'in_progress', 'completed', 'failed', 'paused', 'expired'];
const checkpointStatus = (value: unknown): CheckpointStatus => {
  if (typeof value !== 'string' || !checkpointStatuses.includes(value as CheckpointStatus)) throw new Error('Expected a valid checkpoint status');
  return value as CheckpointStatus;
};

export class PostgresCheckpointStorage implements CheckpointStorage {
  private readonly pool: PostgresStorePool;
  private readonly ownsPool: boolean;
  private readonly checkpoints: string;

  constructor(options: PostgresStoreOptions) {
    [this.pool, this.ownsPool] = resolvePool(options, 'PostgresCheckpointStorage');
    this.checkpoints = fredPostgresTable(options.schema ?? DEFAULT_POSTGRES_SCHEMA, 'checkpoints');
  }

  private checkpoint(row: Record<string, unknown>): Checkpoint {
    const context = parseJson<Checkpoint['context']>(row.context);
    const pauseMetadata = row.pause_metadata === null || row.pause_metadata === undefined
      ? undefined
      : parseJson<NonNullable<Checkpoint['pauseMetadata']>>(row.pause_metadata);
    return { runId: asString(row.run_id, 'run_id'), pipelineId: asString(row.pipeline_id, 'pipeline_id'), step: Number(row.step), status: checkpointStatus(row.status), context, createdAt: asDate(row.created_at, 'created_at'), updatedAt: asDate(row.updated_at, 'updated_at'), expiresAt: row.expires_at === null || row.expires_at === undefined ? undefined : asDate(row.expires_at, 'expires_at'), stepName: row.step_name === null || row.step_name === undefined ? undefined : asString(row.step_name, 'step_name'), pauseMetadata };
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(`INSERT INTO ${this.checkpoints} (run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10::jsonb) ON CONFLICT (run_id, step) DO UPDATE SET status = EXCLUDED.status, context = EXCLUDED.context, updated_at = EXCLUDED.updated_at, expires_at = EXCLUDED.expires_at, step_name = EXCLUDED.step_name, pause_metadata = EXCLUDED.pause_metadata`, [checkpoint.runId, checkpoint.pipelineId, checkpoint.step, checkpoint.status, stringifyJson(checkpoint.context), checkpoint.createdAt, checkpoint.updatedAt, checkpoint.expiresAt ?? null, checkpoint.stepName ?? null, checkpoint.pauseMetadata === undefined ? null : stringifyJson(checkpoint.pauseMetadata)]);
    } finally {
      client.release();
    }
  }

  private async one(sql: string, values: unknown[], warning: string): Promise<Checkpoint | null> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(sql, values);
      const row = result.rows[0];
      if (row === undefined) return null;
      try { return this.checkpoint(row); } catch (cause) {
        console.warn(`[PostgresCheckpointStorage] Warning: Failed to deserialize ${warning}:`, cause instanceof Error ? cause.message : String(cause));
        return null;
      }
    } finally {
      client.release();
    }
  }

  getLatest(runId: string): Promise<Checkpoint | null> {
    return this.one(`SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata FROM ${this.checkpoints} WHERE run_id = $1 ORDER BY step DESC LIMIT 1`, [runId], `checkpoint for run ${runId}`);
  }

  get(runId: string, step: number): Promise<Checkpoint | null> {
    return this.one(`SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata FROM ${this.checkpoints} WHERE run_id = $1 AND step = $2`, [runId, step], `checkpoint for run ${runId} step ${step}`);
  }

  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    const client = await this.pool.connect();
    try { await client.query(`UPDATE ${this.checkpoints} SET status = $3, updated_at = NOW() WHERE run_id = $1 AND step = $2`, [runId, step, status]); } finally { client.release(); }
  }

  async deleteRun(runId: string): Promise<void> {
    const client = await this.pool.connect();
    try { await client.query('BEGIN'); await client.query(`DELETE FROM ${this.checkpoints} WHERE run_id = $1`, [runId]); await client.query('COMMIT'); } catch (cause) { await client.query('ROLLBACK').catch(() => undefined); throw cause; } finally { client.release(); }
  }

  async deleteExpired(): Promise<number> {
    const client = await this.pool.connect();
    try { return (await client.query(`DELETE FROM ${this.checkpoints} WHERE expires_at < NOW()`)).rowCount ?? 0; } finally { client.release(); }
  }

  async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(`SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata FROM ${this.checkpoints} WHERE status = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC`, [status]);
      return result.rows.flatMap((row) => {
        try { return [this.checkpoint(row)]; } catch (cause) { console.warn('[PostgresCheckpointStorage] Warning: Failed to deserialize checkpoint:', cause instanceof Error ? cause.message : String(cause)); return []; }
      });
    } finally { client.release(); }
  }

  getLatestByPipelineId(pipelineId: string): Promise<Checkpoint | null> {
    return this.one(`SELECT run_id, pipeline_id, step, status, context, created_at, updated_at, expires_at, step_name, pause_metadata FROM ${this.checkpoints} WHERE pipeline_id = $1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY step DESC, created_at DESC LIMIT 1`, [pipelineId], `checkpoint for pipeline ${pipelineId}`);
  }

  async close(): Promise<void> { if (this.ownsPool) await this.pool.end?.(); }
}
