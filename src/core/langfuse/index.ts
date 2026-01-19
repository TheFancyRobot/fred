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
export function createLangfuseClient(options: {
  secretKey: string;
  publicKey: string;
  baseUrl?: string;
}): any | null {
  try {
    const { LangfuseClient } = require('@langfuse/client');
    return new LangfuseClient({
      secretKey: options.secretKey,
      publicKey: options.publicKey,
      baseUrl: options.baseUrl,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes('Cannot find module')) {
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
