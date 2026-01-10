import { tool, jsonSchema } from 'ai';
import { Tool } from './tool';

/**
 * Centralized tool registry
 */
export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  /**
   * Register a tool in the registry
   */
  registerTool(tool: Tool): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`Tool with id "${tool.id}" is already registered`);
    }
    this.tools.set(tool.id, tool);
  }

  /**
   * Register multiple tools at once
   */
  registerTools(tools: Tool[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  /**
   * Get a tool by ID
   */
  getTool(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  /**
   * Get multiple tools by their IDs
   */
  getTools(ids: string[]): Tool[] {
    const tools: Tool[] = [];
    for (const id of ids) {
      const tool = this.getTool(id);
      if (tool) {
        tools.push(tool);
      }
    }
    return tools;
  }

  /**
   * Get all registered tools
   */
  getAllTools(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Check if a tool exists
   */
  hasTool(id: string): boolean {
    return this.tools.has(id);
  }

  /**
   * Remove a tool from the registry
   */
  removeTool(id: string): boolean {
    return this.tools.delete(id);
  }

  /**
   * Clear all tools from the registry
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Get the number of registered tools
   */
  size(): number {
    return this.tools.size;
  }

  /**
   * Convert tools to Vercel AI SDK format using tool() and jsonSchema()
   * This leverages the AI SDK's tool() and jsonSchema() functions for consistency
   */
  toAISDKTools(ids: string[]): Record<string, ReturnType<typeof tool>> {
    const tools = this.getTools(ids);
    const sdkTools: Record<string, ReturnType<typeof tool>> = {};

    for (const toolDef of tools) {
      sdkTools[toolDef.id] = tool({
        description: toolDef.description,
        parameters: jsonSchema(toolDef.parameters),
        execute: toolDef.execute,
      });
    }

    return sdkTools;
  }
}


