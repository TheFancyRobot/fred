import { LanguageModel } from 'ai';
import { AIProvider, ProviderConfig } from './provider';
import { BaseProvider } from './base';

/**
 * Dynamically load and create a provider from @ai-sdk packages
 */
export async function createDynamicProvider(
  platform: string,
  config: ProviderConfig = {}
): Promise<AIProvider> {
  const platformLower = platform.toLowerCase();
  
  // Map of platform names to their @ai-sdk package names
  const packageMap: Record<string, string> = {
    'openai': '@ai-sdk/openai',
    'anthropic': '@ai-sdk/anthropic',
    'google': '@ai-sdk/google',
    'mistral': '@ai-sdk/mistral',
    'groq': '@ai-sdk/groq',
    'cohere': '@ai-sdk/cohere',
    'vercel': '@ai-sdk/vercel',
    'azure-openai': '@ai-sdk/azure',
    'azure-anthropic': '@ai-sdk/azure',
    'azure': '@ai-sdk/azure', // Alias
    'fireworks': '@ai-sdk/fireworks',
    'xai': '@ai-sdk/xai',
    'ollama': 'ai-sdk-ollama', // Community package
    // Note: ai21, nvidia, cloudflare, lepton, upstash are not available as @ai-sdk packages
    // They may be available as community packages or require different setup
    'bedrock': '@ai-sdk/amazon-bedrock',
    'amazon-bedrock': '@ai-sdk/amazon-bedrock',
    'elevenlabs': '@ai-sdk/elevenlabs',
    'perplexity': '@ai-sdk/perplexity',
    'replicate': '@ai-sdk/replicate',
    'together': '@ai-sdk/togetherai',
    'deepseek': '@ai-sdk/deepseek',
    'cerebras': '@ai-sdk/cerebras',
    'deepinfra': '@ai-sdk/deepinfra',
    'baseten': '@ai-sdk/baseten',
  };

  const packageName = packageMap[platformLower];
  
  if (!packageName) {
    throw new Error(
      `Unsupported platform: ${platform}. Supported platforms: ${Object.keys(packageMap).join(', ')}`
    );
  }

  try {
    // Dynamically import the provider package
    const providerModule = await import(packageName);
    
    // Get the provider function (usually the default export or named export matching platform)
    let providerFactory: (modelId: string, options?: any) => LanguageModel;
    
    if (providerModule.default) {
      providerFactory = providerModule.default;
    } else if (providerModule[platformLower]) {
      providerFactory = providerModule[platformLower];
    } else {
      // Try common export names
      const possibleNames = [
        platformLower,
        platformLower.charAt(0).toUpperCase() + platformLower.slice(1),
        'createLanguageModel',
        'createModel',
      ];
      
      for (const name of possibleNames) {
        if (providerModule[name]) {
          providerFactory = providerModule[name];
          break;
        }
      }
      
      if (!providerFactory) {
        // Use the first function export as fallback
        const exports = Object.keys(providerModule);
        const funcExport = exports.find(key => typeof providerModule[key] === 'function');
        if (funcExport) {
          providerFactory = providerModule[funcExport];
        } else {
          throw new Error(`Could not find provider function in ${packageName}`);
        }
      }
    }

    // Set environment variable if apiKey is provided
    if (config.apiKey) {
      const envVarName = getEnvVarName(platformLower);
      if (envVarName && typeof process !== 'undefined' && !process.env[envVarName]) {
        process.env[envVarName] = config.apiKey;
      }
    }

    return new BaseProvider(providerFactory, platformLower, config);
  } catch (error) {
    if (error instanceof Error) {
      // Check for module resolution errors
      if (error.message.includes('Cannot find module')) {
        // Check if it's a zod/v4 resolution issue (common with Bun's cache)
        if (error.message.includes('zod/v4')) {
          // This is a known Bun issue where cached packages can't resolve peer dependencies
          // The solution is to install the provider package locally
          throw new Error(
            `Provider package ${packageName} cannot resolve 'zod/v4' (Bun cache issue).\n` +
            `Install the package locally: bun add ${packageName}\n` +
            `This will ensure zod is properly resolved.`
          );
        }
        throw new Error(
          `Provider package ${packageName} is not installed. Install it with: bun add ${packageName}`
        );
      }
    }
    throw error;
  }
}

/**
 * Get the environment variable name for a platform's API key
 */
function getEnvVarName(platform: string): string | null {
  const envVarMap: Record<string, string> = {
    'openai': 'OPENAI_API_KEY',
    'anthropic': 'ANTHROPIC_API_KEY',
    'google': 'GOOGLE_GENERATIVE_AI_API_KEY',
    'mistral': 'MISTRAL_API_KEY',
    'groq': 'GROQ_API_KEY',
    'cohere': 'COHERE_API_KEY',
    'fireworks': 'FIREWORKS_API_KEY',
    'xai': 'XAI_API_KEY',
    'ollama': 'OLLAMA_API_KEY',
    'bedrock': 'AWS_ACCESS_KEY_ID', // AWS uses different auth
    'amazon-bedrock': 'AWS_ACCESS_KEY_ID',
    'perplexity': 'PERPLEXITY_API_KEY',
    'replicate': 'REPLICATE_API_KEY',
    'together': 'TOGETHER_API_KEY',
    'deepseek': 'DEEPSEEK_API_KEY',
    'cerebras': 'CEREBRAS_API_KEY',
    'deepinfra': 'DEEPINFRA_API_KEY',
    'baseten': 'BASETEN_API_KEY',
  };
  
  return envVarMap[platform] || null;
}


