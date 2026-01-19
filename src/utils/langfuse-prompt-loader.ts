/**
 * Langfuse prompt loader utility
 * Fetches prompts from Langfuse with caching and variable substitution
 */

export interface LangfusePromptInfo {
  name: string;
  version?: number;
  label?: string;
  type: 'text' | 'chat';
  prompt: string | Array<{ role: string; content: string }>;
}

/**
 * Parse Langfuse prompt URI
 * Format: langfuse://prompt-name or langfuse://prompt-name:label
 * @param uri - Langfuse prompt URI
 * @returns Parsed prompt name and optional label
 */
export function parseLangfuseURI(uri: string): { name: string; label?: string } | null {
  const match = uri.match(/^langfuse:\/\/([^:]+)(?::(.+))?$/);
  if (!match) {
    return null;
  }
  return {
    name: match[1],
    label: match[2],
  };
}

/**
 * Check if a string is a Langfuse prompt URI
 */
export function isLangfuseURI(value: string): boolean {
  return value.startsWith('langfuse://');
}

/**
 * Load prompt from Langfuse
 * @param uri - Langfuse prompt URI (langfuse://prompt-name or langfuse://prompt-name:label)
 * @param langfuseClient - Langfuse client instance
 * @returns Prompt content (text string or chat messages array as string)
 */
export async function loadLangfusePrompt(
  uri: string,
  langfuseClient: any
): Promise<{ content: string; info?: LangfusePromptInfo }> {
  const parsed = parseLangfuseURI(uri);
  if (!parsed) {
    throw new Error(`Invalid Langfuse prompt URI: ${uri}`);
  }

  try {
    // Fetch prompt from Langfuse
    const prompt = await langfuseClient.prompt.get(parsed.name, {
      label: parsed.label,
    });

    // Handle text prompts
    if (prompt.type === 'text') {
      return {
        content: prompt.prompt as string,
        info: {
          name: prompt.name,
          version: prompt.version,
          label: parsed.label,
          type: 'text',
          prompt: prompt.prompt as string,
        },
      };
    }

    // Handle chat prompts - convert to string format
    if (prompt.type === 'chat' && Array.isArray(prompt.prompt)) {
      // Convert chat messages to a single string
      const messages = prompt.prompt as Array<{ role: string; content: string }>;
      const content = messages
        .map((msg) => `${msg.role.toUpperCase()}: ${msg.content}`)
        .join('\n\n');
      
      return {
        content,
        info: {
          name: prompt.name,
          version: prompt.version,
          label: parsed.label,
          type: 'chat',
          prompt: messages,
        },
      };
    }

    throw new Error(`Unsupported prompt type: ${prompt.type}`);
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to load Langfuse prompt "${parsed.name}": ${error.message}`);
    }
    throw error;
  }
}

/**
 * Compile Langfuse prompt with variables
 * @param prompt - Prompt content from Langfuse
 * @param variables - Variables to substitute
 * @returns Compiled prompt with variables substituted
 */
export function compileLangfusePrompt(
  prompt: string,
  variables?: Record<string, string | number | boolean>
): string {
  if (!variables || Object.keys(variables).length === 0) {
    return prompt;
  }

  let compiled = prompt;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
    compiled = compiled.replace(regex, String(value));
  }

  return compiled;
}
