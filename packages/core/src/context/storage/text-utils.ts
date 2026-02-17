/**
 * Shared text utility functions for storage adapters.
 *
 * Both SQLite and Postgres adapters use identical logic for extracting,
 * normalizing, and truncating message preview text. This module provides
 * a single canonical implementation to avoid duplication.
 */

import type { Prompt } from '@effect/ai';
import type { ConversationMetadata, SessionSummary } from '../context';

/** Maximum character length for session preview text. */
export const PREVIEW_MAX_LENGTH = 120;

/** Length of the ellipsis character used when truncating text. */
const ELLIPSIS_LENGTH = 1;

/** Collapse all whitespace runs to a single space and trim. */
export const normalizeWhitespace = (value: string): string => value.replace(/\s+/g, ' ').trim();

/** Truncate text to `maxLength`, appending an ellipsis if it exceeds the limit. */
export const truncateText = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - ELLIPSIS_LENGTH)).trimEnd()}…`;
};

/** Convert an arbitrary value to a safe string representation. */
export const toSafeString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

/** Extract readable text from a single message content part. */
export const extractTextFromPart = (part: unknown): string => {
  if (!part || typeof part !== 'object') return '';
  const record = part as Record<string, unknown>;
  if (record.type === 'text') {
    return typeof record.text === 'string' ? record.text : '';
  }
  if (record.type === 'tool-call') {
    return `Tool Call: ${typeof record.name === 'string' ? record.name : 'tool'}`;
  }
  if (record.type === 'tool-result') {
    return `Tool Result: ${typeof record.name === 'string' ? record.name : 'tool'}`;
  }
  return toSafeString(part);
};

/** Extract the full text content from an encoded message. */
export const extractMessageText = (message: Prompt.MessageEncoded): string => {
  const content = message.content as unknown;
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content.map(extractTextFromPart).filter(Boolean).join('\n');
  }
  return toSafeString(content);
};

/** Extract a normalized, truncated preview string from an encoded message. */
export const extractMessagePreviewText = (message: Prompt.MessageEncoded): string | undefined => {
  const text = normalizeWhitespace(extractMessageText(message));
  if (!text) return undefined;
  return truncateText(text, PREVIEW_MAX_LENGTH);
};

/** Extract agent id/name from conversation metadata, returning undefined when absent. */
export const extractAgentMetadata = (
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
