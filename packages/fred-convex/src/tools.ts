import type { ConvexRuntime } from './runtime';
import type { ConvexFunctionCallError } from './errors';

/**
 * Call a Convex query function.
 *
 * @param runtime - Runtime handle from `initFredConvexRuntime`
 * @param functionReference - App-owned Convex function reference (e.g. `api.tasks.list`)
 * @param args - Arguments to pass to the query
 * @returns Query result
 */
export async function callConvexQuery(
  runtime: ConvexRuntime,
  functionReference: string,
  args?: Record<string, unknown>
): Promise<unknown> {
  // Implementation deferred to STEP-56-03
  throw new Error(
    `callConvexQuery not yet implemented (fn=${functionReference}, url=${runtime.config.url})`
  );
}

/**
 * Call a Convex mutation function.
 *
 * @param runtime - Runtime handle from `initFredConvexRuntime`
 * @param functionReference - App-owned Convex function reference (e.g. `api.tasks.create`)
 * @param args - Arguments to pass to the mutation
 * @returns Mutation result
 */
export async function callConvexMutation(
  runtime: ConvexRuntime,
  functionReference: string,
  args?: Record<string, unknown>
): Promise<unknown> {
  // Implementation deferred to STEP-56-03
  throw new Error(
    `callConvexMutation not yet implemented (fn=${functionReference}, url=${runtime.config.url})`
  );
}

/**
 * Call a Convex action function.
 *
 * @param runtime - Runtime handle from `initFredConvexRuntime`
 * @param functionReference - App-owned Convex function reference (e.g. `api.tasks.process`)
 * @param args - Arguments to pass to the action
 * @returns Action result
 */
export async function callConvexAction(
  runtime: ConvexRuntime,
  functionReference: string,
  args?: Record<string, unknown>
): Promise<unknown> {
  // Implementation deferred to STEP-56-03
  throw new Error(
    `callConvexAction not yet implemented (fn=${functionReference}, url=${runtime.config.url})`
  );
}
