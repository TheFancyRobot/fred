/**
 * Postgres-backed ContextStorage adapter.
 *
 * Provides production-grade persistence using Postgres with safe transactions
 * and best-effort recovery for corrupted rows.
 */

import type { Pool, PoolClient } from 'pg';
import type { Prompt } from '@effect/ai';
import type {
  ContextStorage,
  ConversationContext,
  ConversationMetadata,
  SessionSummary,
} from '../context';
import { POSTGRES_SCHEMA_DDL } from './schema';
import {
  serializeMessage,
  deserializeMessage,
  tryDeserializeMessage,
  serializeMetadata,
  deserializeMetadata,
} from './serialization';

interface SessionRow {
  id: string;
  created_at: string | Date;
  updated_at: string | Date;
  metadata: object;
  message_count: string | number | null;
  last_payload: object | null;
}

const PREVIEW_MAX_LENGTH = 120;

const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const toSafeString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const extractTextFromPart = (part: any): string => {
  if (!part || typeof part !== 'object') return '';
  if (part.type === 'text') {
    return typeof part.text === 'string' ? part.text : '';
  }
  if (part.type === 'tool-call') {
    return `Tool Call: ${part.name ?? 'tool'}`;
  }
  if (part.type === 'tool-result') {
    return `Tool Result: ${part.name ?? 'tool'}`;
  }
  return toSafeString(part);
};

const extractMessageText = (message: Prompt.MessageEncoded): string => {
  const content = message.content as unknown;
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content.map(extractTextFromPart).filter(Boolean).join('\n');
  }
  return toSafeString(content);
};

const extractMessagePreviewText = (message: Prompt.MessageEncoded): string | undefined => {
  const text = normalizeWhitespace(extractMessageText(message));
  if (!text) return undefined;
  return truncateText(text, PREVIEW_MAX_LENGTH);
};

const extractAgentMetadata = (
  metadata: ConversationMetadata
): SessionSummary['agent'] | undefined => {
  const agentId = typeof metadata.agentId === 'string' ? metadata.agentId : undefined;
  const agentName = typeof metadata.agentName === 'string' ? metadata.agentName : undefined;
  const agent = (metadata as { agent?: { id?: unknown; name?: unknown } }).agent;

  const id = agentId ?? (typeof agent?.id === 'string' ? agent.id : undefined);
  const name = agentName ?? (typeof agent?.name === 'string' ? agent.name : undefined);

  if (!id && !name) return undefined;
  return { id, name };
};

/**
 * Configuration options for PostgresContextStorage.
 */
export interface PostgresContextStorageOptions {
  /**
   * Connection string for Postgres (e.g., postgres://user:pass@host:5432/db).
   * Either connectionString or pool must be provided.
   */
  connectionString?: string;

  /**
   * Pre-configured Pool instance for dependency injection (useful for testing).
   * Either connectionString or pool must be provided.
   */
  pool?: Pool;
}

/**
 * Postgres-backed implementation of ContextStorage.
 *
 * Features:
 * - Lazy schema initialization with CREATE TABLE IF NOT EXISTS
 * - Transactional writes for data integrity
 * - Best-effort recovery with warnings for corrupted rows
 * - Support for both connection string and injected pool (for testing)
 */
export class PostgresContextStorage implements ContextStorage {
  private pool: Pool;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor(options: PostgresContextStorageOptions) {
    if (options.pool) {
      this.pool = options.pool;
    } else if (options.connectionString) {
      // Dynamic import to avoid hard dependency when pool is injected
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Pool: PgPool } = require('pg');
      this.pool = new PgPool({ connectionString: options.connectionString });
    } else {
      throw new Error(
        'PostgresContextStorage requires either connectionString or pool'
      );
    }
  }

  /**
   * Lazily initialize the database schema.
   * Safe to call multiple times; only executes once.
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    // Use promise deduplication to prevent concurrent init
    if (!this.initPromise) {
      this.initPromise = this.initializeSchema();
    }

    await this.initPromise;
  }

  private async initializeSchema(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query(POSTGRES_SCHEMA_DDL);
      this.initialized = true;
    } finally {
      client.release();
    }
  }

  /**
   * Get a conversation context by ID.
   * Returns null if the conversation doesn't exist.
   * Uses best-effort recovery, logging warnings for corrupted message rows.
   */
  async get(id: string): Promise<ConversationContext | null> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      // Query conversation metadata
      const convResult = await client.query(
        `SELECT id, created_at, updated_at, metadata
         FROM conversations
         WHERE id = $1`,
        [id]
      );

      if (convResult.rows.length === 0) {
        return null;
      }

      const conv = convResult.rows[0];

      // Query messages ordered by sequence
      const msgResult = await client.query(
        `SELECT payload
         FROM messages
         WHERE conversation_id = $1
         ORDER BY sequence ASC`,
        [id]
      );

      // Deserialize messages with best-effort recovery
      const messages = [];
      for (let i = 0; i < msgResult.rows.length; i++) {
        const row = msgResult.rows[i];
        try {
          // Postgres JSONB returns parsed object, but handle string too
          const message = deserializeMessage(row.payload);
          messages.push(message);
        } catch (err) {
          console.warn(
            `[PostgresContextStorage] Warning: Failed to deserialize message at sequence ${i} for conversation ${id}:`,
            err instanceof Error ? err.message : String(err)
          );
          // Skip corrupted row, continue with best-effort recovery
        }
      }

      // Deserialize metadata
      const metadata: ConversationMetadata = deserializeMetadata(
        conv.created_at,
        conv.updated_at,
        conv.metadata
      );

      return {
        id: conv.id,
        messages,
        metadata,
      };
    } finally {
      client.release();
    }
  }

  /**
   * Store a conversation context.
   * Uses a transaction to ensure atomic writes:
   * 1. Upsert conversation metadata
   * 2. Delete existing messages
   * 3. Insert new messages with sequence numbers
   */
  async set(id: string, context: ConversationContext): Promise<void> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Serialize metadata
      const { createdAt, updatedAt, metadata } = serializeMetadata(
        context.metadata
      );

      // Upsert conversation
      await client.query(
        `INSERT INTO conversations (id, created_at, updated_at, metadata)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (id) DO UPDATE SET
           updated_at = EXCLUDED.updated_at,
           metadata = EXCLUDED.metadata`,
        [id, createdAt, updatedAt, metadata]
      );

      // Delete existing messages for this conversation
      await client.query(
        `DELETE FROM messages WHERE conversation_id = $1`,
        [id]
      );

      // Insert messages with sequence numbers
      for (let i = 0; i < context.messages.length; i++) {
        const { payload } = serializeMessage(context.messages[i]);
        await client.query(
          `INSERT INTO messages (conversation_id, sequence, payload, created_at)
           VALUES ($1, $2, $3::jsonb, NOW())`,
          [id, i, payload]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * List session summaries ordered by updated_at DESC.
   */
  async listSessions(): Promise<SessionSummary[]> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      const result = await client.query(
        `SELECT
          c.id,
          c.created_at,
          c.updated_at,
          c.metadata,
          COUNT(m.sequence) as message_count,
          (
            SELECT m2.payload
            FROM messages m2
            WHERE m2.conversation_id = c.id
              AND (
                m2.payload->>'role' IN ('user', 'assistant')
                OR m2.payload->>'_tag' IN ('UserMessage', 'AssistantMessage')
              )
            ORDER BY m2.sequence DESC
            LIMIT 1
          ) as last_payload
        FROM conversations c
        LEFT JOIN messages m ON m.conversation_id = c.id
        GROUP BY c.id
        ORDER BY c.updated_at DESC`
      );

      return result.rows.map((row: SessionRow) => {
        let metadata: ConversationMetadata;
        try {
          metadata = deserializeMetadata(
            row.created_at,
            row.updated_at,
            row.metadata
          );
        } catch (err) {
          console.warn(
            `[PostgresContextStorage] Warning: Failed to deserialize metadata for conversation ${row.id}:`,
            err instanceof Error ? err.message : String(err)
          );
          metadata = {
            createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
            updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
          };
        }

        let preview: string | undefined;
        if (row.last_payload) {
          const message = tryDeserializeMessage(row.last_payload);
          if (message) {
            preview = extractMessagePreviewText(message);
          }
        }

        const title = typeof metadata.title === 'string'
          ? metadata.title
          : typeof (metadata as { sessionTitle?: unknown }).sessionTitle === 'string'
            ? (metadata as { sessionTitle?: string }).sessionTitle
            : undefined;

        return {
          id: row.id,
          title,
          preview,
          createdAt: metadata.createdAt,
          updatedAt: metadata.updatedAt,
          messageCount: Number(row.message_count ?? 0),
          agent: extractAgentMetadata(metadata),
        } satisfies SessionSummary;
      });
    } finally {
      client.release();
    }
  }

  /**
   * Delete a conversation and all its messages.
   * Messages are automatically deleted via CASCADE.
   */
  async delete(id: string): Promise<void> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM conversations WHERE id = $1`,
        [id]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Clear all conversations and messages.
   */
  async clear(): Promise<void> {
    await this.ensureInitialized();

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Delete all conversations; messages cascade
      await client.query(`DELETE FROM conversations`);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Close the connection pool.
   * Call this when shutting down to release resources.
   */
  async close(): Promise<void> {
    await this.pool.end();
  }
}
