import { Chunk, Effect, Fiber, Queue, Stream } from 'effect';

export interface StreamingMetrics {
  startedAtMs: number | null;
  firstTokenAtMs: number | null;
  firstTokenLatencyMs: number | null;
  tokensProcessed: number;
  tokensPerSecond: number;
  bufferedTokens: number;
  bufferedChars: number;
  droppedRenderSignals: number;
  endedAtMs: number | null;
  lastError: string | null;
}

export interface StreamingBatch {
  text: string;
  tokenCount: number;
  metrics: StreamingMetrics;
}

interface RenderSignal {
  readonly type: 'render' | 'finish' | 'error';
  readonly error?: Error;
}

export interface StreamingControllerCallbacks {
  onBatch?: (batch: StreamingBatch) => void;
  onMetrics?: (metrics: StreamingMetrics) => void;
  onError?: (error: Error, metrics: StreamingMetrics) => void;
  onFinish?: (metrics: StreamingMetrics) => void;
}

export interface StreamingControllerOptions {
  frameMs?: number;
  maxRenderQueue?: number;
  now?: () => number;
  callbacks?: StreamingControllerCallbacks;
}

export interface StreamingController {
  start: () => void;
  stop: () => void;
  pushToken: (token: string, tokenCount?: number) => void;
  finish: () => void;
  fail: (error: unknown) => void;
  getMetricsSnapshot: () => StreamingMetrics;
  getBufferSnapshot: () => { pendingTokens: number; pendingChars: number; renderQueueDepth: number };
}

const DEFAULT_FRAME_MS = 16;
const DEFAULT_MAX_RENDER_QUEUE = 3;
const GROUP_SIZE = 512;

export function createStreamingController(options: StreamingControllerOptions = {}): StreamingController {
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const maxRenderQueue = options.maxRenderQueue ?? DEFAULT_MAX_RENDER_QUEUE;
  const now = options.now ?? Date.now;
  const callbacks = options.callbacks ?? {};

  let running = false;
  let queue: Queue.Queue<RenderSignal> | null = null;
  let fiber: Fiber.RuntimeFiber<void, unknown> | null = null;

  let pendingText = '';
  let pendingTokens = 0;
  let renderQueueDepth = 0;

  let startedAtMs: number | null = null;
  let firstTokenAtMs: number | null = null;
  let endedAtMs: number | null = null;
  let tokensProcessed = 0;
  let droppedRenderSignals = 0;
  let lastError: string | null = null;

  const getMetricsSnapshot = (): StreamingMetrics => {
    const currentMs = now();
    const firstLatency = startedAtMs !== null && firstTokenAtMs !== null
      ? Math.max(0, firstTokenAtMs - startedAtMs)
      : null;
    const elapsedMs = startedAtMs !== null ? Math.max(1, currentMs - startedAtMs) : 0;

    return {
      startedAtMs,
      firstTokenAtMs,
      firstTokenLatencyMs: firstLatency,
      tokensProcessed,
      tokensPerSecond: elapsedMs > 0 ? (tokensProcessed * 1000) / elapsedMs : 0,
      bufferedTokens: pendingTokens,
      bufferedChars: pendingText.length,
      droppedRenderSignals,
      endedAtMs,
      lastError,
    };
  };

  const emitMetrics = (): void => {
    callbacks.onMetrics?.(getMetricsSnapshot());
  };

  const flushPending = (): void => {
    if (pendingTokens === 0 || pendingText.length === 0) {
      emitMetrics();
      return;
    }

    const text = pendingText;
    const tokenCount = pendingTokens;
    pendingText = '';
    pendingTokens = 0;

    callbacks.onBatch?.({
      text,
      tokenCount,
      metrics: getMetricsSnapshot(),
    });
    emitMetrics();
  };

  const processSignalChunk = (signals: Chunk.Chunk<RenderSignal>): void => {
    renderQueueDepth = Math.max(0, renderQueueDepth - Chunk.size(signals));

    flushPending();

    const signalArray = Chunk.toArray(signals);
    for (const signal of signalArray) {
      if (signal.type === 'error' && signal.error) {
        lastError = signal.error.message;
        endedAtMs = now();
        callbacks.onError?.(signal.error, getMetricsSnapshot());
      }

      if (signal.type === 'finish') {
        endedAtMs = now();
        callbacks.onFinish?.(getMetricsSnapshot());
      }
    }
  };

  const offerRenderSignal = (signal: RenderSignal): void => {
    if (!queue || !running) {
      return;
    }

    if (renderQueueDepth >= maxRenderQueue) {
      droppedRenderSignals += 1;
      renderQueueDepth = maxRenderQueue;
    } else {
      renderQueueDepth += 1;
    }

    Effect.runFork(Queue.offer(queue, signal));
  };

  const start = (): void => {
    if (running) {
      return;
    }

    running = true;
    startedAtMs = now();
    firstTokenAtMs = null;
    endedAtMs = null;
    tokensProcessed = 0;
    droppedRenderSignals = 0;
    pendingText = '';
    pendingTokens = 0;
    renderQueueDepth = 0;
    lastError = null;

    queue = Effect.runSync(Queue.sliding<RenderSignal>(maxRenderQueue));
    const stream = Stream.fromQueue(queue).pipe(
      Stream.groupedWithin(GROUP_SIZE, `${frameMs} millis`),
      Stream.runForEach((signals) => Effect.sync(() => processSignalChunk(signals))),
    );

    fiber = Effect.runFork(stream);
    emitMetrics();
  };

  const stop = (): void => {
    if (!running) {
      return;
    }

    running = false;
    endedAtMs = now();

    if (queue) {
      Effect.runFork(Queue.shutdown(queue));
    }
    if (fiber) {
      Effect.runFork(Fiber.interrupt(fiber));
    }

    queue = null;
    fiber = null;
    emitMetrics();
  };

  const pushToken = (token: string, tokenCount = 1): void => {
    if (!running || token.length === 0) {
      return;
    }

    if (firstTokenAtMs === null) {
      firstTokenAtMs = now();
    }

    pendingText += token;
    pendingTokens += tokenCount;
    tokensProcessed += tokenCount;
    offerRenderSignal({ type: 'render' });
  };

  const finish = (): void => {
    if (!running) {
      return;
    }
    offerRenderSignal({ type: 'finish' });
  };

  const fail = (error: unknown): void => {
    if (!running) {
      return;
    }

    const normalized = error instanceof Error ? error : new Error(String(error));
    offerRenderSignal({ type: 'error', error: normalized });
  };

  return {
    start,
    stop,
    pushToken,
    finish,
    fail,
    getMetricsSnapshot,
    getBufferSnapshot: () => ({
      pendingTokens,
      pendingChars: pendingText.length,
      renderQueueDepth,
    }),
  };
}
