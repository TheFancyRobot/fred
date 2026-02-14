import type { SessionSummary } from '@fancyrobot/fred';
import { ContextManager } from '@fancyrobot/fred';
import type { SessionListItem, TuiState } from './state.js';
import { addSession, applySessionDeletion, createTranscriptState } from './state.js';

export interface SessionServiceDependencies {
  contextManager: ContextManager;
}

const titleFallback = (summary: SessionSummary): string | null => summary.title ?? null;

function normalizeUpdatedAt(value: unknown): Date {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }

  const normalized = new Date(value as string | number | Date);
  if (Number.isFinite(normalized.getTime())) {
    return normalized;
  }

  return new Date(0);
}

export function toSessionListItem(summary: SessionSummary): SessionListItem {
  return {
    id: summary.id,
    title: titleFallback(summary),
    updatedAt: normalizeUpdatedAt(summary.updatedAt),
    agent: summary.agent ?? undefined,
    messageCount: summary.messageCount,
    preview: summary.preview ?? null,
    unread: false,
  };
}

export async function loadSessions(
  deps: SessionServiceDependencies
): Promise<SessionListItem[]> {
  const sessions = await deps.contextManager.listSessions();
  return sessions.map(toSessionListItem);
}

export async function createSession(
  deps: SessionServiceDependencies,
  options: { title?: string; agent?: { id?: string; name?: string } } = {}
): Promise<SessionListItem> {
  const id = deps.contextManager.generateConversationId();
  const metadata: Record<string, unknown> = {};
  if (options.title) {
    metadata.title = options.title;
  }
  if (options.agent?.id) {
    metadata.agentId = options.agent.id;
  }
  if (options.agent?.name) {
    metadata.agentName = options.agent.name;
  }

  await deps.contextManager.getContext(id);
  if (Object.keys(metadata).length > 0) {
    await deps.contextManager.updateMetadata(id, metadata);
  }

  const summary = await deps.contextManager.getSession(id);
  if (!summary) {
    throw new Error(`Failed to create session ${id}`);
  }

  return toSessionListItem(summary.summary);
}

export async function createAndSelectSession(
  deps: SessionServiceDependencies,
  state: TuiState,
  options: { title?: string; agent?: { id?: string; name?: string } } = {}
): Promise<TuiState> {
  const item = await createSession(deps, options);
  return addSession(state, item, { select: true });
}

export async function loadSessionTranscript(
  deps: SessionServiceDependencies,
  sessionId: string
): Promise<Array<{ role: string; content: string }>> {
  const session = await deps.contextManager.getSession(sessionId);
  if (!session) return [];
  return session.messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : JSON.stringify(message.content ?? ''),
  }));
}

export async function deleteSession(
  deps: SessionServiceDependencies,
  state: TuiState,
  sessionId: string
): Promise<TuiState> {
  await deps.contextManager.deleteSession(sessionId);

  const summaries = await deps.contextManager.listSessions();
  const items = summaries.map(toSessionListItem);
  const sorted = [...items].sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  const selectedId = sorted[0]?.id ?? null;

  const nextState = applySessionDeletion(state, items, { selectedId });
  if (!nextState.sessions.selectedId) {
    return nextState;
  }

  const messages = await loadSessionTranscript(deps, nextState.sessions.selectedId);
  const transcript = createTranscriptState(messages, nextState.transcript.viewport.visibleLines, true);

  return {
    ...nextState,
    transcript,
    sessions: {
      ...nextState.sessions,
      transcripts: {
        ...nextState.sessions.transcripts,
        [nextState.sessions.selectedId]: transcript,
      },
    },
  };
}
