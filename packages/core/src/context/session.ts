import type { Prompt } from '@effect/ai';
import type {
  ConversationContext,
  ConversationMetadata,
  SessionAgentMetadata,
  SessionDetails,
  SessionExportJson,
  SessionExportMarkdown,
  SessionSummary,
} from './context';
import { serializeMessage, deserializeMessage, serializeMetadata } from './storage/serialization';

const TITLE_MAX_LENGTH = 60;
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

const extractTitleFromMetadata = (metadata: ConversationMetadata): string | undefined => {
  const direct = metadata.title ?? metadata.sessionTitle;
  if (typeof direct === 'string' && direct.trim().length > 0) {
    return direct.trim();
  }
  const nested = (metadata as { session?: { title?: unknown } }).session?.title;
  if (typeof nested === 'string' && nested.trim().length > 0) {
    return nested.trim();
  }
  return undefined;
};

export const extractAgentMetadata = (
  metadata: ConversationMetadata
): SessionAgentMetadata | undefined => {
  const agentId = typeof metadata.agentId === 'string' ? metadata.agentId : undefined;
  const agentName = typeof metadata.agentName === 'string' ? metadata.agentName : undefined;
  const agent = (metadata as { agent?: { id?: unknown; name?: unknown } }).agent;

  const id = agentId ?? (typeof agent?.id === 'string' ? agent.id : undefined);
  const name = agentName ?? (typeof agent?.name === 'string' ? agent.name : undefined);

  if (!id && !name) return undefined;
  return { id, name };
};

export const extractMessagePreviewText = (
  message: Prompt.MessageEncoded,
  maxLength = PREVIEW_MAX_LENGTH
): string | undefined => {
  const text = normalizeWhitespace(extractMessageText(message));
  if (!text) return undefined;
  return truncateText(text, maxLength);
};

export const deriveSessionTitle = (
  metadata: ConversationMetadata,
  messages: Prompt.MessageEncoded[]
): string | undefined => {
  const metadataTitle = extractTitleFromMetadata(metadata);
  if (metadataTitle) return metadataTitle;

  const firstUser = messages.find((message) => message.role === 'user');
  if (!firstUser) return undefined;

  const text = normalizeWhitespace(extractMessageText(firstUser));
  if (!text) return undefined;
  return truncateText(text, TITLE_MAX_LENGTH);
};

export const deriveSessionPreview = (
  messages: Prompt.MessageEncoded[]
): string | undefined => {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue;
    }
    const text = extractMessagePreviewText(message, PREVIEW_MAX_LENGTH);
    if (!text) continue;
    return text;
  }
  return undefined;
};

export const buildSessionSummary = (
  context: ConversationContext
): SessionSummary => {
  const title = deriveSessionTitle(context.metadata, context.messages);
  const preview = deriveSessionPreview(context.messages);

  return {
    id: context.id,
    title,
    preview,
    createdAt: context.metadata.createdAt,
    updatedAt: context.metadata.updatedAt,
    messageCount: context.messages.length,
    agent: extractAgentMetadata(context.metadata),
  };
};

export const buildSessionDetails = (
  context: ConversationContext
): SessionDetails => ({
  summary: buildSessionSummary(context),
  messages: context.messages,
  metadata: context.metadata,
});

export const exportSessionToJson = (
  context: ConversationContext
): SessionExportJson => {
  const { createdAt, updatedAt, metadata } = serializeMetadata(context.metadata);
  const parsedMetadata = JSON.parse(metadata) as Record<string, unknown>;

  return {
    id: context.id,
    metadata: {
      ...parsedMetadata,
      createdAt,
      updatedAt,
    },
    messages: context.messages.map((message) =>
      JSON.parse(serializeMessage(message).payload)
    ),
  };
};

const formatMessageMarkdown = (message: Prompt.MessageEncoded): string => {
  const header = `### ${message.role}`;
  const content = message.content as unknown;

  if (typeof content === 'string') {
    return `${header}\n${content}`;
  }

  if (Array.isArray(content)) {
    const parts = content.map((part) => {
      if (part?.type === 'text') {
        return part.text ?? '';
      }
      if (part?.type === 'tool-call') {
        return `**Tool Call: ${part.name ?? 'tool'}**\n\n\
\`\`\`json\n${JSON.stringify(part.params ?? {}, null, 2)}\n\`\`\``;
      }
      if (part?.type === 'tool-result') {
        return `**Tool Result: ${part.name ?? 'tool'}**\n\n\
\`\`\`json\n${JSON.stringify(part.result ?? {}, null, 2)}\n\`\`\``;
      }
      return `\`\`\`json\n${JSON.stringify(part, null, 2)}\n\`\`\``;
    });

    return `${header}\n${parts.filter(Boolean).join('\n\n')}`;
  }

  return `${header}\n${toSafeString(content)}`;
};

export const exportSessionToMarkdown = (
  context: ConversationContext
): SessionExportMarkdown => {
  const title = deriveSessionTitle(context.metadata, context.messages) ?? 'Untitled session';
  const summary = buildSessionSummary(context);
  const jsonExport = exportSessionToJson(context);
  const normalizedMessages = context.messages.map((message) =>
    deserializeMessage(serializeMessage(message).payload)
  );

  const agentLabel = summary.agent?.name ?? summary.agent?.id;
  const metadataBlock = JSON.stringify(jsonExport.metadata, null, 2);
  const transcript = normalizedMessages.map(formatMessageMarkdown).join('\n\n');

  return `# Session: ${title}\n\n` +
    `- **ID:** ${context.id}\n` +
    `- **Created:** ${summary.createdAt.toISOString()}\n` +
    `- **Updated:** ${summary.updatedAt.toISOString()}\n` +
    `- **Messages:** ${summary.messageCount}\n` +
    (agentLabel ? `- **Agent:** ${agentLabel}\n` : '') +
    `\n## Metadata\n\n\`\`\`json\n${metadataBlock}\n\`\`\`\n\n` +
    `## Transcript\n\n${transcript}`;
};
