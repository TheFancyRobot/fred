/**
 * Langfuse integration module
 * Provides initialization and utilities for Langfuse observability and prompt management
 */

export { initializeLangfuse, isLangfuseAvailable } from './init';
export {
  parseLangfuseURI,
  isLangfuseURI,
  loadLangfusePrompt,
  compileLangfusePrompt,
  type LangfusePromptInfo,
} from '../../utils/langfuse-prompt-loader';

/**
 * Create a Langfuse client instance
 * @param options - Langfuse client configuration
 * @returns Langfuse client instance or null if packages not available
 */
export async function createLangfuseClient(options: {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
}): Promise<any | null> {
  try {
    const langfuseClientModule = await import('@langfuse/client');
    // Handle both default and named exports (for ESM/CJS compatibility)
    const LangfuseClient = langfuseClientModule.LangfuseClient ?? langfuseClientModule.default?.LangfuseClient;
    
    if (!LangfuseClient) {
      throw new Error('Failed to load LangfuseClient from @langfuse/client');
    }
    
    return new LangfuseClient({
      secretKey: options.secretKey,
      publicKey: options.publicKey,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    if (error instanceof Error && (
      error.message.includes('Cannot find module') ||
      error.message.includes('Could not resolve') ||
      error.message.includes('Failed to load')
    )) {
      console.warn('[Fred] @langfuse/client not found. Install it to enable Langfuse prompt management.');
      return null;
    }
    throw error;
  }
}

/**
 * Langfuse integration options
 */
export interface LangfuseOptions {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
}
