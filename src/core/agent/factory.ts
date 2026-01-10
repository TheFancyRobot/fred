import { generateText, tool, CoreMessage, jsonSchema } from 'ai';
import { AgentConfig, AgentMessage, AgentResponse } from './agent';
import { AIProvider } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';

/**
 * Agent factory using Vercel AI SDK
 */
export class AgentFactory {
  private toolRegistry: ToolRegistry;

  constructor(toolRegistry: ToolRegistry) {
    this.toolRegistry = toolRegistry;
  }

  /**
   * Create an agent instance from configuration
   */
  async createAgent(
    config: AgentConfig,
    provider: AIProvider
  ): Promise<{
    processMessage: (message: string, messages?: AgentMessage[]) => Promise<AgentResponse>;
  }> {
    const model = provider.getModel(config.model);
    
    // Get tools for this agent
    const tools = config.tools ? this.toolRegistry.getTools(config.tools) : [];
    
    // Convert tools to AI SDK format
    const sdkTools: Record<string, any> = {};
    for (const toolDef of tools) {
      sdkTools[toolDef.id] = tool({
        description: toolDef.description,
        parameters: jsonSchema(toolDef.parameters),
        execute: toolDef.execute,
      });
    }

    // Create the agent processing function
    const processMessage = async (
      message: string,
      previousMessages: AgentMessage[] = []
    ): Promise<AgentResponse> => {
      // Convert previous messages to AI SDK CoreMessage format
      const messages: CoreMessage[] = previousMessages.map(msg => ({
        role: msg.role,
        content: msg.content,
      }));

      // Add system message if provided
      const systemMessage = config.systemMessage;

      // Generate response using AI SDK
      const allMessages: CoreMessage[] = [
        ...messages,
        { role: 'user', content: message },
      ];
      
      const result = await generateText({
        model,
        system: systemMessage,
        messages: allMessages,
        tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
      });

      // Extract tool calls if any
      const toolCalls = result.toolCalls?.map(tc => ({
        toolId: tc.toolName,
        args: tc.args as Record<string, any>,
        result: tc.result,
      }));

      return {
        content: result.text,
        toolCalls,
      };
    };

    return { processMessage };
  }
}


