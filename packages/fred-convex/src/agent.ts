import type { ConvexRuntime } from './runtime';

/**
 * Options for creating a Convex-backed Fred tool.
 */
export interface CreateConvexToolOptions {
  /** Tool name as exposed to the agent */
  name: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Convex function reference (app-owned, e.g. `api.tasks.create`) */
  functionReference: string;
  /** Function type: query, mutation, or action */
  functionType: 'query' | 'mutation' | 'action';
  /** Parameter schema in JSON Schema format for AI consumption */
  parameters: Record<string, unknown>;
}

/** Branded return type for createConvexTool */
export type ConvexTool = CreateConvexToolOptions & { readonly _tag: 'ConvexTool' };

/**
 * Create a Fred-compatible tool definition backed by a Convex function.
 *
 * Returns a plain tool descriptor that can be registered with a Fred agent.
 * The actual Convex call is deferred until the agent invokes the tool at runtime.
 *
 * @param _runtime - Runtime handle from `initFredConvexRuntime` (reserved for STEP-56-03)
 * @param options - Tool name, description, function reference, and schema
 * @returns A Fred tool definition object
 *
 * @example
 * ```ts
 * import { createConvexTool } from '@fancyrobot/fred-convex';
 * const tool = createConvexTool(runtime, {
 *   name: 'createTask',
 *   description: 'Create a new task',
 *   functionReference: 'api.tasks.create',
 *   functionType: 'mutation',
 *   parameters: { type: 'object', properties: { title: { type: 'string' } } },
 * });
 * ```
 */
export function createConvexTool(
  _runtime: ConvexRuntime,
  options: CreateConvexToolOptions
): ConvexTool {
  return { ...options, _tag: 'ConvexTool' as const };
}
