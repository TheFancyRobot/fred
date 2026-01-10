import { generateText, tool, CoreMessage, jsonSchema } from 'ai';
import { AgentConfig, AgentMessage, AgentResponse } from './agent';
import { AIProvider } from '../platform/provider';
import { ToolRegistry } from '../tool/registry';
import { createHandoffTool, HandoffResult } from '../tool/handoff';
import { loadPromptFile } from '../../utils/prompt-loader';
import { MCPClientImpl, createAISDKToolsFromMCP, convertMCPToolsToFredTools } from '../mcp';
import { Tracer } from '../tracing';
import { SpanKind } from '../tracing/types';
import { setActiveSpan } from '../tracing/context';

/**
 * Agent factory using Vercel AI SDK
 */
export class AgentFactory {
  private toolRegistry: ToolRegistry;
  private handoffHandler?: {
    getAgent: (id: string) => any;
    getAvailableAgents: () => string[];
  };
  private mcpClients: Map<string, MCPClientImpl> = new Map(); // Track MCP clients per agent
  private tracer?: Tracer;

  constructor(toolRegistry: ToolRegistry, tracer?: Tracer) {
    this.toolRegistry = toolRegistry;
    this.tracer = tracer;
  }

  /**
   * Set the tracer for agent creation
   */
  setTracer(tracer?: Tracer): void {
    this.tracer = tracer;
  }

  /**
   * Set handoff handler for agent-to-agent handoffs
   */
  setHandoffHandler(handler: { getAgent: (id: string) => any; getAvailableAgents: () => string[] }): void {
    this.handoffHandler = handler;
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
    
    // Auto-register handoff tool if handler is available
    if (this.handoffHandler) {
      const handoffTool = createHandoffTool(
        this.handoffHandler.getAgent,
        this.handoffHandler.getAvailableAgents,
        this.tracer
      );
      tools.push(handoffTool);
    }
    
    // Initialize MCP servers and discover tools
    const mcpTools: Record<string, any> = {};
    const mcpClientInstances: MCPClientImpl[] = [];
    
    if (config.mcpServers && config.mcpServers.length > 0) {
      for (const mcpConfig of config.mcpServers) {
        // Skip disabled servers
        if (mcpConfig.enabled === false) {
          continue;
        }

        try {
          // Create and initialize MCP client
          const mcpClient = new MCPClientImpl(mcpConfig);
          await mcpClient.initialize();
          mcpClientInstances.push(mcpClient);
          
          // Store client for cleanup later
          const clientKey = `${config.id}-${mcpConfig.id}`;
          this.mcpClients.set(clientKey, mcpClient);
          
          // Discover tools from MCP server
          const discoveredTools = await mcpClient.listTools();
          
          // Convert MCP tools to AI SDK format
          const aiSdkTools = createAISDKToolsFromMCP(discoveredTools, mcpClient, mcpConfig.id);
          Object.assign(mcpTools, aiSdkTools);
          
          // Also register MCP tools in the tool registry (for consistency)
          const fredTools = convertMCPToolsToFredTools(discoveredTools, mcpClient, mcpConfig.id);
          for (const fredTool of fredTools) {
            // Only register if not already registered (avoid conflicts)
            if (!this.toolRegistry.hasTool(fredTool.id)) {
              this.toolRegistry.registerTool(fredTool);
            }
          }
        } catch (error) {
          // Log error but don't fail agent creation
          console.error(`Failed to initialize MCP server "${mcpConfig.id}":`, error);
          // Continue with other MCP servers
        }
      }
    }
    
    // Convert regular tools to AI SDK format with tracing
    const sdkTools: Record<string, any> = {};
    for (const toolDef of tools) {
      // Wrap tool execution with tracing
      const originalExecute = toolDef.execute;
      const tracedExecute = async (args: any) => {
        const toolSpan = this.tracer?.startSpan('tool.execute', {
          kind: SpanKind.CLIENT,
          attributes: {
            'tool.id': toolDef.id,
            'tool.name': toolDef.name,
            'tool.args': JSON.stringify(args),
          },
        });

        const previousActiveSpan = this.tracer?.getActiveSpan();
        if (toolSpan) {
          this.tracer?.setActiveSpan(toolSpan);
        }

        try {
          const result = await originalExecute(args);
          
          if (toolSpan) {
            toolSpan.setAttributes({
              'tool.result.type': typeof result,
              'tool.result.hasValue': result !== undefined && result !== null,
            });
            // Don't log full result if it's too large (could be sensitive data)
            if (typeof result === 'string' && result.length < 1000) {
              toolSpan.setAttribute('tool.result.preview', result.substring(0, 100));
            }
            toolSpan.setStatus('ok');
          }
          
          return result;
        } catch (error) {
          if (toolSpan && error instanceof Error) {
            toolSpan.recordException(error);
            toolSpan.setStatus('error', error.message);
          }
          throw error;
        } finally {
          if (toolSpan) {
            toolSpan.end();
            // Restore previous active span
            if (previousActiveSpan) {
              this.tracer?.setActiveSpan(previousActiveSpan);
            } else {
              this.tracer?.setActiveSpan(undefined);
            }
          }
        }
      };

      sdkTools[toolDef.id] = tool({
        description: toolDef.description,
        parameters: jsonSchema(toolDef.parameters),
        execute: tracedExecute,
      });
    }
    
    // Merge MCP tools with regular tools
    Object.assign(sdkTools, mcpTools);

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

      // Load system message (handle file paths for programmatic usage)
      // Note: When loaded from config, paths are already resolved in extractAgents
      const systemMessage = loadPromptFile(config.systemMessage);

      // Generate response using AI SDK with tracing
      const allMessages: CoreMessage[] = [
        ...messages,
        { role: 'user', content: message },
      ];
      
      // Create span for model call if tracing is enabled
      const modelSpan = this.tracer?.startSpan('model.call', {
        kind: SpanKind.CLIENT,
        attributes: {
          'agent.id': config.id,
          'model.name': config.model,
          'model.platform': config.platform,
          'model.temperature': config.temperature ?? 0.7,
          'model.maxTokens': config.maxTokens ?? 0,
          'message.length': message.length,
          'history.length': previousMessages.length,
        },
      });

      const previousActiveSpan = this.tracer?.getActiveSpan();
      if (modelSpan) {
        this.tracer?.setActiveSpan(modelSpan);
      }

      let result;
      try {
        result = await generateText({
          model,
          system: systemMessage,
          messages: allMessages,
          tools: Object.keys(sdkTools).length > 0 ? sdkTools : undefined,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
        });

        // Record model response attributes
        if (modelSpan) {
          modelSpan.setAttributes({
            'response.length': result.text.length,
            'response.finishReason': result.finishReason || 'unknown',
            'usage.promptTokens': result.usage?.promptTokens ?? 0,
            'usage.completionTokens': result.usage?.completionTokens ?? 0,
            'usage.totalTokens': result.usage?.totalTokens ?? 0,
            'toolCalls.count': result.toolCalls?.length ?? 0,
          });
          modelSpan.setStatus('ok');
        }
      } catch (error) {
        if (modelSpan && error instanceof Error) {
          modelSpan.recordException(error);
          modelSpan.setStatus('error', error.message);
        }
        throw error;
      } finally {
        if (modelSpan) {
          modelSpan.end();
          // Restore previous active span
          if (previousActiveSpan) {
            this.tracer?.setActiveSpan(previousActiveSpan);
          } else {
            this.tracer?.setActiveSpan(undefined);
          }
        }
      }

      // Extract tool calls if any
      const toolCalls = result.toolCalls?.map(tc => ({
        toolId: tc.toolName,
        args: tc.args as Record<string, any>,
        result: tc.result,
      }));

      // Check for handoff tool calls
      const handoffCall = toolCalls?.find(tc => tc.toolId === 'handoff_to_agent');
      if (handoffCall && handoffCall.result && typeof handoffCall.result === 'object' && 'type' in handoffCall.result && handoffCall.result.type === 'handoff') {
        // Return handoff result - will be processed by message pipeline
        return {
          content: result.text,
          toolCalls,
          handoff: handoffCall.result as HandoffResult,
        } as AgentResponse & { handoff?: HandoffResult };
      }

      return {
        content: result.text,
        toolCalls,
      };
    };

    return { processMessage };
  }
}


