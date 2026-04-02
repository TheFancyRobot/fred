/**
 * Shared text smoother for display-layer streaming.
 *
 * Provider chunk boundaries are arbitrary and vary across OpenAI, OpenRouter,
 * Anthropic, etc. Fred's raw stream (`fullStream`) is the canonical semantic
 * stream and must not be altered. This module provides a display-layer
 * smoother that normalises the *visual cadence* of assistant text output,
 * independent of upstream chunk sizes.
 *
 * Design:
 * - Only operates on assistant text chunks. Non-text events (tool-call,
 *   tool-result, usage, run-end, errors) must be handled by the caller
 *   and are not touched by this module.
 * - Callers should flush pending text before processing non-text events
 *   when ordering matters.
 * - The smoother is frontend-agnostic: CLI, web, SSE adapters, etc. can
 *   all use the same utility.
 *
 * Modelled after Vercel's `smoothStream()` behaviour, adapted to Fred's
 * event model.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Chunking strategy for splitting buffered text into display units.
 *
 * - `'word'`  Split on whitespace boundaries (default). Good for Latin scripts.
 * - `'line'`  Split on newline boundaries. Useful for code or structured output.
 * - `RegExp`  Custom regex whose first match is emitted as a chunk.
 * - `Intl.Segmenter`  Unicode-aware word segmentation (ideal for CJK, Thai, etc.).
 * - `(buffer: string) => string | null | undefined`  Fully custom extractor.
 *    Return the next chunk to emit, or null/undefined to wait for more input.
 */
export type ChunkingStrategy =
  | 'word'
  | 'line'
  | RegExp
  | Intl.Segmenter
  | ((buffer: string) => string | null | undefined);

/**
 * Options for {@link createTextSmoother}.
 */
export interface TextSmootherOptions {
  /**
   * Called for each display chunk emitted by the smoother.
   *
   * `tokenCount` is an accounting hint: 1 for the first visual segment of
   * each logical AI token, 0 for subsequent sub-word segments. This allows
   * consumers to track token throughput without double-counting.
   */
  onChunk: (chunk: string, tokenCount?: number) => void;

  /**
   * Delay in milliseconds between emitted display chunks.
   *
   * - `null` or `0` disables the timer and flushes chunks synchronously on push.
   * - Defaults to `12`.
   */
  delayMs?: number | null;

  /**
   * How incoming text is split into display-sized chunks.
   * Defaults to `'word'`.
   */
  chunking?: ChunkingStrategy;
}

/**
 * A text smoother instance returned by {@link createTextSmoother}.
 */
export interface TextSmoother {
  /**
   * Feed a text chunk from the AI stream into the smoother.
   * The text is buffered and drip-fed to `onChunk` according to the
   * configured chunking strategy and delay.
   */
  push(text: string): void;

  /**
   * Synchronously emit any buffered text that matches the chunking strategy
   * without waiting for the timer. Leaves partial/unmatched text in the
   * buffer.
   */
  flush(): void;

  /**
   * Synchronously drain *all* buffered text, including any partial remainder
   * that has not yet matched the chunking boundary. Stops the timer.
   */
  flushAll(): void;

  /**
   * Drop all queued text and stop the timer.
   * Use on handoff, error, or when abandoning the current response.
   */
  clear(): void;

  /**
   * Stop the internal timer without draining the buffer.
   * Queued text remains available for a subsequent `flush()` / `flushAll()`.
   */
  stop(): void;
}

// ---------------------------------------------------------------------------
// Chunking helpers
// ---------------------------------------------------------------------------

/**
 * Default word-boundary splitter. Splits text into runs of:
 * - whitespace
 * - alphanumeric / underscore runs (words)
 * - individual punctuation / symbol characters
 *
 * This provides a sub-word typewriter effect even when the upstream AI token
 * is a long multi-word string.
 */
function splitByWord(text: string): string[] {
  const matches = text.match(/\s+|[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g);
  return matches ?? [text];
}

/**
 * Line-boundary splitter. Emits complete lines (including trailing newline).
 * Leaves an incomplete trailing line in the buffer.
 */
function extractNextLine(buffer: string): string | null {
  const idx = buffer.indexOf('\n');
  if (idx === -1) return null;
  return buffer.slice(0, idx + 1);
}

/**
 * Regex-based extractor. Applies the regex to the start of the buffer and
 * returns the match, or null if nothing matches yet.
 */
function extractByRegex(buffer: string, re: RegExp): string | null {
  const m = buffer.match(re);
  if (!m || m.index === undefined) return null;
  // Only match from the start of the buffer to avoid skipping content
  if (m.index !== 0) return buffer.slice(0, m.index + m[0].length);
  return m[0];
}

/**
 * Intl.Segmenter-based extractor. Returns the first complete word segment,
 * or null if the buffer is too short for a boundary.
 */
function extractBySegmenter(
  buffer: string,
  segmenter: Intl.Segmenter,
): string | null {
  const segments = segmenter.segment(buffer);
  const iter = segments[Symbol.iterator]();

  const first = iter.next();
  if (first.done) return null;

  // We need at least two segments (current + boundary proof) to know the
  // first segment is complete, unless the buffer itself is tiny.
  const second = iter.next();
  if (second.done) {
    // Only one segment — could be incomplete. Wait for more unless the
    // caller flushes explicitly.
    return null;
  }

  return first.value.segment;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a text smoother that normalises the visual cadence of streamed
 * assistant text.
 *
 * ```ts
 * const smoother = createTextSmoother({
 *   onChunk: (chunk) => process.stdout.write(chunk),
 *   delayMs: 12,
 *   chunking: 'word',
 * });
 *
 * for await (const event of fullStream) {
 *   if (event.type === 'token') {
 *     smoother.push(event.delta);
 *   } else {
 *     smoother.flush();   // drain pending text before non-text events
 *     handleEvent(event); // tool-call, run-end, etc.
 *   }
 * }
 * smoother.flushAll(); // drain any remainder
 * ```
 */
export function createTextSmoother(options: TextSmootherOptions): TextSmoother {
  const { onChunk, chunking = 'word' } = options;
  const delayMs =
    options.delayMs === null || options.delayMs === 0
      ? 0
      : Math.max(1, options.delayMs ?? 12);

  // ---- internal state ----
  const queue: Array<{ segment: string; tokenCount: number }> = [];
  let timer: ReturnType<typeof setInterval> | null = null;

  // ---- chunking dispatch ----
  /**
   * Resolve the chunking strategy into a function that splits a string
   * of text into an array of display segments.
   *
   * For 'word' and Intl.Segmenter strategies we eagerly split the entire
   * incoming text into segments (like the original CLI smoother). For 'line',
   * RegExp, and custom functions we also eagerly split so the queue-based
   * drip mechanism works identically.
   */
  const splitText = buildSplitter(chunking);

  // ---- timer management ----
  function stopTimer(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  function flushNext(): void {
    const next = queue.shift();
    if (!next) {
      stopTimer();
      return;
    }
    onChunk(next.segment, next.tokenCount);
    if (queue.length === 0) {
      stopTimer();
    }
  }

  function ensureTimer(): void {
    if (timer !== null || queue.length === 0 || delayMs === 0) return;
    timer = setInterval(flushNext, delayMs);
  }

  // ---- public API ----
  return {
    push(text: string): void {
      if (!text) return;
      const segments = splitText(text);
      segments.forEach((segment, index) => {
        queue.push({ segment, tokenCount: index === 0 ? 1 : 0 });
      });
      if (delayMs === 0) {
        // Synchronous mode — emit immediately
        while (queue.length > 0) {
          flushNext();
        }
      } else {
        ensureTimer();
      }
    },

    flush(): void {
      while (queue.length > 0) {
        flushNext();
      }
    },

    flushAll(): void {
      while (queue.length > 0) {
        flushNext();
      }
    },

    clear(): void {
      queue.length = 0;
      stopTimer();
    },

    stop(): void {
      stopTimer();
    },
  };
}

// ---------------------------------------------------------------------------
// Async iterable transform — the proper fix for fast streams
// ---------------------------------------------------------------------------

/**
 * Options for {@link smoothStream}.
 */
export interface SmoothStreamOptions {
  /**
   * Delay in milliseconds between emitted display chunks.
   *
   * - `null` or `0` disables delays (chunks still split by strategy but emitted synchronously).
   * - Defaults to `10`.
   */
  delayMs?: number | null;

  /**
   * How incoming text is split into display-sized chunks.
   * Defaults to `'word'`.
   */
  chunking?: ChunkingStrategy;

  /**
   * Internal. For test use only. May change without notice.
   * Overrides the delay function for deterministic testing.
   */
  _delay?: (ms: number) => Promise<void>;
}

/**
 * Transform an `AsyncIterable<StreamEvent>` to smooth text output.
 *
 * This is the architecturally correct approach to text smoothing for
 * Fred's streaming pipeline. Unlike the timer-based {@link createTextSmoother},
 * this function transforms the async iterable itself, inserting real `await`
 * delays between word-level chunks. This ensures the event loop yields
 * between chunks regardless of how fast the upstream produces events.
 *
 * **How it works:**
 * - `token` events are buffered and split into display segments using the
 *   configured chunking strategy.
 * - Each segment is re-emitted as a synthetic `token` event with an
 *   `await delay()` between emissions.
 * - Non-token events flush the buffer immediately (no delay) and pass through.
 * - When the stream ends, any remaining buffer is flushed.
 *
 * Modelled after Vercel AI SDK's `smoothStream()` TransformStream approach,
 * adapted to Fred's `AsyncIterable<StreamEvent>` model.
 *
 * @example
 * ```ts
 * import { smoothStream } from '@fancyrobot/fred/stream';
 *
 * const smooth = smoothStream({ delayMs: 10, chunking: 'word' });
 * const smoothed = smooth(streamResult.fullStream);
 *
 * for await (const event of smoothed) {
 *   if (event.type === 'token') {
 *     process.stdout.write(event.delta);
 *   }
 * }
 * ```
 */
export function smoothStream(
  options: SmoothStreamOptions = {},
): <E extends { type: string; delta?: string }>(
  source: AsyncIterable<E>,
) => AsyncIterable<E> {
  const {
    delayMs: rawDelay = 10,
    chunking = 'word',
    _delay = defaultDelay,
  } = options;
  const delayMs =
    rawDelay === null || rawDelay === 0 ? 0 : Math.max(1, rawDelay);
  const splitText = buildSplitter(chunking);

  return <E extends { type: string; delta?: string }>(
    source: AsyncIterable<E>,
  ): AsyncIterable<E> => {
    async function* generate(): AsyncGenerator<E> {
      let buffer = '';
      let templateEvent: E | null = null;
      // Track the wall-clock time of the last token yield so we can
      // maintain consistent pacing *across* separate upstream token events,
      // not just within the segments of a single event.  When the upstream
      // is fast (burst), we add delays; when it's already slow (natural
      // network pacing), we don't add unnecessary extra latency.
      let lastTokenYieldMs = 0;

      for await (const event of source) {
        // Non-token events: flush any buffered text first, then pass through
        if (event.type !== 'token' || !event.delta) {
          if (buffer.length > 0 && templateEvent) {
            yield { ...templateEvent, delta: buffer } as E;
            lastTokenYieldMs = Date.now();
            buffer = '';
          }
          yield event;
          continue;
        }

        // Token event — buffer the delta text
        templateEvent = event;
        buffer += event.delta;

        // Split buffered text into display segments
        const segments = splitText(buffer);
        buffer = '';

        // Emit each segment as a synthetic token event with delays.
        // Delays are inserted before every yield *except the very first
        // token segment of the entire stream* (to preserve fast TTFT).
        // The delay is adaptive: if enough wall-clock time has already
        // elapsed since the last yield (e.g. natural network latency),
        // no extra delay is added.
        for (const segment of segments) {
          if (delayMs > 0 && lastTokenYieldMs > 0) {
            const elapsed = Date.now() - lastTokenYieldMs;
            if (elapsed < delayMs) {
              await _delay(delayMs - elapsed);
            }
          }
          yield { ...templateEvent, delta: segment } as E;
          lastTokenYieldMs = Date.now();
        }
      }

      // Flush any remaining buffer at end of stream
      if (buffer.length > 0 && templateEvent) {
        yield { ...templateEvent, delta: buffer } as E;
      }
    }

    return generate();
  };
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Splitter builders
// ---------------------------------------------------------------------------

/**
 * Build a `(text: string) => string[]` function from a {@link ChunkingStrategy}.
 *
 * All strategies produce an array of segments so the queue-based drip
 * mechanism works uniformly.
 */
function buildSplitter(
  chunking: ChunkingStrategy,
): (text: string) => string[] {
  if (chunking === 'word') {
    return splitByWord;
  }

  if (chunking === 'line') {
    return (text: string) => {
      const segments: string[] = [];
      let remaining = text;
      while (remaining.length > 0) {
        const line = extractNextLine(remaining);
        if (line === null) {
          // No more complete lines — emit the remainder as a single segment
          segments.push(remaining);
          break;
        }
        segments.push(line);
        remaining = remaining.slice(line.length);
      }
      return segments.length > 0 ? segments : [text];
    };
  }

  if (chunking instanceof RegExp) {
    return (text: string) => {
      const segments: string[] = [];
      let remaining = text;
      while (remaining.length > 0) {
        const chunk = extractByRegex(remaining, chunking);
        if (chunk === null) {
          segments.push(remaining);
          break;
        }
        segments.push(chunk);
        remaining = remaining.slice(chunk.length);
      }
      return segments.length > 0 ? segments : [text];
    };
  }

  if (
    typeof chunking === 'object' &&
    chunking !== null &&
    'segment' in chunking
  ) {
    // Intl.Segmenter
    const segmenter = chunking as Intl.Segmenter;
    return (text: string) => {
      const segments: string[] = [];
      let remaining = text;
      while (remaining.length > 0) {
        const seg = extractBySegmenter(remaining, segmenter);
        if (seg === null) {
          segments.push(remaining);
          break;
        }
        segments.push(seg);
        remaining = remaining.slice(seg.length);
      }
      return segments.length > 0 ? segments : [text];
    };
  }

  if (typeof chunking === 'function') {
    return (text: string) => {
      const segments: string[] = [];
      let remaining = text;
      while (remaining.length > 0) {
        const chunk = chunking(remaining);
        if (chunk === null || chunk === undefined || chunk === '') {
          segments.push(remaining);
          break;
        }
        segments.push(chunk);
        remaining = remaining.slice(chunk.length);
      }
      return segments.length > 0 ? segments : [text];
    };
  }

  // Fallback — should not be reachable with proper TS types
  return splitByWord;
}
