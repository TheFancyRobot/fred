import { describe, test, expect } from 'bun:test';
import { Effect, Stream } from 'effect';

/**
 * Tests for AbortSignal-based stream interruption.
 * Verifies the pattern used by fred.streamMessage() to cancel
 * streams on explicit user exit (/exit, Ctrl+C).
 */
describe('AbortSignal stream interruption', () => {
  test('AbortSignal interrupts Effect stream via Stream.interruptWhen', async () => {
    const controller = new AbortController();
    const collected: number[] = [];

    // Create a stream that yields control between items so interrupt fiber can race
    let effectStream = Stream.fromIterable([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).pipe(
      Stream.tap((n) =>
        Effect.gen(function* () {
          collected.push(n);
          // Abort after seeing value 2
          if (n === 2) {
            controller.abort();
          }
          // Yield control to let interrupt fiber run
          yield* Effect.yieldNow();
        })
      )
    );

    // Apply the same interruptWhen pattern used in fred.streamMessage()
    effectStream = effectStream.pipe(
      Stream.interruptWhen(
        Effect.async<void, never>((resume) => {
          if (controller.signal.aborted) {
            resume(Effect.succeed(undefined));
            return;
          }
          const onAbort = () => resume(Effect.succeed(undefined));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          return Effect.sync(() => {
            controller.signal.removeEventListener('abort', onAbort);
          });
        })
      )
    );

    // Run the stream — should stop after abort
    await Effect.runPromise(
      Stream.runCollect(effectStream).pipe(Effect.either)
    );

    // Stream should have been interrupted before processing all 10 items
    expect(collected.length).toBeLessThan(10);
    expect(collected[0]).toBe(1);
    expect(collected[1]).toBe(2);
  });

  test('pre-aborted signal interrupts async stream before completion', async () => {
    const controller = new AbortController();
    controller.abort(); // Already aborted

    const collected: number[] = [];

    // Use an async stream with yields to give the interrupt fiber a chance to run
    let effectStream = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
      Stream.tap((n) =>
        Effect.gen(function* () {
          // Yield control between items to let interrupt fiber race
          yield* Effect.yieldNow();
          collected.push(n);
        })
      )
    );

    effectStream = effectStream.pipe(
      Stream.interruptWhen(
        Effect.async<void, never>((resume) => {
          if (controller.signal.aborted) {
            resume(Effect.succeed(undefined));
            return;
          }
          const onAbort = () => resume(Effect.succeed(undefined));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          return Effect.sync(() => {
            controller.signal.removeEventListener('abort', onAbort);
          });
        })
      )
    );

    await Effect.runPromise(
      Stream.runCollect(effectStream).pipe(Effect.either)
    );

    // Pre-aborted signal should interrupt before all 5 items are processed
    expect(collected.length).toBeLessThan(5);
  });

  test('stream without abort signal runs to completion normally', async () => {
    const collected: number[] = [];

    const effectStream = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
      Stream.tap((n) =>
        Effect.sync(() => {
          collected.push(n);
        })
      )
    );

    // No interruptWhen — stream runs fully
    await Effect.runPromise(Stream.runCollect(effectStream));

    expect(collected).toEqual([1, 2, 3, 4, 5]);
  });

  test('for-await loop exits cleanly on abort', async () => {
    const controller = new AbortController();
    const collected: number[] = [];

    const effectStream = Stream.fromIterable([1, 2, 3, 4, 5]).pipe(
      Stream.interruptWhen(
        Effect.async<void, never>((resume) => {
          if (controller.signal.aborted) {
            resume(Effect.succeed(undefined));
            return;
          }
          const onAbort = () => resume(Effect.succeed(undefined));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          return Effect.sync(() => {
            controller.signal.removeEventListener('abort', onAbort);
          });
        })
      )
    );

    // Simulate the for-await pattern used in chat.ts
    for await (const item of Stream.toAsyncIterable(effectStream)) {
      if (controller.signal.aborted) break;
      collected.push(item);
      if (item === 2) {
        controller.abort();
      }
    }

    // Should have exited after abort
    expect(collected.length).toBeLessThanOrEqual(2);
    expect(collected).toContain(1);
    expect(collected).toContain(2);
  });
});
