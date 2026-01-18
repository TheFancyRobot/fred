import { LanguageModel } from 'ai';
import { AIProvider, ProviderConfig } from './provider';

/**
 * Groq platform provider
 * Uses dynamic import to avoid requiring @ai-sdk/groq at build time
 */
export class GroqProvider implements AIProvider {
  private config: ProviderConfig;
  private providerFactory?: (modelId: string, options?: any) => LanguageModel;

  constructor(config: ProviderConfig = {}) {
    this.config = config;
    
    // Set API key from config or environment
    if (config.apiKey) {
      // The @ai-sdk/groq package uses GROQ_API_KEY env var
      if (!process.env.GROQ_API_KEY && config.apiKey) {
        process.env.GROQ_API_KEY = config.apiKey;
      }
    }
  }

  private async loadProvider(): Promise<(modelId: string, options?: any) => LanguageModel> {
    if (this.providerFactory) {
      return this.providerFactory;
    }

    try {
      const groqModule = await import('@ai-sdk/groq');
      this.providerFactory = groqModule.groq;
      return this.providerFactory;
    } catch (error) {
      throw new Error(
        '@ai-sdk/groq is not installed. Install it with: bun add @ai-sdk/groq'
      );
    }
  }

  getModel(modelId: string): LanguageModel {
    // This will throw if called synchronously before provider is loaded
    // In practice, this should be called after the provider is initialized
    if (!this.providerFactory) {
      throw new Error(
        'Groq provider not initialized. Call initialize() first or use fred.useProvider() instead.'
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
    return 'groq';
  }
}


