import { HookType, HookEvent, HookResult, HookHandler } from './types';

/**
 * Hook manager for registering and executing hooks
 */
export class HookManager {
  private hooks: Map<HookType, HookHandler[]> = new Map();

  /**
   * Register a hook handler
   */
  registerHook(type: HookType, handler: HookHandler): void {
    if (!this.hooks.has(type)) {
      this.hooks.set(type, []);
    }
    this.hooks.get(type)!.push(handler);
  }

  /**
   * Unregister a hook handler
   */
  unregisterHook(type: HookType, handler: HookHandler): boolean {
    const handlers = this.hooks.get(type);
    if (!handlers) {
      return false;
    }
    const index = handlers.indexOf(handler);
    if (index === -1) {
      return false;
    }
    handlers.splice(index, 1);
    return true;
  }

  /**
   * Execute all hooks of a given type
   */
  async executeHooks(type: HookType, event: HookEvent): Promise<HookResult[]> {
    const handlers = this.hooks.get(type);
    if (!handlers || handlers.length === 0) {
      return [];
    }

    const results: HookResult[] = [];
    for (const handler of handlers) {
      try {
        const result = await handler(event);
        if (result) {
          results.push(result);
        }
      } catch (error) {
        console.error(`Error executing hook ${type}:`, error);
        // Continue executing other hooks even if one fails
      }
    }

    return results;
  }

  /**
   * Execute hooks and merge results
   * Returns merged context and data from all hook results
   */
  async executeHooksAndMerge(type: HookType, event: HookEvent): Promise<{
    context?: Record<string, any>;
    data?: any;
    skip?: boolean;
    metadata?: Record<string, any>;
  }> {
    const results = await this.executeHooks(type, event);

    // Merge all results
    const merged: {
      context?: Record<string, any>;
      data?: any;
      skip?: boolean;
      metadata?: Record<string, any>;
    } = {};

    for (const result of results) {
      // Merge context
      if (result.context) {
        merged.context = { ...merged.context, ...result.context };
      }

      // Last data wins (hooks executed in order)
      if (result.data !== undefined) {
        merged.data = result.data;
      }

      // Skip if any hook requests it
      if (result.skip) {
        merged.skip = true;
      }

      // Merge metadata
      if (result.metadata) {
        merged.metadata = { ...merged.metadata, ...result.metadata };
      }
    }

    return merged;
  }

  /**
   * Clear all hooks of a specific type
   */
  clearHooks(type: HookType): void {
    this.hooks.delete(type);
  }

  /**
   * Clear all hooks
   */
  clearAllHooks(): void {
    this.hooks.clear();
  }

  /**
   * Get all registered hook types
   */
  getRegisteredHookTypes(): HookType[] {
    return Array.from(this.hooks.keys());
  }

  /**
   * Get count of handlers for a hook type
   */
  getHookCount(type: HookType): number {
    return this.hooks.get(type)?.length || 0;
  }
}
