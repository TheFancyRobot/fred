# Providers API

API reference for AI provider configuration.

## ProviderConfig

```typescript
interface ProviderConfig {
  apiKey?: string;                    // API key for the provider
  baseURL?: string;                   // Base URL for the API
  headers?: Record<string, string>;    // Custom headers
  fetch?: typeof fetch;                // Custom fetch implementation
  [key: string]: any;                  // Additional provider-specific options
}
```

## AIProvider

```typescript
interface AIProvider {
  getModel(modelId: string): LanguageModel;
  getPlatform(): string;
}
```

## Examples

### Using a Provider

```typescript
const openai = await fred.useProvider('openai', {
  apiKey: 'your-api-key',
  baseURL: 'https://api.openai.com/v1',
});
```

### Provider with Custom Headers

```typescript
const provider = await fred.useProvider('openai', {
  apiKey: 'your-key',
  headers: {
    'X-Custom-Header': 'value',
  },
});
```

### Provider with Custom Fetch

```typescript
const provider = await fred.useProvider('openai', {
  apiKey: 'your-key',
  fetch: customFetchImplementation,
});
```

### Multiple Providers

```typescript
await fred.useProvider('openai', { apiKey: 'openai-key' });
await fred.useProvider('groq', { apiKey: 'groq-key' });
await fred.useProvider('anthropic', { apiKey: 'anthropic-key' });
```

### Default Providers

```typescript
fred.registerDefaultProviders({
  openai: { apiKey: 'openai-key' },
  groq: { apiKey: 'groq-key' },
});
```

## Supported Platforms

All platforms supported by @ai-sdk:

- `openai` - OpenAI
- `anthropic` - Anthropic
- `google` - Google
- `groq` - Groq
- `mistral` - Mistral
- `cohere` - Cohere
- `vercel` - Vercel
- `azure-openai` - Azure OpenAI
- `azure-anthropic` - Azure Anthropic
- `fireworks` - Fireworks
- `xai` - X.AI
- `ollama` - Ollama
- `ai21` - AI21
- `nvidia` - NVIDIA
- `bedrock` - Amazon Bedrock
- `cloudflare` - Cloudflare
- `elevenlabs` - ElevenLabs
- `lepton` - Lepton
- `perplexity` - Perplexity
- `replicate` - Replicate
- `together` - Together
- `upstash` - Upstash

