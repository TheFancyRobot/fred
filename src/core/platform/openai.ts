import { LanguageModel } from 'ai';
import { AIProvider, ProviderConfig } from './provider';

/**
 * OpenAI platform provider
 * Uses dynamic import to avoid requiring @ai-sdk/openai at build time
 */
export class OpenAIProvider implements AIProvider {
  private config: ProviderConfig;
  private providerFactory?: (modelId: string, options?: any) => LanguageModel;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
    
    // Set API key from config or environment
    if (config.apiKey) {
      // The @ai-sdk/openai package uses OPENAI_API_KEY env var
      // We'll set it if provided in config
      if (!process.env.OPENAI_API_KEY && config.apiKey) {
        process.env.OPENAI_API_KEY = config.apiKey;
      }
    }
  }

  private async loadProvider(): Promise<(modelId: string, options?: any) => LanguageModel> {
    if (this.providerFactory) {
      return this.providerFactory;
    }

    try {
      const openaiModule = await import('@ai-sdk/openai');
      this.providerFactory = openaiModule.openai;
      return this.providerFactory;
    } catch (error) {
      throw new Error(
        '@ai-sdk/openai is not installed. Install it with: bun add @ai-sdk/openai'
      );
    }
  }

  getModel(modelId: string): LanguageModel {
    // This will throw if called synchronously before provider is loaded
    // In practice, this should be called after the provider is initialized
    if (!this.providerFactory) {
      throw new Error(
        'OpenAI provider not initialized. Call initialize() first or use fred.useProvider() instead.'
      );
    }

    return this.providerFactory(modelId, {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      headers: this.config.headers,
      fetch: this.config.fetch,
      ...this.config,
    });
  }

  async initialize(): Promise<void> {
    await this.loadProvider();
  }

  getPlatform(): string {
    return 'openai';
  }
}


