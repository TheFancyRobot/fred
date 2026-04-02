import { describe, expect, test, afterEach } from 'bun:test';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  createTextSmoother,
  smoothStream,
  type TextSmoother,
  type TextSmootherOptions,
} from '../../../../packages/core/src/stream/smooth-text';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all chunks emitted by pushing `inputs` into a smoother. */
async function collectChunks(
  inputs: string[],
  opts?: Partial<Omit<TextSmootherOptions, 'onChunk'>>,
): Promise<Array<{ chunk: string; tokenCount: number | undefined }>> {
  const collected: Array<{ chunk: string; tokenCount: number | undefined }> = [];
  const smoother = createTextSmoother({
    onChunk: (chunk, tokenCount) => {
      collected.push({ chunk, tokenCount });
    },
    delayMs: 1,
    ...opts,
  });

  for (const input of inputs) {
    smoother.push(input);
  }

  // Let a few timer ticks fire
  await sleep(10);
  smoother.flushAll();
  smoother.stop();
  return collected;
}

/** Convenience: join all collected chunks into a single string. */
function joinChunks(
  collected: Array<{ chunk: string; tokenCount?: number }>,
): string {
  return collected.map((c) => c.chunk).join('');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createTextSmoother', () => {
  // Track smoother instances for cleanup
  const smoothers: TextSmoother[] = [];
  const makeSmoother = (opts: TextSmootherOptions): TextSmoother => {
    const s = createTextSmoother(opts);
    smoothers.push(s);
    return s;
  };

  afterEach(() => {
    for (const s of smoothers) {
      s.clear();
    }
    smoothers.length = 0;
  });

  // ----- Core behaviour -----

  describe('word chunking (default)', () => {
    test('one large chunk becomes multiple visible chunks', async () => {
      const chunks = await collectChunks(['hello world']);

      expect(chunks.length).toBeGreaterThan(1);
      expect(joinChunks(chunks)).toBe('hello world');
    });

    test('many small chunks preserve exact final text', async () => {
      const chunks = await collectChunks(['H', 'e', 'l', 'l', 'o']);

      expect(joinChunks(chunks)).toBe('Hello');
    });

    test('fine and coarse chunking produce identical joined output', async () => {
      const fine = await collectChunks(['Hello', ' ', 'world']);
      const coarse = await collectChunks(['Hello world']);

      expect(joinChunks(fine)).toBe('Hello world');
      expect(joinChunks(coarse)).toBe('Hello world');
    });

    test('coarse input is split into multiple display segments', async () => {
      const coarse = await collectChunks(['Hello world']);

      // "hello" + " " + "world" at minimum
      expect(coarse.length).toBeGreaterThan(1);
    });

    test('empty string push is a no-op', async () => {
      const chunks = await collectChunks(['']);

      expect(chunks).toHaveLength(0);
    });

    test('punctuation is split into individual segments', async () => {
      const chunks = await collectChunks(['hello, world!']);

      const text = joinChunks(chunks);
      expect(text).toBe('hello, world!');
      // comma and exclamation are separate segments
      expect(chunks.length).toBeGreaterThanOrEqual(4);
    });

    test('whitespace-only input is preserved', async () => {
      const chunks = await collectChunks(['   ']);

      expect(joinChunks(chunks)).toBe('   ');
    });

    test('multi-line input is fully preserved', async () => {
      const input = 'line one\nline two\nline three';
      const chunks = await collectChunks([input]);

      expect(joinChunks(chunks)).toBe(input);
    });
  });

  // ----- Token counting -----

  describe('token accounting', () => {
    test('first segment of each push gets tokenCount=1', async () => {
      const chunks = await collectChunks(['hello world']);

      expect(chunks[0]?.tokenCount).toBe(1);
    });

    test('subsequent segments of same push get tokenCount=0', async () => {
      const chunks = await collectChunks(['hello world']);

      // At least the second segment should have tokenCount=0
      const subsequent = chunks.slice(1);
      expect(subsequent.length).toBeGreaterThan(0);
      for (const c of subsequent) {
        expect(c.tokenCount).toBe(0);
      }
    });

    test('each separate push starts a new token count', async () => {
      const collected: Array<{ chunk: string; tokenCount: number | undefined }> = [];
      const smoother = makeSmoother({
        onChunk: (chunk, tokenCount) => {
          collected.push({ chunk, tokenCount });
        },
        delayMs: 0, // synchronous mode for determinism
        chunking: 'word',
      });

      smoother.push('hello');
      smoother.push('world');
      smoother.flushAll();

      // Each push's first segment should have tokenCount=1
      const tokenStarts = collected.filter((c) => c.tokenCount === 1);
      expect(tokenStarts.length).toBe(2);
    });
  });

  // ----- flushAll -----

  describe('flushAll', () => {
    test('drains all remaining content synchronously', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 50,
      });

      smoother.push('stream this now');
      smoother.flushAll();

      expect(pushed.join('')).toBe('stream this now');
      expect(pushed.length).toBeGreaterThan(1);
    });

    test('is safe to call when queue is empty', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 10,
      });

      // No push, just flush
      smoother.flushAll();
      expect(pushed).toHaveLength(0);
    });

    test('stops the timer after draining', async () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 5,
      });

      smoother.push('abc');
      smoother.flushAll();
      const countAfterFlush = pushed.length;

      // Wait to ensure no more timer ticks fire
      await sleep(20);
      expect(pushed.length).toBe(countAfterFlush);
    });
  });

  // ----- clear -----

  describe('clear', () => {
    test('drops queued content', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 50,
      });

      smoother.push('this should be dropped');
      smoother.clear();
      smoother.flushAll();

      expect(pushed).toHaveLength(0);
    });

    test('stops the timer', async () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 5,
      });

      smoother.push('queued text');
      smoother.clear();

      await sleep(20);
      expect(pushed).toHaveLength(0);
    });
  });

  // ----- stop -----

  describe('stop', () => {
    test('cancels the timer without draining', async () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 5,
      });

      smoother.push('hello world foo bar baz');
      smoother.stop();

      const countAtStop = pushed.length;
      await sleep(20);

      // No additional chunks should have been emitted
      expect(pushed.length).toBe(countAtStop);
    });

    test('queued content is still available after stop + flush', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 50,
      });

      smoother.push('saved');
      smoother.stop();
      smoother.flushAll();

      expect(pushed.join('')).toBe('saved');
    });
  });

  // ----- flush (non-draining) -----

  describe('flush', () => {
    test('drains currently queued segments', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 50,
      });

      smoother.push('hello world');
      smoother.flush();

      expect(pushed.join('')).toBe('hello world');
    });
  });

  // ----- Synchronous mode (delayMs: 0) -----

  describe('synchronous mode (delayMs: 0)', () => {
    test('emits chunks immediately on push', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 0,
      });

      smoother.push('instant output');

      expect(pushed.join('')).toBe('instant output');
      expect(pushed.length).toBeGreaterThan(1);
    });

    test('null delayMs also activates synchronous mode', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: null,
      });

      smoother.push('also instant');

      expect(pushed.join('')).toBe('also instant');
    });
  });

  // ----- Line chunking -----

  describe('line chunking', () => {
    test('splits on newline boundaries', async () => {
      const chunks = await collectChunks(
        ['line one\nline two\nline three'],
        { chunking: 'line' },
      );

      const text = joinChunks(chunks);
      expect(text).toBe('line one\nline two\nline three');
    });

    test('each complete line is a separate segment', async () => {
      const chunks = await collectChunks(
        ['first\nsecond\n'],
        { chunking: 'line' },
      );

      const texts = chunks.map((c) => c.chunk);
      expect(texts).toContain('first\n');
      expect(texts).toContain('second\n');
    });

    test('incomplete trailing line is emitted as remainder', async () => {
      const chunks = await collectChunks(
        ['complete\nincomplete'],
        { chunking: 'line' },
      );

      const texts = chunks.map((c) => c.chunk);
      expect(texts).toContain('complete\n');
      expect(texts).toContain('incomplete');
    });
  });

  // ----- Regex chunking -----

  describe('regex chunking', () => {
    test('splits on custom regex pattern', async () => {
      // Split on sentence boundaries (period + space)
      const chunks = await collectChunks(
        ['Hello there. How are you. Fine thanks.'],
        { chunking: /^[^.]*\.\s?/ },
      );

      const text = joinChunks(chunks);
      expect(text).toBe('Hello there. How are you. Fine thanks.');
    });

    test('unmatched remainder is emitted as final chunk', async () => {
      const chunks = await collectChunks(
        ['match. no-match-here'],
        { chunking: /^[^.]*\.\s?/ },
      );

      const text = joinChunks(chunks);
      expect(text).toBe('match. no-match-here');
      expect(chunks.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ----- Custom function chunking -----

  describe('custom function chunking', () => {
    test('uses custom extractor function', async () => {
      // Extract exactly 3 characters at a time
      const chunks = await collectChunks(
        ['abcdefgh'],
        {
          chunking: (buffer) => {
            if (buffer.length >= 3) return buffer.slice(0, 3);
            return null;
          },
        },
      );

      const text = joinChunks(chunks);
      expect(text).toBe('abcdefgh');
      // "abc" + "def" + "gh" (remainder)
      expect(chunks.length).toBe(3);
    });

    test('null return means wait for more input', async () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 0,
        chunking: (buffer) => {
          if (buffer.length >= 5) return buffer.slice(0, 5);
          return null; // wait for more
        },
      });

      // First push is too short — remainder emitted as-is
      smoother.push('ab');
      expect(pushed.join('')).toBe('ab');

      // Second push reaches threshold
      smoother.push('cdefghij');
      expect(pushed.join('')).toBe('abcdefghij');
    });
  });

  // ----- Intl.Segmenter chunking -----

  describe('Intl.Segmenter chunking', () => {
    // Intl.Segmenter is available in Bun at runtime but may not be in TS lib types
    const SegmenterCtor = (Intl as any).Segmenter as {
      new (locale: string, opts: { granularity: string }): any;
    };

    test('segments text using word segmenter', async () => {
      const segmenter = new SegmenterCtor('en', { granularity: 'word' });
      const chunks = await collectChunks(
        ['Hello beautiful world'],
        { chunking: segmenter },
      );

      const text = joinChunks(chunks);
      expect(text).toBe('Hello beautiful world');
      // Should split into individual words and spaces
      expect(chunks.length).toBeGreaterThan(1);
    });

    test('handles CJK text', async () => {
      const segmenter = new SegmenterCtor('ja', { granularity: 'word' });
      const input = '\u3053\u3093\u306B\u3061\u306F\u4E16\u754C';
      const chunks = await collectChunks(
        [input],
        { chunking: segmenter },
      );

      const text = joinChunks(chunks);
      expect(text).toBe(input);
    });
  });

  // ----- Cross-provider simulation -----

  describe('provider-agnostic behaviour', () => {
    test('OpenAI-style fine-grained tokens produce same output as coarse chunks', async () => {
      // OpenAI typically sends small word-sized tokens
      const openaiStyle = await collectChunks([
        'The', ' ', 'quick', ' ', 'brown', ' ', 'fox',
      ]);

      // OpenRouter/some providers may send larger chunks
      const openrouterStyle = await collectChunks([
        'The quick brown fox',
      ]);

      expect(joinChunks(openaiStyle)).toBe('The quick brown fox');
      expect(joinChunks(openrouterStyle)).toBe('The quick brown fox');
    });

    test('single large delta is still split for incremental display', async () => {
      // Simulate OpenRouter sending one big chunk
      const chunks = await collectChunks([
        'This is a long response that arrives all at once from the provider instead of being streamed token by token.',
      ]);

      expect(chunks.length).toBeGreaterThan(5);
      expect(joinChunks(chunks)).toBe(
        'This is a long response that arrives all at once from the provider instead of being streamed token by token.',
      );
    });

    test('mixed small and large chunks preserve text integrity', async () => {
      const chunks = await collectChunks([
        'I', // tiny
        ' think the answer is 42.', // large
        ' ', // whitespace
        'Yes,', // medium
        ' definitely.', // medium
      ]);

      expect(joinChunks(chunks)).toBe(
        'I think the answer is 42. Yes, definitely.',
      );
    });
  });

  // ----- Edge cases -----

  describe('edge cases', () => {
    test('rapid successive pushes do not lose text', async () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 1,
      });

      for (let i = 0; i < 100; i++) {
        smoother.push(`w${i} `);
      }

      await sleep(15);
      smoother.flushAll();

      const result = pushed.join('');
      for (let i = 0; i < 100; i++) {
        expect(result).toContain(`w${i}`);
      }
    });

    test('unicode characters are preserved', async () => {
      const input = 'Hello \uD83C\uDF0D\u2014 caf\u00E9 \u2603\uFE0F';
      const chunks = await collectChunks([input]);

      expect(joinChunks(chunks)).toBe(input);
    });

    test('very long single word is emitted as one segment', async () => {
      const longWord = 'supercalifragilisticexpialidocious';
      const chunks = await collectChunks([longWord]);

      expect(joinChunks(chunks)).toBe(longWord);
      // A single word with no spaces/punctuation should be one segment
      expect(chunks.length).toBe(1);
    });

    test('multiple flushAll calls are idempotent', () => {
      const pushed: string[] = [];
      const smoother = makeSmoother({
        onChunk: (chunk) => pushed.push(chunk),
        delayMs: 50,
      });

      smoother.push('data');
      smoother.flushAll();
      const first = pushed.join('');

      smoother.flushAll();
      smoother.flushAll();
      const second = pushed.join('');

      expect(first).toBe(second);
    });
  });
});

// ---------------------------------------------------------------------------
// smoothStream — async iterable transform tests
// ---------------------------------------------------------------------------

/** Helper: create a mock async iterable from an array of events */
async function* asyncFrom<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

/** Helper: collect all items from an async iterable into an array */
async function collectAsync<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) {
    result.push(item);
  }
  return result;
}

/** Helper: create a token event */
function token(delta: string, extra?: Record<string, unknown>) {
  return { type: 'token' as const, delta, sequence: 1, ...extra };
}

/** Helper: create a non-token event */
function nonToken(type: string, extra?: Record<string, unknown>) {
  return { type, ...extra };
}

describe('smoothStream', () => {
  // Use a no-op delay for deterministic tests
  const noDelay = async (_ms: number) => {};

  describe('basic smoothing', () => {
    test('splits token deltas into word-level segments', async () => {
      const events = [token('Hello world!')];
      const transform = smoothStream({ delayMs: 10, _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      // "Hello world!" splits into: "Hello", " ", "world", "!"
      const deltas = result.filter(e => e.type === 'token').map(e => e.delta);
      expect(deltas.join('')).toBe('Hello world!');
      expect(deltas.length).toBeGreaterThan(1);
    });

    test('passes non-token events through unchanged', async () => {
      const events = [
        nonToken('run-start', { runId: '1' }),
        token('Hello'),
        nonToken('run-end', { runId: '1' }),
      ];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const types = result.map(e => e.type);
      expect(types[0]).toBe('run-start');
      expect(types[types.length - 1]).toBe('run-end');
    });

    test('preserves total text content across multiple tokens', async () => {
      const events = [
        token('The quick '),
        token('brown fox '),
        token('jumps over the lazy dog.'),
      ];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const fullText = result
        .filter(e => e.type === 'token')
        .map(e => e.delta)
        .join('');
      expect(fullText).toBe('The quick brown fox jumps over the lazy dog.');
    });

    test('empty token deltas are passed through', async () => {
      const events = [token('')];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      // Empty delta token events pass through as non-smoothable (delta is falsy)
      expect(result.length).toBe(1);
      expect(result[0].type).toBe('token');
    });
  });

  describe('delay behavior', () => {
    test('calls _delay between segments', async () => {
      let delayCalls = 0;
      const countingDelay = async (_ms: number) => { delayCalls += 1; };
      const events = [token('Hello world test')];
      const transform = smoothStream({ delayMs: 10, _delay: countingDelay });
      await collectAsync(transform(asyncFrom(events)));

      // "Hello" " " "world" " " "test" = 5 segments, 4 delays between them
      expect(delayCalls).toBe(4);
    });

    test('no delay when delayMs is 0', async () => {
      let delayCalls = 0;
      const countingDelay = async (_ms: number) => { delayCalls += 1; };
      const events = [token('Hello world')];
      const transform = smoothStream({ delayMs: 0, _delay: countingDelay });
      await collectAsync(transform(asyncFrom(events)));

      expect(delayCalls).toBe(0);
    });

    test('no delay when delayMs is null', async () => {
      let delayCalls = 0;
      const countingDelay = async (_ms: number) => { delayCalls += 1; };
      const events = [token('Hello world')];
      const transform = smoothStream({ delayMs: null, _delay: countingDelay });
      await collectAsync(transform(asyncFrom(events)));

      expect(delayCalls).toBe(0);
    });

    test('passes configured delay value to _delay function', async () => {
      const delayValues: number[] = [];
      const trackDelay = async (ms: number) => { delayValues.push(ms); };
      const events = [token('A B')];
      const transform = smoothStream({ delayMs: 42, _delay: trackDelay });
      await collectAsync(transform(asyncFrom(events)));

      expect(delayValues.every(v => v === 42)).toBe(true);
    });
  });

  describe('non-token event ordering', () => {
    test('flushes buffered text before non-token events', async () => {
      const events = [
        token('Hello'),
        nonToken('tool-call', { toolName: 'calc' }),
      ];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      // Token segments should come before the tool-call
      const toolCallIdx = result.findIndex(e => e.type === 'tool-call');
      const lastTokenIdx = result.map((e, i) => e.type === 'token' ? i : -1)
        .filter(i => i >= 0)
        .pop()!;
      expect(lastTokenIdx).toBeLessThan(toolCallIdx);
    });

    test('interleaves token and non-token events correctly', async () => {
      const events = [
        token('Part 1 '),
        nonToken('usage', { inputTokens: 5 }),
        token('Part 2'),
        nonToken('run-end'),
      ];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const types = result.map(e => e.type);
      // Usage should appear after Part 1 tokens, before Part 2 tokens
      const usageIdx = types.indexOf('usage');
      const runEndIdx = types.indexOf('run-end');
      expect(usageIdx).toBeGreaterThan(0);
      expect(runEndIdx).toBe(types.length - 1);
    });
  });

  describe('chunking strategies', () => {
    test('line chunking splits on newlines', async () => {
      const events = [token('line one\nline two\n')];
      const transform = smoothStream({ chunking: 'line', _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const deltas = result.filter(e => e.type === 'token').map(e => e.delta);
      expect(deltas.join('')).toBe('line one\nline two\n');
      // Should have at least 2 segments (one per line)
      expect(deltas.length).toBeGreaterThanOrEqual(2);
    });

    test('regex chunking uses custom pattern', async () => {
      const events = [token('abc123def456')];
      const transform = smoothStream({
        chunking: /[a-z]+\d+/,
        _delay: noDelay,
      });
      const result = await collectAsync(transform(asyncFrom(events)));

      const deltas = result.filter(e => e.type === 'token').map(e => e.delta);
      expect(deltas.join('')).toBe('abc123def456');
    });

    test('custom function chunking', async () => {
      // Chunk by 3 characters at a time
      const chunker = (buf: string) => buf.length >= 3 ? buf.slice(0, 3) : null;
      const events = [token('abcdef')];
      const transform = smoothStream({ chunking: chunker, _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const deltas = result.filter(e => e.type === 'token').map(e => e.delta);
      expect(deltas.join('')).toBe('abcdef');
      // "abc" "def" = 2 segments
      expect(deltas.length).toBe(2);
    });
  });

  describe('event properties', () => {
    test('preserves extra properties on token events', async () => {
      const events = [token('Hello world', { messageId: 'm1', step: 3 })];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const tokens = result.filter(e => e.type === 'token');
      for (const t of tokens) {
        expect((t as any).messageId).toBe('m1');
        expect((t as any).step).toBe(3);
      }
    });

    test('uses latest token event as template for synthetic events', async () => {
      const events = [
        token('Hello ', { messageId: 'm1', step: 1 }),
        token('world', { messageId: 'm2', step: 2 }),
      ];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      // The "world" token should use m2/step:2 as template
      const tokens = result.filter(e => e.type === 'token');
      const lastToken = tokens[tokens.length - 1];
      expect((lastToken as any).messageId).toBe('m2');
    });
  });

  describe('edge cases', () => {
    test('handles empty stream', async () => {
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom([])));
      expect(result).toEqual([]);
    });

    test('handles stream with only non-token events', async () => {
      const events = [
        nonToken('run-start'),
        nonToken('run-end'),
      ];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));
      expect(result.length).toBe(2);
      expect(result[0].type).toBe('run-start');
      expect(result[1].type).toBe('run-end');
    });

    test('handles single-character tokens', async () => {
      const events = [token('a'), token('b'), token('c')];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const text = result.filter(e => e.type === 'token').map(e => e.delta).join('');
      expect(text).toBe('abc');
    });

    test('handles large token with many words', async () => {
      const bigText = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
      const events = [token(bigText)];
      const transform = smoothStream({ _delay: noDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const text = result.filter(e => e.type === 'token').map(e => e.delta).join('');
      expect(text).toBe(bigText);
      // Should have significantly more than 1 segment
      expect(result.filter(e => e.type === 'token').length).toBeGreaterThan(10);
    });

    test('rapid stream produces incremental output with delays', async () => {
      // This is THE key test: verifies that even when all events arrive
      // instantly (simulating a fast provider), the output is still
      // delivered incrementally with delays between segments.
      const delayCount = { value: 0 };
      const trackingDelay = async (_ms: number) => { delayCount.value += 1; };

      // Simulate a fast provider dumping 20 tokens at once
      const events = Array.from({ length: 20 }, (_, i) =>
        token(`word${i} `)
      );
      const transform = smoothStream({ delayMs: 10, _delay: trackingDelay });
      const result = await collectAsync(transform(asyncFrom(events)));

      const text = result.filter(e => e.type === 'token').map(e => e.delta).join('');
      const expected = Array.from({ length: 20 }, (_, i) => `word${i} `).join('');
      expect(text).toBe(expected);

      // The critical assertion: delays were actually called between segments.
      // With the old timer-based approach, delay count would be 0 for fast streams.
      // Each "word0 " splits into ["word0", " "] = 2 segments, so 1 delay per token event.
      // 20 tokens * 1 delay each = 20 delays minimum.
      expect(delayCount.value).toBeGreaterThan(0);
      expect(delayCount.value).toBeGreaterThanOrEqual(20);
    });
  });
});
