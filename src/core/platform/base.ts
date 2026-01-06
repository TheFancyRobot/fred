import { LanguageModel } from 'ai';
import { AIProvider, ProviderConfig } from './provider';

/**
 * Base provider class that wraps any @ai-sdk provider
 */
export class BaseProvider implements AIProvider {
  private providerFactory: (modelId: string, options?: any) => LanguageModel;
  private platformName: string;
  private config: ProviderConfig;

  constructor(
    providerFactory: (modelId: string, options?: any) => LanguageModel,
    platformName: string,
    config: ProviderConfig = {}
  ) {
    this.providerFactory = providerFactory;
    this.platformName = platformName;
    this.config = config;
  }

  getModel(modelId: string): LanguageModel {
    // Pass all config options to the provider factory
    // This ensures full compatibility with AI SDK provider options
    return this.providerFactory(modelId, {
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      headers: this.config.headers,
      fetch: this.config.fetch,
      ...this.config,
    });
  }

  getPlatform(): string {
    return this.platformName;
  }
}


