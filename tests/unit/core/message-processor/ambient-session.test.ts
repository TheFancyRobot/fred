/**
 * Phase 62 / STEP-62-03: agent execution reads the ambient session.
 *
 * The MessageProcessor resolves conversation history from SessionService.current
 * when no explicit conversationId is given. Precedence:
 *   explicit conversationId > ambient session > freshly generated id.
 * `useSessionHistory: false` opts a call out of the ambient fallback.
 *
 * We observe the resolved id by recording which conversation `getHistory` is
 * called for (routing fails afterward with no agent; that's irrelevant here).
 */
import { describe, expect, it } from 'bun:test';
import { Effect, Layer } from 'effect';
import {
  MessageProcessorService,
  MessageProcessorServiceLive,
} from '../../../../packages/core/src/message-processor/service';
import { AgentService, PipelineService, ContextStorageService } from '../../../../packages/core/src/services';
import { SessionService, SessionServiceLive } from '../../../../packages/core/src/context/session-service';

const mockAgentService = {
  getAgentOptional: () => Effect.succeed(undefined),
  hasAgent: () => Effect.succeed(false),
  getAllAgents: () => Effect.succeed([]),
  matchAgentByUtterance: () => Effect.succeed(null),
} as any;

const mockPipelineService = {
  getPipelineOptional: () => Effect.succeed(undefined),
  matchPipelineByUtterance: () => Effect.succeed(null),
} as any;

/** Storage that records every conversationId passed to getHistory. */
const makeRecordingStorage = (historyReads: string[]) =>
  ({
    generateConversationId: () => Effect.succeed('generated-id'),
    getContextById: () => Effect.succeed(null),
    addMessage: () => Effect.void,
    addMessages: () => Effect.void,
    getHistory: (conversationId: string) => {
      historyReads.push(conversationId);
      return Effect.succeed([]);
    },
    updateMetadata: () => Effect.void,
    clearContext: () => Effect.void,
    setDefaultPolicy: () => Effect.void,
  }) as any;

/** Run an effect that needs the processor + ambient session, recording history reads. */
const runResolving = async (
  build: (svc: {
    processor: MessageProcessorService;
    session: SessionService;
  }) => Effect.Effect<unknown, unknown, never>,
): Promise<string[]> => {
  const historyReads: string[] = [];
  const testLayer = Layer.mergeAll(
    Layer.succeed(AgentService, mockAgentService),
    Layer.succeed(PipelineService, mockPipelineService),
    Layer.succeed(ContextStorageService, makeRecordingStorage(historyReads)),
    SessionServiceLive,
  );

  await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const processor = yield* MessageProcessorService;
        const session = yield* SessionService;
        yield* build({ processor, session }).pipe(Effect.either);
      }).pipe(Effect.provide(MessageProcessorServiceLive), Effect.provide(testLayer)),
    ),
  );

  return historyReads;
};

describe('MessageProcessor ambient session resolution', () => {
  it('loads history for the ambient session when no conversationId is given', async () => {
    const reads = await runResolving(({ processor, session }) =>
      session.withSession('conv_ambient', processor.processMessage('hi', {})),
    );
    expect(reads).toContain('conv_ambient');
  });

  it('lets an explicit conversationId win over the ambient session', async () => {
    const reads = await runResolving(({ processor, session }) =>
      session.withSession('conv_ambient', processor.processMessage('hi', { conversationId: 'conv_explicit' })),
    );
    expect(reads).toContain('conv_explicit');
    expect(reads).not.toContain('conv_ambient');
  });

  it('opts out of ambient history with useSessionHistory: false', async () => {
    const reads = await runResolving(({ processor, session }) =>
      session.withSession('conv_ambient', processor.processMessage('hi', { useSessionHistory: false })),
    );
    // Falls back to a freshly generated id, not the ambient one.
    expect(reads).not.toContain('conv_ambient');
    expect(reads).toContain('generated-id');
  });

  it('generates a fresh id when there is no ambient session', async () => {
    const reads = await runResolving(({ processor }) => processor.processMessage('hi', {}));
    expect(reads).toContain('generated-id');
  });
});
