import { smoothStream } from '../packages/core/src/stream/smooth-text';

async function testBurstStreaming() {
  const events: Array<{ type: string; time: number; delta?: string }> = [];
  const start = Date.now();
  
  // ALL events arrive at once (simulating burst from non-streaming model)
  const burstStream: AsyncIterable<{ type: string; delta?: string }> = {
    async *[Symbol.asyncIterator]() {
      yield { type: 'step-start' };
      yield { type: 'tool-call' };
      yield { type: 'tool-result' };
      yield { type: 'step-end' };
      yield { type: 'step-start' };
      // ONE big token event (entire response at once)
      yield { type: 'token', delta: 'Here is my complete research report. It contains multiple sentences with detailed findings about the topic you asked about.' };
      yield { type: 'step-end' };
      yield { type: 'run-end' };
    }
  };

  const smooth = smoothStream({ delayMs: 12, chunking: 'word' });
  const displayStream = smooth(burstStream);
  
  for await (const event of displayStream) {
    const e = event as { type: string; delta?: string };
    events.push({ type: e.type, time: Date.now() - start, delta: e.delta?.slice(0, 30) });
  }
  
  console.log('\n=== Burst Test: Event Timing ===');
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
    console.log(`RESULT: ${span > 50 ? 'PASS - smooth stream is working' : 'FAIL - tokens still bunched together'}`);
  } else {
    console.log('RESULT: FAIL - only one token segment (no splitting)');
  }
}

testBurstStreaming().catch(console.error);
