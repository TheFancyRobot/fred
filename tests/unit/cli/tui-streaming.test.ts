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

  test('handles 100+ tokens/sec without unbounded queue growth', async () => {
    const controller = createStreamingController({
      frameMs: 16,
      maxRenderQueue: 2,
    });
    activeControllers.push(controller);

    controller.start();
    const startedAt = Date.now();

    const burstTokens = 140;
    for (let i = 0; i < burstTokens; i += 1) {
      controller.pushToken('t');
    }

    await Bun.sleep(30);

    const elapsedMs = Date.now() - startedAt;
    const rate = burstTokens / Math.max(0.001, elapsedMs / 1000);
    expect(rate).toBeGreaterThan(100);

    const buffer = controller.getBufferSnapshot();
    expect(buffer.renderQueueDepth).toBeLessThanOrEqual(2);

    await Bun.sleep(90);

    const metrics = controller.getMetricsSnapshot();
    expect(metrics.tokensProcessed).toBe(burstTokens);
    expect(metrics.droppedRenderSignals).toBeGreaterThan(0);
    expect(metrics.bufferedChars).toBeGreaterThanOrEqual(0);
  });

  test('maintains stable update cadence at >=100 tokens/sec throughput', async () => {
    const metricTimestamps: number[] = [];
    const controller = createStreamingController({
      frameMs: 16,
      maxRenderQueue: 2,
      callbacks: {
        onMetrics: () => {
          metricTimestamps.push(Date.now());
        },
      },
    });
    activeControllers.push(controller);

    controller.start();

    const runMs = 320;
    const startMs = Date.now();
    let pushed = 0;
    while ((Date.now() - startMs) < runMs) {
      controller.pushToken('z');
      pushed += 1;
      await Bun.sleep(5);
    }

    await Bun.sleep(120);

    const metrics = controller.getMetricsSnapshot();
    const buffer = controller.getBufferSnapshot();

    expect(pushed).toBeGreaterThan(40);
    expect(metrics.tokensPerSecond).toBeGreaterThan(100);
    expect(buffer.renderQueueDepth).toBeLessThanOrEqual(2);

    const uniqueMetricTimestamps = Array.from(new Set(metricTimestamps));
    expect(uniqueMetricTimestamps.length).toBeGreaterThan(2);
    const deltas = uniqueMetricTimestamps
      .slice(1)
      .map((time, index) => time - uniqueMetricTimestamps[index]);
    expect(Math.max(...deltas)).toBeLessThanOrEqual(120);
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
