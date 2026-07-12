import { createFred } from '@fancyrobot/fred';
import '@fancyrobot/fred-openrouter';

type TraceEntry = {
  event: string;
  timestamp: number;
  data: Record<string, unknown>;
};

function toMessageLength(payload: unknown): number {
  if (typeof payload === 'string') {
    return payload.length;
  }

  if (payload && typeof payload === 'object' && 'message' in payload) {
    const message = (payload as { message?: unknown }).message;
    return typeof message === 'string' ? message.length : 0;
  }

  return 0;
}

async function main() {
  const fred = await createFred({ configPath: './config.yaml' });

  const traceLog: TraceEntry[] = [];

  await fred.hooks.register('beforeMessageReceived', async (event) => {
    traceLog.push({
      event: 'message.received',
      timestamp: Date.now(),
      data: { messageLength: toMessageLength(event.data) },
    });
  });

  await fred.hooks.register('afterRouting', async (event) => {
    traceLog.push({
      event: 'routing.complete',
      timestamp: Date.now(),
      data: {
        agentId: (event.data as { agentId?: string } | undefined)?.agentId,
      },
    });
  });

  await fred.hooks.register('afterToolCalled', async (event) => {
    const payload = event.data as { toolId?: string; duration?: number } | undefined;
    traceLog.push({
      event: 'tool.called',
      timestamp: Date.now(),
      data: {
        toolId: payload?.toolId,
        durationMs: payload?.duration,
      },
    });
  });

  await fred.hooks.register('afterResponseGenerated', async (event) => {
    const response = (event.data as { content?: unknown } | string | undefined);
    const responseText = typeof response === 'string'
      ? response
      : typeof response?.content === 'string'
        ? response.content
        : '';

    traceLog.push({
      event: 'response.generated',
      timestamp: Date.now(),
      data: { responseLength: responseText.length },
    });
  });

  console.log('=== Observability & Tracing Demo ===\n');
  const response = await fred.messages.process('What is 2 + 2?');
  console.log('Response:', response?.content);

  console.log('\n--- Trace Log ---');
  for (const entry of traceLog) {
    console.log(`[${entry.event}] ${new Date(entry.timestamp).toISOString()} ${JSON.stringify(entry.data)}`);
  }

  await fred.shutdown();
}

main().catch((error) => {
  console.error('Example failed:', error);
  process.exitCode = 1;
});

// Optional: Full OpenTelemetry integration for production runtimes
//
// import { Layer } from 'effect';
// import { buildObservabilityLayers } from '@fancyrobot/fred';
//
// const { tracerLayer, loggerLayer } = buildObservabilityLayers({
//   otlp: {
//     endpoint: 'http://localhost:4318/v1/traces',
//   },
//   logLevel: 'info',
//   resource: {
//     serviceName: 'fred-example-08',
//     serviceVersion: '0.3.0',
//     environment: 'development',
//   },
//   enableConsoleFallback: true,
// });
//
// const observabilityLayer = Layer.mergeAll(tracerLayer, loggerLayer);
//
// Then provide the layer when running Effect programs inside your app shell.
