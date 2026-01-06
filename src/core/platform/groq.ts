import { groq as groqProvider } from '@ai-sdk/groq';
import { LanguageModel } from 'ai';
import { AIProvider, ProviderConfig } from './provider';

/**
 * Groq platform provider
 */
export class GroqProvider implements AIProvider {
  private config: ProviderConfig;

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

  getModel(modelId: string): LanguageModel {
    return groqProvider(modelId, {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      headers: this.config.headers,
      fetch: this.config.fetch,
      ...this.config,
    });
  }

  getPlatform(): string {
    return 'groq';
  }
}


