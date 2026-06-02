import { Schema } from 'effect';
import type { Tool, ToolSchemaMetadata } from '@fancyrobot/fred';
import type { FredConvexRuntime, ConvexClient } from './runtime';
import {
  MissingConvexClientError,
  ConvexRuntimeLoadError,
  ConvexFunctionCallError,
  ConvexToolExecutionError,
} from './errors';

// ---------------------------------------------------------------------------
// Low-level call helpers
// ---------------------------------------------------------------------------

/**
 * Call a Convex query function via the runtime's client.
 *
 * @param runtime - Runtime handle from `initFredConvexRuntime`
 * @param functionReference - App-owned Convex function reference (e.g. `api.tasks.list`)
 * @param args - Arguments to pass to the query
 * @returns Query result
 */
export async function callConvexQuery(
  runtime: FredConvexRuntime,
  functionReference: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const client = await runtime.loadClient();
  return dispatchConvexCall(client, 'query', functionReference, args);
}

/**
 * Call a Convex mutation function via the runtime's client.
 *
 * @param runtime - Runtime handle from `initFredConvexRuntime`
 * @param functionReference - App-owned Convex function reference (e.g. `api.tasks.create`)
 * @param args - Arguments to pass to the mutation
 * @returns Mutation result
 */
export async function callConvexMutation(
  runtime: FredConvexRuntime,
  functionReference: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const client = await runtime.loadClient();
  return dispatchConvexCall(client, 'mutation', functionReference, args);
}

/**
 * Call a Convex action function via the runtime's client.
 *
 * @param runtime - Runtime handle from `initFredConvexRuntime`
 * @param functionReference - App-owned Convex function reference (e.g. `api.tasks.process`)
 * @param args - Arguments to pass to the action
 * @returns Action result
 */
export async function callConvexAction(
  runtime: FredConvexRuntime,
  functionReference: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  const client = await runtime.loadClient();
  return dispatchConvexCall(client, 'action', functionReference, args);
}

/**
 * Internal dispatcher shared by all call helpers.
 * Wraps client method calls with typed error handling.
 */
async function dispatchConvexCall(
  client: ConvexClient,
  functionType: 'query' | 'mutation' | 'action',
  functionReference: string,
  args?: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await client[functionType](functionReference, args);
  } catch (cause) {
    if (
      cause instanceof MissingConvexClientError ||
      cause instanceof ConvexRuntimeLoadError ||
      cause instanceof ConvexFunctionCallError ||
      cause instanceof ConvexToolExecutionError
    ) {
      throw cause;
    }

    const message = cause instanceof Error ? cause.message : 'Unknown Convex function call failure';
    throw new ConvexFunctionCallError({
      message: `Convex ${functionType} \`${functionReference}\` failed: ${message}`,
      functionName: functionReference,
      functionType,
      cause,
    });
  }
}

// ---------------------------------------------------------------------------
// Tool adapter
// ---------------------------------------------------------------------------

/**
 * Options for creating a Convex-backed Fred tool.
 */
export interface CreateConvexToolOptions<Input, Output> {
  /** Unique tool identifier */
  id: string;
  /** Human-readable tool name (defaults to id) */
  name?: string;
  /** Human-readable description of what the tool does */
  description: string;
  /** Convex function reference (app-owned, e.g. `api.tasks.create`) */
  functionReference: string;
  /** Function type: query, mutation, or action */
  functionType: 'query' | 'mutation' | 'action';
  /** Effect Schema for the tool's input */
  inputSchema: Schema.Schema<Input>;
  /** Effect Schema for the tool's success output */
  successSchema: Schema.Schema<Output>;
  /** Optional JSON Schema metadata for AI consumption */
  metadata?: ToolSchemaMetadata;
  /** Whether strict mode is enabled (default true) */
  strict?: boolean;
  /** Convex runtime handle */
  runtime: FredConvexRuntime;
  /** Optional input mapper: reshape Fred-facing input into Convex args */
  mapInput?: (input: Input) => Record<string, unknown>;
}

/**
 * Create a Fred-compatible `Tool` backed by a Convex function.
 *
 * Returns a standard Fred `Tool` with Effect Schema input/success,
 * which can be registered on a Fred agent and invoked through the tool registry.
 *
 * @param options - Tool definition and runtime configuration
 * @returns A Fred `Tool` object
 *
 * @example
 * ```ts
 * import { Schema } from 'effect';
 * import { createConvexTool, initFredConvexRuntime } from '@fancyrobot/fred-convex';
 *
 * const runtime = initFredConvexRuntime({ config: { url: process.env.CONVEX_URL! }, loadClient: ... });
 *
 * const createTaskTool = createConvexTool({
 *   id: 'convex.createTask',
 *   description: 'Create a new task in Convex',
 *   functionReference: 'api/tasks:create',
 *   functionType: 'mutation',
 *   inputSchema: Schema.Struct({ title: Schema.String }),
 *   successSchema: Schema.Struct({ _id: Schema.String }),
 *   runtime,
 * });
 * ```
 */
export function createConvexTool<Input, Output>(
  options: CreateConvexToolOptions<Input, Output>,
): Tool<Input, Output, never> {
  return {
    id: options.id,
    name: options.name ?? options.id,
    description: options.description,
    schema: {
      input: options.inputSchema,
      success: options.successSchema,
      metadata: options.metadata,
    },
    strict: options.strict ?? true,
    execute: async (input: Input): Promise<Output> => {
      const args = options.mapInput ? options.mapInput(input) : (input as unknown as Record<string, unknown>);

      try {
        const client = await options.runtime.loadClient();
        const result = await dispatchConvexCall(
          client,
          options.functionType,
          options.functionReference,
          args,
        );
        return result as Output;
      } catch (cause) {
        // Infrastructure errors (no client, client load failure) pass through as-is
        if (
          cause instanceof MissingConvexClientError ||
          cause instanceof ConvexRuntimeLoadError
        ) {
          throw cause;
        }

        // Function-call and unknown errors are wrapped as tool-level errors
        const message =
          cause instanceof ConvexFunctionCallError
            ? cause.message
            : cause instanceof Error
              ? cause.message
              : 'Unknown Convex tool execution failure';

        throw new ConvexToolExecutionError({
          toolId: options.id,
          message: `Convex tool \`${options.id}\` failed: ${message}`,
          cause,
        });
      }
    },
  };
}
