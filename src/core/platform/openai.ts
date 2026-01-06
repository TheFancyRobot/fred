import { openai as openaiProvider } from '@ai-sdk/openai';
import { LanguageModel } from 'ai';
import { AIProvider, ProviderConfig } from './provider';

/**
 * OpenAI platform provider
 */
export class OpenAIProvider implements AIProvider {
  private config: ProviderConfig;

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

  getModel(modelId: string): LanguageModel {
    return openaiProvider(modelId, {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      headers: this.config.headers,
      fetch: this.config.fetch,
      ...this.config,
    });
  }

  getPlatform(): string {
    return 'openai';
  }
}


