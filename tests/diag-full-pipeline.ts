import { Effect, Stream, Chunk } from 'effect';
import { smoothStream } from '../packages/core/src/stream/smooth-text';
import type { StreamEvent, TokenEvent } from '../packages/core/src/stream/events';

// Simulate the FULL pipeline: Effect Stream → StreamResult.fullStream → smooth stream

async function testFullPipeline() {
  const events: Array<{ type: string; time: number; delta?: string }> = [];
  const start = Date.now();
  
  // Create Effect Stream that simulates multi-step agent behavior
  // Step 0: tool-call (immediate), tool execution (simulated delay), tool-result
  // Step 1: ALL text tokens arrive at once (burst from model)
  const effectStream: Stream.Stream<StreamEvent, Error> = Stream.concat(
    // Step 0: tool call flow
    Stream.fromIterable([
      { type: 'run-start', sequence: 0, emittedAt: Date.now(), runId: 'test', startedAt: Date.now(), input: { message: 'test', previousMessages: [] } },
      { type: 'step-start', sequence: 1, emittedAt: Date.now(), runId: 'test', stepIndex: 0 },
      { type: 'tool-call', sequence: 2, emittedAt: Date.now(), runId: 'test', messageId: 'msg1', step: 0, toolCallId: 'tc1', toolName: 'run_research_swarm', input: { question: 'test' }, startedAt: Date.now() },
    ] as StreamEvent[]),
    Stream.concat(
      // Simulate tool execution delay (500ms)
      Stream.fromEffect(Effect.delay(Effect.succeed({
        type: 'tool-result', sequence: 3, emittedAt: Date.now(), runId: 'test', messageId: 'msg1', step: 0, toolCallId: 'tc1', toolName: 'run_research_swarm', output: 'Research report here...', completedAt: Date.now(), durationMs: 500
      } as StreamEvent), '100 millis')),
      Stream.concat(
        Stream.fromIterable([
          { type: 'step-end', sequence: 4, emittedAt: Date.now(), runId: 'test', stepIndex: 0 },
          { type: 'step-start', sequence: 5, emittedAt: Date.now(), runId: 'test', stepIndex: 1 },
        ] as StreamEvent[]),
        // Step 1: ALL text arrives at once (burst - simulates non-streaming model)
        Stream.concat(
          Stream.fromIterable([
            { type: 'token', sequence: 6, emittedAt: Date.now(), runId: 'test', messageId: 'msg1', step: 1, delta: 'Based on the research, here are my findings. The analysis shows several key insights about this topic.', accumulated: 'Based on the research, here are my findings. The analysis shows several key insights about this topic.' } as StreamEvent,
            { type: 'step-end', sequence: 7, emittedAt: Date.now(), runId: 'test', stepIndex: 1 },
          ] as StreamEvent[]),
          Stream.fromIterable([
            { type: 'run-end', sequence: 8, emittedAt: Date.now(), runId: 'test', finishedAt: Date.now(), durationMs: 600, result: { content: 'Based on the research, here are my findings. The analysis shows several key insights about this topic.', toolCalls: [] } },
          ] as StreamEvent[])
        )
      )
    )
  );

  // Convert Effect Stream to AsyncIterable (same as StreamResult.fullStream)
  const asyncIter = Stream.toAsyncIterable(effectStream);
  
  // Apply smooth stream (same as chat command does)
  const smooth = smoothStream({ delayMs: 12, chunking: 'word' });
  const displayStream = smooth(asyncIter as AsyncIterable<StreamEvent & { delta?: string }>);
  
  for await (const event of displayStream) {
    const e = event as StreamEvent & { delta?: string };
    events.push({ type: e.type, time: Date.now() - start, delta: e.delta?.slice(0, 30) });
  }
  
  console.log('\n=== Full Pipeline Test ===');
  for (const e of events) {
    console.log(`  +${String(e.time).padStart(5)}ms  ${e.type}${e.delta ? ` "${e.delta}"` : ''}`);
  }
  
  const tokenEvents = events.filter(e => e.type === 'token');
  console.log(`\nToken segments: ${tokenEvents.length}`);
  
  if (tokenEvents.length > 1) {
    const firstTime = tokenEvents[0].time;
    const lastTime = tokenEvents[tokenEvents.length - 1].time;
    const span = lastTime - firstTime;
    console.log(`Time span: ${span}ms (first: ${firstTime}ms, last: ${lastTime}ms)`);
    console.log(`RESULT: ${span > 50 ? 'PASS' : 'FAIL - tokens bunched'}`);
  } else if (tokenEvents.length === 1) {
    console.log('WARN: Only 1 token event - smooth stream should have split it');
    console.log(`RESULT: FAIL - no splitting occurred`);
  } else {
    console.log('RESULT: FAIL - no token events at all');
  }
}

testFullPipeline().catch(console.error);
