import { LanguageModel } from 'ai';

/**
 * AI Provider interface for platform abstraction
 */
export interface AIProvider {
  /**
   * Get the language model instance for the given model identifier
   */
  getModel(modelId: string): LanguageModel;

  /**
   * Get the platform name
   */
  getPlatform(): string;
}

/**
 * Provider configuration - matches AI SDK provider options
 * These are the standard options accepted by all @ai-sdk providers
 */
export interface ProviderConfig {
  /** API key for the provider */
  apiKey?: string;
  /** Base URL for the API (useful for custom endpoints or proxies) */
  baseURL?: string;
  /** Custom headers to include in requests */
  headers?: Record<string, string>;
  /** Custom fetch implementation */
  fetch?: typeof fetch;
  /** Additional provider-specific options */
  [key: string]: any;
}


