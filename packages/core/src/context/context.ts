import type { Prompt } from '@effect/ai';

/**
 * Conversation context metadata
 */
export interface ConversationPolicy {
  maxMessages?: number;
  maxChars?: number;
  strict?: boolean;
  isolated?: boolean;
}

export interface ConversationMetadata {
  createdAt: Date;
  updatedAt: Date;
  policy?: ConversationPolicy;
  [key: string]: any; // Allow additional metadata
}

/**
 * Conversation context
 */
export interface ConversationContext {
  id: string;
  messages: Prompt.MessageEncoded[];
  metadata: ConversationMetadata;
}

/**
 * Session agent metadata derived from ConversationMetadata.
 */
export interface SessionAgentMetadata {
  id?: string;
  name?: string;
}

/**
 * Summary information for listing sessions.
 */
export interface SessionSummary {
  id: string;
  title?: string;
  preview?: string;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  agent?: SessionAgentMetadata;
}

/**
 * Detailed session view with messages and metadata.
 */
export interface SessionDetails {
  summary: SessionSummary;
  messages: Prompt.MessageEncoded[];
  metadata: ConversationMetadata;
}

/**
 * JSON export shape for sessions.
 */
export interface SessionExportJson {
  id: string;
  metadata: Record<string, unknown>;
  messages: Array<Record<string, unknown>>;
}

/**
 * Markdown export is a formatted string.
 */
export type SessionExportMarkdown = string;

/**
 * Context storage abstraction interface
 */
export interface ContextStorage {
  get(id: string): Promise<ConversationContext | null>;
  set(id: string, context: ConversationContext): Promise<void>;
  listSessions(): Promise<SessionSummary[]>;
  delete(id: string): Promise<void>;
  clear(): Promise<void>;
}
