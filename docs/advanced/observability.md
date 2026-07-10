# Observability & Tracing

Fred provides comprehensive observability through a lightweight tracing system that can optionally integrate with OpenTelemetry.

## Overview

The tracing system instruments the entire message processing pipeline, including:

- **Routing**: Agent utterance matching and intent matching
- **Agent Selection**: Which agent was selected and why
- **Model Calls**: AI model invocations with timing and token usage
- **Tool Execution**: Tool calls with arguments, results, and timing
- **Agent Handoffs**: Transfers between agents with context
- **Hook Execution**: Pipeline hook invocations

## Basic Usage

Tracing is **opt-in** and disabled by default for zero overhead when not needed.

### Enable Tracing

```typescript
import { Fred } from 'fred';
import { NoOpTracer } from 'fred/core/tracing';

const fred = new Fred();

// Enable tracing with default no-op tracer (zero overhead)
fred.enableTracing();

// Or pass a custom tracer
fred.enableTracing(customTracer);
```

### Using with processMessage

Tracing automatically captures spans when processing messages:

```typescript
const response = await fred.processMessage('Hello, world!');
// Spans are automatically created for:
// - processMessage (root span)
// - routing
// - agent.process
// - model.call
// - tool.execute (if tools are called)
// - agent.handoff (if handoffs occur)
```

## OpenTelemetry Integration

Fred can export traces to OpenTelemetry for integration with observability platforms.

### Installation

```bash
npm install @opentelemetry/api
```

### Using OpenTelemetry Tracer

```typescript
import { Fred } from 'fred';
import { createOpenTelemetryTracer } from 'fred/core/tracing/otel-exporter';

// Check if OpenTelemetry is available
if (isOpenTelemetryAvailable()) {
  const otelTracer = createOpenTelemetryTracer();
  if (otelTracer) {
    fred.enableTracing(otelTracer);
  }
}
```

### Full OpenTelemetry Setup

For a complete OpenTelemetry setup, you'll need to configure exporters:

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const sdk = new NodeSDK({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'fred-app',
  }),
  traceExporter: new OTLPTraceExporter({
    url: 'http://localhost:4318/v1/traces',
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

// Then use Fred with OpenTelemetry
const otelTracer = createOpenTelemetryTracer();
fred.enableTracing(otelTracer);
```

## Span Attributes

Spans include rich attributes for debugging and analysis:

### Routing Spans

- `routing.method`: `agent.utterance` | `intent.matching` | `default.agent`
- `routing.agentId`: Selected agent ID
- `routing.confidence`: Match confidence (0-1)
- `routing.matchType`: `exact` | `regex` | `semantic`

### Model Call Spans

- `agent.id`: Agent ID
- `model.name`: Model identifier
- `model.platform`: AI platform
- `model.temperature`: Temperature setting
- `response.length`: Response text length
- `response.finishReason`: Finish reason
- `usage.promptTokens`: Prompt tokens used
- `usage.completionTokens`: Completion tokens used
- `usage.totalTokens`: Total tokens used

### Tool Execution Spans

- `tool.id`: Tool identifier
- `tool.name`: Tool name
- `tool.args`: Tool arguments (JSON stringified)
- `tool.result.type`: Result type
- `tool.result.hasValue`: Whether result exists

### Handoff Spans

- `handoff.fromAgent`: Source agent ID
- `handoff.toAgent`: Target agent ID
- `handoff.depth`: Handoff depth in chain
- `handoff.hasContext`: Whether context was passed

## Custom Tracers

You can implement your own tracer by implementing the `Tracer` interface:

```typescript
import { Tracer, Span, SpanOptions } from 'fred/core/tracing';

class CustomTracer implements Tracer {
  startSpan(name: string, options?: SpanOptions): Span {
    // Create and return a custom span
  }

  getActiveSpan(): Span | undefined {
    // Return current active span
  }

  setActiveSpan(span: Span | undefined): void {
    // Set active span
  }

  getTraceId(): string | undefined {
    // Return trace ID
  }
}
```

## Live Agent Status Metrics

Fred tracks active agent invocations with Effect's built-in `Metric` registry.
The existing `ObservabilityService.exportMetricsOtel()` path includes these
metrics using native OpenTelemetry gauge, cumulative sum, and histogram shapes:

| Metric | Kind | Attributes | Meaning |
| --- | --- | --- | --- |
| `fred_agents_running` | gauge | none | Agent invocations currently running |
| `fred_agent_runs_started_total` | counter | `agentId` | Agent invocations started |
| `fred_agent_runs_completed_total` | counter | `agentId`, `exit` | Agent invocations completed |
| `fred_agent_run_duration_ms` | histogram | `agentId`, `exit` | Invocation duration in milliseconds |

`exit` is one of `success`, `failure`, or `interrupted`; defects are reported
as failures. Workflow, session, run, and fiber identifiers remain available in
live status snapshots but are deliberately excluded from metric attributes to
avoid unbounded cardinality.

The running gauge returns to zero and the live snapshot clears after success,
typed failure, defect, or fiber interruption. This makes interruption cleanup a
useful production health signal: a non-zero gauge should represent live work,
not leaked status entries.

## Performance Considerations

- **No-op tracer**: Zero overhead when tracing is disabled
- **Span creation**: Minimal overhead (~1-2ms per span)
- **Attribute recording**: Negligible overhead
- **OpenTelemetry export**: Depends on exporter configuration

For production, consider:
- Sampling traces (only record a percentage)
- Using async exporters
- Filtering low-value spans

## Best Practices

1. **Enable tracing in development**: Use tracing to debug and understand agent behavior
2. **Use OpenTelemetry in production**: Export to your observability platform
3. **Monitor key spans**: Focus on `model.call` and `tool.execute` for performance
4. **Track handoffs**: Monitor handoff chains to optimize agent routing
5. **Use attributes wisely**: Don't log sensitive data in span attributes

## Examples

See the [examples directory](../../examples/) for complete tracing examples.
