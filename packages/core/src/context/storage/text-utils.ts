/**
 * Shared text utility functions for storage adapters.
 *
 * Both SQLite and Postgres adapters use identical logic for extracting,
 * normalizing, and truncating message preview text. This module provides
 * a single canonical implementation to avoid duplication.
 */

import type { Prompt } from '@effect/ai';

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
export const extractTextFromPart = (part: any): string => {
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
