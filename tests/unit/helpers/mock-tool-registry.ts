import type { ToolRegistryLike } from '../../../packages/core/src/agent/factory';

export function createMockToolRegistry(): ToolRegistryLike {
  const tools = new Map<string, any>();

  return {
    registerTool(tool: any): void {
      tools.set(tool.id, tool);
    },
    getTools(ids: string[]): any[] {
      return ids.map((id) => tools.get(id)).filter((tool) => tool !== undefined);
    },
    hasTool(id: string): boolean {
      return tools.has(id);
    },
    getMissingToolIds(ids: string[]): string[] {
      return ids.filter((id) => !tools.has(id));
    },
  };
}
