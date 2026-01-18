# Providers

Fred supports all AI providers available in the Vercel AI SDK. This guide covers how to configure and use different providers.

## Supported Providers

Fred supports all AI providers available in the Vercel AI SDK. This includes 30+ providers:

### First-Party Providers

- **OpenAI** (`openai`) - GPT-5, GPT-4, GPT-3.5, and more
- **Anthropic** (`anthropic`) - Claude Opus, Sonnet, Haiku models
- **Google Generative AI** (`google`) - Gemini 2.0, Gemini 1.5 models
- **Google Vertex AI** (`google-vertex`) - Google Vertex models
- **Azure OpenAI** (`azure-openai` or `azure`) - Azure-hosted OpenAI
- **Azure Anthropic** (`azure-anthropic`) - Azure-hosted Anthropic
- **Amazon Bedrock** (`bedrock` or `amazon-bedrock`) - AWS Bedrock models
- **Vercel** (`vercel`) - Vercel's v0 API

### Fast Inference Providers

- **Groq** (`groq`) - Ultra-fast inference with Llama models
- **Mistral** (`mistral`) - Mistral AI models (Pixtral, Mistral Large/Medium/Small)
- **DeepSeek** (`deepseek`) - DeepSeek Chat and Reasoner
- **Cerebras** (`cerebras`) - Cerebras Llama models
- **Cloudflare** (`cloudflare`) - Cloudflare Workers AI

### Additional Providers

- **Cohere** (`cohere`) - Command models
- **Fireworks** (`fireworks`) - Fireworks AI models
- **X.AI** (`xai`) - Grok models
- **Together.ai** (`together`) - Together AI models
- **Perplexity** (`perplexity`) - Perplexity Sonar models
- **Replicate** (`replicate`) - Replicate hosted models
- **AI21** (`ai21`) - Jurassic models
- **NVIDIA** (`nvidia`) - NVIDIA NIM models
- **Upstash** (`upstash`) - Upstash AI models
- **Lepton** (`lepton`) - Lepton AI models
- **DeepInfra** (`deepinfra`) - DeepInfra hosted models
- **Baseten** (`baseten`) - Baseten hosted models

### Local/Self-Hosted

- **Ollama** (`ollama`) - Local models via Ollama

### Specialized

- **ElevenLabs** (`elevenlabs`) - Voice/TTS models

> **Note**: For a complete list of all available models for each provider, see the [Models Reference](models.md).

## Using Providers

### Basic Usage

```typescript
// Use a provider
const openai = await fred.useProvider('openai', { 
  apiKey: 'your-api-key' 
});

// Create agent with that provider
await fred.createAgent({
  id: 'agent',
  platform: 'openai',
  model: 'gpt-4',
  systemMessage: 'You are helpful.',
});
```

### Multiple Providers

```typescript
// Register multiple providers
await fred.useProvider('openai', { apiKey: 'openai-key' });
await fred.useProvider('groq', { apiKey: 'groq-key' });
await fred.useProvider('anthropic', { apiKey: 'anthropic-key' });

// Use different providers for different agents
await fred.createAgent({
  id: 'fast-agent',
  platform: 'groq',  // Fast responses
  model: 'llama-3.1-70b-versatile',  // or 'llama-3.1-8b-instant' for faster responses
});

await fred.createAgent({
  id: 'powerful-agent',
  platform: 'openai',  // More capable
  model: 'gpt-4',
});
```

## Provider Configuration

### API Key

```typescript
await fred.useProvider('openai', {
  apiKey: 'your-api-key',
});
```

### Custom Base URL

```typescript
await fred.useProvider('openai', {
  apiKey: 'your-api-key',
  baseURL: 'https://api.openai.com/v1',  // Custom endpoint
});
```

### Custom Headers

```typescript
await fred.useProvider('openai', {
  apiKey: 'your-api-key',
  headers: {
    'X-Custom-Header': 'value',
  },
});
```

### Custom Fetch

```typescript
await fred.useProvider('openai', {
  apiKey: 'your-api-key',
  fetch: customFetchImplementation,
});
```

## Environment Variables

Set API keys via environment variables:

```bash
export OPENAI_API_KEY=your_key
export GROQ_API_KEY=your_key
export ANTHROPIC_API_KEY=your_key
```

Then use default providers:

```typescript
fred.registerDefaultProviders();
```

## Provider-Specific Examples

### OpenAI

```typescript
await fred.useProvider('openai', { 
  apiKey: process.env.OPENAI_API_KEY 
});

await fred.createAgent({
  platform: 'openai',
  model: 'gpt-4',  // or 'gpt-3.5-turbo', 'gpt-4-turbo'
});
```

### Anthropic

```typescript
await fred.useProvider('anthropic', { 
  apiKey: process.env.ANTHROPIC_API_KEY 
});

await fred.createAgent({
  platform: 'anthropic',
  model: 'claude-3-opus-20240229',  // or other Claude models
});
```

### Groq

```typescript
await fred.useProvider('groq', { 
  apiKey: process.env.GROQ_API_KEY 
});

await fred.createAgent({
  platform: 'groq',
  model: 'llama-3.1-70b-versatile',  // Fast inference (or 'llama-3.1-8b-instant' for faster)
});
```

### Google

```typescript
await fred.useProvider('google', { 
  apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY 
});

await fred.createAgent({
  platform: 'google',
  model: 'gemini-pro',  // or other Gemini models
});
```

### Ollama (Local)

```typescript
await fred.useProvider('ollama', {
  baseURL: 'http://localhost:11434',  // Local Ollama instance
});

await fred.createAgent({
  platform: 'ollama',
  model: 'llama2',  // Local model
});
```

## Model Selection

Different providers offer different models. Choose based on your needs:

- **Speed**: Groq, Cloudflare
- **Capability**: OpenAI GPT-4, Anthropic Claude Opus
- **Cost**: OpenAI GPT-3.5, Groq
- **Local**: Ollama

For a comprehensive list of all available models, see the [Models Reference](models.md).

## Best Practices

1. **API Keys**: Store API keys in environment variables, never in code
2. **Provider Selection**: Choose providers based on speed, cost, and capability needs
3. **Fallback**: Have backup providers for reliability
4. **Rate Limits**: Be aware of provider rate limits
5. **Cost Management**: Monitor usage and costs

## Next Steps

- See [Models Reference](models.md) for a complete list of available models
- Learn about [Agents](agents.md)
- Explore [Custom Providers](../advanced/custom-providers.md)
- Check [API Reference](../api-reference/providers.md)

