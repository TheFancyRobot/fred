# Langfuse Integration

Fred supports optional integration with [Langfuse](https://langfuse.com) for comprehensive observability and prompt management. This integration leverages AI SDK's built-in telemetry and Langfuse's automatic instrumentation.

## Overview

Langfuse integration provides:

- **Automatic Tracing**: All AI SDK calls are automatically traced and sent to Langfuse
- **Prompt Management**: Fetch and version prompts from Langfuse
- **Observability**: View traces, token usage, latency, and more in Langfuse UI
- **Prompt Versioning**: Link prompt versions to traces for performance analysis

## Installation

Install Langfuse packages as peer dependencies:

```bash
bun add @langfuse/client @langfuse/otel @opentelemetry/sdk-node
```

Or with npm:

```bash
npm install @langfuse/client @langfuse/otel @opentelemetry/sdk-node
```

## Configuration

Set up environment variables in your `.env` file:

```env
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
```

For EU region:

```env
LANGFUSE_BASE_URL=https://eu.langfuse.com
```

For self-hosted instances:

```env
LANGFUSE_BASE_URL=https://your-langfuse-instance.com
```

## Basic Setup

### Enable Langfuse Integration

```typescript
import { Fred } from 'fred';

const fred = new Fred();

// Initialize Langfuse (one-time setup)
fred.useLangfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

// Register providers and create agents as usual
await fred.useProvider('openai', { apiKey: process.env.OPENAI_API_KEY });
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'You are a helpful assistant.',
  platform: 'openai',
  model: 'gpt-4',
});
```

Once `useLangfuse()` is called, all agent calls automatically send traces to Langfuse. No additional configuration needed!

### Using with `fred dev` / `bun run dev`

- Set `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` in your environment.
- Langfuse enables automatically in dev if both keys are present.
- To explicitly disable when keys are present, run: `fred dev --no-langfuse`.

## Using Langfuse Prompts

Fred supports loading prompts directly from Langfuse using a special URI format.

### Prompt URI Format

- `langfuse://prompt-name` - Fetches the production version
- `langfuse://prompt-name:label` - Fetches a specific label (e.g., `staging`, `latest`)

### Example: Using Langfuse Prompts

```typescript
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'langfuse://my-prompt-name', // Fetches from Langfuse
  platform: 'openai',
  model: 'gpt-4',
});
```

With a specific label:

```typescript
await fred.createAgent({
  id: 'my-agent',
  systemMessage: 'langfuse://my-prompt-name:staging', // Fetches staging version
  platform: 'openai',
  model: 'gpt-4',
});
```

### Prompt Versioning

Langfuse prompts support versioning and labels. When you use a Langfuse prompt:

1. The prompt is fetched from Langfuse (with caching)
2. The prompt version is linked to traces in Langfuse
3. You can track performance across prompt versions

### Creating Prompts in Langfuse

You can create prompts via the Langfuse UI or API:

```typescript
import { LangfuseClient } from '@langfuse/client';

const client = new LangfuseClient({
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

// Create a text prompt
await client.prompt.create({
  name: 'my-prompt-name',
  type: 'text',
  prompt: 'You are a helpful assistant.',
  labels: ['production'],
});
```

## How It Works

### Automatic Tracing

When Langfuse is enabled, Fred automatically:

1. Initializes OpenTelemetry with `LangfuseSpanProcessor`
2. Enables `experimental_telemetry` in all AI SDK calls
3. Captures spans automatically (no manual instrumentation needed)

### Trace Metadata

Each trace includes rich metadata:

- Agent ID
- Model name and platform
- Prompt name and version (if using Langfuse prompts)
- Token usage
- Latency
- Tool calls

### Viewing Traces

All traces appear automatically in your Langfuse dashboard:

1. Go to your Langfuse instance
2. Navigate to "Traces"
3. See all agent calls with full details

## Advanced Usage

### Combining with Custom Tracing

Langfuse integration works alongside Fred's built-in tracing:

```typescript
import { Fred } from 'fred';
import { NoOpTracer } from 'fred/core/tracing';

const fred = new Fred();

// Enable both Langfuse and custom tracing
fred.useLangfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
});

fred.enableTracing(new NoOpTracer()); // For golden traces, etc.
```

### Prompt Variables

Langfuse prompts support variables. However, Fred currently loads prompts as-is. For variable substitution, you can:

1. Use Langfuse's prompt compilation in your code
2. Or use file-based prompts with your own variable substitution

### Caching

Langfuse SDK caches prompts client-side (default: 60 seconds). This reduces API calls and improves performance.

## Troubleshooting

### Packages Not Found

If you see warnings about missing packages:

```bash
bun add @langfuse/client @langfuse/otel @opentelemetry/sdk-node
```

### Traces Not Appearing

1. Check your `LANGFUSE_SECRET_KEY` and `LANGFUSE_PUBLIC_KEY` are correct
2. Verify `LANGFUSE_BASE_URL` matches your region/instance
3. Check Langfuse dashboard for any errors
4. Ensure `useLangfuse()` is called before creating agents

### Prompt Loading Fails

1. Verify the prompt exists in Langfuse
2. Check the prompt name matches exactly (case-sensitive)
3. Ensure your Langfuse client has permission to read prompts
4. Check network connectivity to Langfuse

## Best Practices

1. **Use Labels for Environments**: Use different labels (`production`, `staging`) for different environments
2. **Version Control**: Track prompt changes via Langfuse versioning
3. **Monitor Performance**: Use Langfuse analytics to compare prompt versions
4. **Graceful Degradation**: Fred works fine without Langfuse - it's completely optional

## Example: Complete Integration

```typescript
import { Fred } from 'fred';

const fred = new Fred();

// 1. Enable Langfuse
fred.useLangfuse({
  secretKey: process.env.LANGFUSE_SECRET_KEY!,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY!,
  baseUrl: process.env.LANGFUSE_BASE_URL,
});

// 2. Register providers
await fred.useProvider('openai', { apiKey: process.env.OPENAI_API_KEY });

// 3. Create agent with Langfuse prompt
await fred.createAgent({
  id: 'assistant',
  systemMessage: 'langfuse://assistant-prompt', // From Langfuse
  platform: 'openai',
  model: 'gpt-4',
});

// 4. Use agent - traces automatically sent to Langfuse
const response = await fred.processMessage('Hello!');
// Trace is now visible in Langfuse dashboard
```

## See Also

- [Langfuse Documentation](https://langfuse.com/docs)
- [Observability Guide](../advanced/observability.md)
- [Prompt Management](https://langfuse.com/docs/prompt-management)
