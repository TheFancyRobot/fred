import { describe, expect, test } from 'bun:test';
import { Deferred, Effect, Exit, Fiber, Stream } from 'effect';
import {
  AgentStatusService,
  AgentStatusServiceLive,
  trackAgentRun,
} from '../../../../packages/core/src/observability/status';
import { AgentStatusService as EffectAgentStatusService } from '../../../../packages/core/src/effect/services';
import { AgentStatusService as PublicAgentStatusService } from '../../../../packages/core/src/index';
import { makeFredRuntimeLayer } from '../../../../packages/core/src/services';

const annotation = {
  runId: 'run-1',
  agentId: 'agent-1',
  workflowId: 'workflow-1',
  sessionId: 'session-1',
  startedAt: 1_234,
} as const;

describe('AgentStatusService', () => {
  test('ignores unannotated fibers', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const fiber = yield* Deferred.succeed(started, undefined).pipe(
          Effect.zipRight(Deferred.await(release)),
          Effect.fork
        );

        yield* Deferred.await(started);
        expect(yield* status.snapshot).toEqual([]);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(fiber);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('tracks one run root, ignores descendants, and removes it on completion', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const rootStarted = yield* Deferred.make<void>();
        const childStarted = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const run = yield* trackAgentRun(annotation)(
          Effect.gen(function* () {
            yield* Effect.fork(
              Deferred.succeed(childStarted, undefined).pipe(
                Effect.zipRight(Deferred.await(release))
              )
            );
            yield* Deferred.await(childStarted);
            yield* Deferred.succeed(rootStarted, undefined);
            yield* Deferred.await(release);
          })
        ).pipe(Effect.fork);

        yield* Deferred.await(rootStarted);
        const active = yield* status.snapshot;
        expect(active).toHaveLength(1);
        expect(active[0]).toMatchObject({
          agentId: 'agent-1',
          workflowId: 'workflow-1',
          sessionId: 'session-1',
          state: 'starting',
          startedAt: 1_234,
        });

        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);
        expect(yield* status.snapshot).toEqual([]);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('removes an annotated run when its fiber is interrupted', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();

        const run = yield* trackAgentRun(annotation)(
          Deferred.succeed(started, undefined).pipe(Effect.zipRight(Effect.never))
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        expect(yield* status.snapshot).toHaveLength(1);

        yield* Fiber.interrupt(run);
        expect(yield* status.snapshot).toEqual([]);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('emits ordered start, transition, and cleanup snapshots', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();

        const observed = yield* status.changes.pipe(
          Stream.take(3),
          Stream.runCollect,
          Effect.fork
        );
        yield* Effect.yieldNow();

        const run = yield* trackAgentRun(annotation)(
          Effect.gen(function* () {
            yield* Deferred.succeed(started, undefined);
            yield* status.transition('streaming');
            yield* Deferred.await(release);
          })
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);

        const snapshots = Array.from(yield* Fiber.join(observed));
        expect(snapshots.map((snapshot) => snapshot.length)).toEqual([1, 1, 0]);
        expect(snapshots[0]?.[0]?.state).toBe('starting');
        expect(snapshots[1]?.[0]?.state).toBe('streaming');
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('releases a changes subscription when its consumer is interrupted', async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const consumer = yield* Stream.runDrain(status.changes).pipe(Effect.fork);
        yield* Effect.yieldNow();

        const exit = yield* Fiber.interrupt(consumer);
        expect(Exit.isInterrupted(exit)).toBe(true);
        expect(yield* status.snapshot).toEqual([]);
      }).pipe(Effect.provide(AgentStatusServiceLive))
    );
  });

  test('is supervised by the Fred runtime layer and exported publicly', async () => {
    const [active, completed] = await Effect.runPromise(
      Effect.gen(function* () {
        const status = yield* AgentStatusService;
        const started = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const run = yield* trackAgentRun(annotation)(
          Deferred.succeed(started, undefined).pipe(
            Effect.zipRight(Deferred.await(release))
          )
        ).pipe(Effect.fork);

        yield* Deferred.await(started);
        const active = yield* status.snapshot;
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(run);
        const completed = yield* status.snapshot;
        return [active, completed] as const;
      }).pipe(Effect.provide(makeFredRuntimeLayer()))
    );

    expect(active).toHaveLength(1);
    expect(completed).toEqual([]);
    expect(EffectAgentStatusService).toBe(AgentStatusService);
    expect(PublicAgentStatusService).toBe(AgentStatusService);
  });
});
