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

export function createStreamingController(options: StreamingControllerOptions = {}): StreamingController {
  const frameMs = options.frameMs ?? DEFAULT_FRAME_MS;
  const now = options.now ?? Date.now;
  const callbacks = options.callbacks ?? {};

  let running = false;
  let intervalId: ReturnType<typeof setInterval> | null = null;

  let pendingText = '';
  let pendingTokens = 0;

  let startedAtMs: number | null = null;
  let firstTokenAtMs: number | null = null;
  let endedAtMs: number | null = null;
  let tokensProcessed = 0;
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
      droppedRenderSignals: 0,
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

  const start = (): void => {
    if (running) {
      return;
    }

    running = true;
    startedAtMs = now();
    firstTokenAtMs = null;
    endedAtMs = null;
    tokensProcessed = 0;
    pendingText = '';
    pendingTokens = 0;
    lastError = null;

    intervalId = setInterval(() => {
      flushPending();
    }, frameMs);
    emitMetrics();
  };

  const stop = (): void => {
    if (!running) {
      return;
    }

    running = false;
    endedAtMs = now();

    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }

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
  };

  const finish = (): void => {
    if (!running) {
      return;
    }

    flushPending();
    endedAtMs = now();
    callbacks.onFinish?.(getMetricsSnapshot());
  };

  const fail = (error: unknown): void => {
    if (!running) {
      return;
    }

    const normalized = error instanceof Error ? error : new Error(String(error));
    flushPending();
    lastError = normalized.message;
    endedAtMs = now();
    callbacks.onError?.(normalized, getMetricsSnapshot());
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
      renderQueueDepth: 0,
    }),
  };
}
