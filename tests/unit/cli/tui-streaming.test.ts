import { afterEach, describe, expect, test } from 'bun:test';
import {
  createStreamingController,
  type StreamingBatch,
} from '../../../packages/cli/src/tui/streaming.js';

describe('TUI streaming controller', () => {
  const activeControllers: Array<ReturnType<typeof createStreamingController>> = [];

  afterEach(() => {
    for (const controller of activeControllers) {
      controller.stop();
    }
    activeControllers.length = 0;
  });

  test('coalesces bursty token events and preserves output order', async () => {
    const batches: StreamingBatch[] = [];
    const controller = createStreamingController({
      frameMs: 16,
      maxRenderQueue: 2,
      callbacks: {
        onBatch: (batch) => {
          batches.push(batch);
        },
      },
    });
    activeControllers.push(controller);

    controller.start();

    const tokens = Array.from({ length: 40 }, (_, index) => `[${index}]`);
    for (const token of tokens) {
      controller.pushToken(token);
    }

    await Bun.sleep(60);

    const renderedText = batches.map((batch) => batch.text).join('');
    expect(renderedText).toBe(tokens.join(''));
    expect(batches.length).toBeLessThan(tokens.length);

    const metrics = controller.getMetricsSnapshot();
    expect(metrics.tokensProcessed).toBe(tokens.length);
    expect(metrics.tokensPerSecond).toBeGreaterThan(0);
    expect(metrics.firstTokenLatencyMs).not.toBeNull();
  });

  test('keeps render queue bounded while coalescing render signals', async () => {
    const controller = createStreamingController({
      frameMs: 16,
      maxRenderQueue: 2,
    });
    activeControllers.push(controller);

    controller.start();

    for (let i = 0; i < 200; i += 1) {
      controller.pushToken('x');
    }

    const buffer = controller.getBufferSnapshot();
    expect(buffer.renderQueueDepth).toBeLessThanOrEqual(2);

    await Bun.sleep(80);

    const metrics = controller.getMetricsSnapshot();
    expect(metrics.tokensProcessed).toBe(200);
    expect(metrics.droppedRenderSignals).toBeGreaterThan(0);
  });

  test('emits error events and retains deterministic metrics snapshot', async () => {
    let seenErrorMessage: string | undefined;
    const controller = createStreamingController({
      frameMs: 16,
      maxRenderQueue: 2,
      callbacks: {
        onError: (error) => {
          seenErrorMessage = error.message;
        },
      },
    });
    activeControllers.push(controller);

    controller.start();
    controller.pushToken('hello');
    controller.fail(new Error('upstream failed'));

    await Bun.sleep(40);

    expect(seenErrorMessage).toBe('upstream failed');

    const metrics = controller.getMetricsSnapshot();
    expect(metrics.tokensProcessed).toBe(1);
    expect(metrics.lastError).toBe('upstream failed');
    expect(metrics.endedAtMs).not.toBeNull();
  });
});
