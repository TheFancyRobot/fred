# Custom Providers

Learn how to create custom AI providers for Fred.

## Provider Interface

```typescript
interface AIProvider {
  getModel(modelId: string): LanguageModel;
  getPlatform(): string;
}
```

## Creating a Custom Provider

```typescript
import { AIProvider, ProviderConfig } from 'fred';
import { LanguageModel } from 'ai';

class CustomProvider implements AIProvider {
  private config: ProviderConfig;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
  }

  getModel(modelId: string): LanguageModel {
    // Return a LanguageModel instance
    // This depends on your custom implementation
  }

  getPlatform(): string {
    return 'custom';
  }
}

// Register the provider
const provider = new CustomProvider({ apiKey: 'your-key' });
fred.registerProvider('custom', provider);
```

## Using Custom Providers

```typescript
await fred.createAgent({
  id: 'agent',
  platform: 'custom',
  model: 'custom-model',
  systemMessage: 'You are helpful.',
});
```

