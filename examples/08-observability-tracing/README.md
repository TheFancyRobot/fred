# 08 - Observability: Tracing & Monitoring

Learn how to instrument Fred applications with lightweight hook-based tracing first, then scale up to full OpenTelemetry (OTEL) when you need production telemetry pipelines. The assistant prompt is loaded from `agents/assistant.md` and demonstrates ETA expressions with environment-aware behavior.

## What You'll Learn

- Hook-based tracing with structured event logs
- Capturing message, routing, tool, and response lifecycle events
- Organizing trace data for quick debugging
- Optional OTEL layer wiring for production-grade telemetry
- ETA expressions like `<%= agent.model %>` for prompt self-awareness
- Env-allowlisted template access (`env.NODE_ENV`) for environment-specific instructions

## Prerequisites

- Bun installed
- `OPENROUTER_API_KEY` set in `.env`

```bash
cp .env.example .env
```

## Run

```bash
bun run src/index.ts
```

Expected output includes:

- A model response
- A trace log with structured events such as `message.received`, `routing.complete`, `tool.called`, and `response.generated`

## Lightweight Tracing (Hooks)

This example uses Fred hooks as the first observability layer:

- `beforeMessageReceived` for ingress metadata
- `afterRouting` for route selection context
- `afterToolCalled` for tool timing
- `afterResponseGenerated` for output diagnostics

This is the fastest way to add visibility without external infrastructure.

## ETA Prompt Features

`agents/assistant.md` renders metadata and environment context at runtime:

- `<%= agent.id %>` and `<%= agent.model %>` expose resolved agent config
- `<% if (env.NODE_ENV === 'development') { %>` adds diagnostics guidance only in development
- `config.yaml` uses `template.envAllowlist` to explicitly permit `NODE_ENV`

## Full OTEL Integration (Optional)

Fred exports `buildObservabilityLayers()` so you can attach an OTEL tracer exporter and structured logger for centralized telemetry collection.

Example collector endpoint config:

```ts
import { buildObservabilityLayers } from '@fancyrobot/fred';

const { tracerLayer, loggerLayer } = buildObservabilityLayers({
  otlp: {
    endpoint: 'http://localhost:4318/v1/traces',
  },
  logLevel: 'info',
  resource: {
    serviceName: 'fred-example-08',
    serviceVersion: '0.3.0',
    environment: 'development',
  },
  enableConsoleFallback: true,
});
```

You can run an OTEL collector locally and send traces to your backend of choice (Jaeger, Tempo, Honeycomb, Datadog, etc.).
