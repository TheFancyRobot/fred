# Evaluation Harness & Golden Traces

Fred provides a comprehensive evaluation harness using "golden traces" - deterministic snapshots of agent runs that can be used for regression testing and validation.

## Overview

Golden traces capture the complete execution of an agent run, including:

- **Message**: The input message
- **Spans**: All tracing spans with timing and attributes
- **Response**: The agent's response
- **Tool Calls**: All tool invocations with arguments and results
- **Handoffs**: Agent-to-agent transfers
- **Routing**: How the message was routed to the agent

## Golden Trace Format

Golden traces are versioned JSON files with the format:

```json
{
  "version": "1.0",
  "metadata": {
    "timestamp": 1234567890,
    "fredVersion": "0.1.2",
    "config": {
      "useSemanticMatching": true,
      "semanticThreshold": 0.6
    }
  },
  "trace": {
    "message": "Hello, world!",
    "spans": [...],
    "response": {
      "content": "Hello! How can I help?",
      "toolCalls": [...]
    },
    "toolCalls": [...],
    "handoffs": [...],
    "routing": {
      "method": "agent.utterance",
      "agentId": "greeting-agent",
      "confidence": 1.0
    }
  }
}
```

Files are named: `trace-v1.0.0-{hash}.json`

## Recording Golden Traces

### Using the CLI

```bash
# Record a new golden trace
fred test --record "Hello, world!"

# Record with specific config
fred test --record "Hello, world!" --config fred.config.yaml
```

### Programmatically

```typescript
import { Fred } from 'fred';
import { NoOpTracer } from 'fred/core/tracing';
import { GoldenTraceRecorder } from 'fred/core/eval/recorder';

const fred = new Fred();
const tracer = new NoOpTracer();
fred.enableTracing(tracer);

const recorder = new GoldenTraceRecorder(tracer);
recorder.recordMessage('Hello, world!');

const response = await fred.processMessage('Hello, world!');
recorder.recordResponse(response);

// Save to file
const filepath = await recorder.saveToFile('tests/golden-traces');
console.log(`Saved to: ${filepath}`);
```

## Writing Test Cases

Create a `test-cases.json` file in your traces directory:

```json
[
  {
    "name": "greeting-test",
    "traceFile": "trace-v1.0.0-abc123.json",
    "assertions": [
      {
        "type": "agentSelected",
        "args": ["greeting-agent"]
      },
      {
        "type": "responseContains",
        "args": ["Hello"]
      },
      {
        "type": "timing",
        "args": ["model.call", 5000]
      }
    ]
  }
]
```

## Running Tests

### Using the CLI

```bash
# Run all tests
fred test

# Run tests matching a pattern
fred test greeting

# Update existing traces
fred test --update
```

### Programmatically

```typescript
import { runTestCases, loadGoldenTrace } from 'fred/core/eval/assertion-runner';

const testCases = [
  {
    name: 'greeting-test',
    traceFile: 'trace-v1.0.0-abc123.json',
    assertions: [
      { type: 'agentSelected', args: ['greeting-agent'] },
      { type: 'responseContains', args: ['Hello'] },
    ],
  },
];

const results = await runTestCases(testCases, 'tests/golden-traces');
console.log(formatTestResults(results));
```

## Assertions

### assertToolCalled

Verify a tool was called with specific arguments:

```typescript
assertToolCalled(trace, 'weather-api', { location: 'New York' });
```

### assertAgentSelected

Verify the correct agent was selected:

```typescript
assertAgentSelected(trace, 'greeting-agent');
```

### assertHandoff

Verify a handoff occurred:

```typescript
assertHandoff(trace, 'agent-a', 'agent-b');
```

### assertResponseContains

Verify the response contains specific text:

```typescript
assertResponseContains(trace, 'Hello', false); // case-insensitive
```

### assertSpan

Verify a span exists with specific attributes:

```typescript
assertSpan(trace, 'model.call', {
  'model.name': 'gpt-4',
  'usage.totalTokens': { $lt: 1000 }, // Custom comparison
});
```

### assertTiming

Verify performance constraints:

```typescript
assertTiming(trace, 'model.call', 5000); // Max 5 seconds
```

### assertSchema

Validate trace structure:

```typescript
assertSchema(trace);
```

## CI/CD Integration

Golden traces are perfect for CI/CD pipelines:

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: fred test
```

## Best Practices

1. **Version traces**: Use semantic versioning in filenames
2. **Commit traces**: Commit golden traces to version control
3. **Update carefully**: Review changes when updating traces
4. **Test frequently**: Run tests in CI on every commit
5. **Use patterns**: Group related tests with naming patterns
6. **Monitor timing**: Set reasonable timing constraints
7. **Validate schemas**: Always validate trace schemas

## Updating Traces

When agent behavior changes (intentionally), update traces:

```bash
# Update all traces
fred test --update

# Update specific traces
fred test --update --pattern greeting
```

**Important**: Review changes before committing updated traces.

## Trace Structure

### Spans

Each span includes:
- `name`: Span name
- `startTime`: Start timestamp (ms)
- `endTime`: End timestamp (ms)
- `duration`: Duration (ms)
- `attributes`: Key-value attributes
- `events`: Span events
- `status`: Status code and message

### Tool Calls

Each tool call includes:
- `toolId`: Tool identifier
- `args`: Tool arguments
- `result`: Tool result
- `timing`: Start, end, duration
- `status`: Success or error

### Handoffs

Each handoff includes:
- `fromAgent`: Source agent (optional)
- `toAgent`: Target agent
- `message`: Handoff message
- `context`: Additional context
- `timing`: Start, end, duration
- `depth`: Handoff depth in chain

## Examples

See the [examples directory](../../examples/) for complete evaluation examples.
