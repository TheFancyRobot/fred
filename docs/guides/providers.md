# Providers

Fred supports all AI providers available in the Vercel AI SDK. This guide covers how to configure and use different providers.

## Supported Providers

Fred supports 20+ AI providers:

- **OpenAI** - GPT-4, GPT-3.5, and more
- **Anthropic** - Claude models
- **Google** - Gemini models
- **Groq** - Fast inference
- **Mistral** - Mistral AI models
- **Cohere** - Cohere models
- **Vercel** - Vercel's v0 API
- **Azure OpenAI** - Azure-hosted OpenAI
- **Azure Anthropic** - Azure-hosted Anthropic
- **Fireworks** - Fireworks AI
- **X.AI** - Grok models
- **Ollama** - Local models
- **AI21** - Jurassic models
- **NVIDIA** - NVIDIA NIM
- **Amazon Bedrock** - AWS Bedrock
- **Cloudflare** - Cloudflare Workers AI
- **ElevenLabs** - Voice AI
- **Lepton** - Lepton AI
- **Perplexity** - Perplexity AI
- **Replicate** - Replicate models
- **Together** - Together AI
- **Upstash** - Upstash AI

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
  model: 'llama-3-70b-8192',
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
  model: 'llama-3-70b-8192',  // Fast inference
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

## Best Practices

1. **API Keys**: Store API keys in environment variables, never in code
2. **Provider Selection**: Choose providers based on speed, cost, and capability needs
3. **Fallback**: Have backup providers for reliability
4. **Rate Limits**: Be aware of provider rate limits
5. **Cost Management**: Monitor usage and costs

## Next Steps

- Learn about [Agents](agents.md)
- Explore [Custom Providers](../advanced/custom-providers.md)
- Check [API Reference](../api-reference/providers.md)

