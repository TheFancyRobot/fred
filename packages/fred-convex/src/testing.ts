import type { ConvexClient, FredConvexRuntime, ConvexRuntimeConfig, ConvexClientLoader } from './runtime';

/**
 * Create a stub Convex client for deterministic testing.
 * All calls dispatch to pre-configured response maps.
 */
export function createStubConvexClient(
  responses?: Record<string, unknown>,
): ConvexClient & { responses: Map<string, unknown> } {
  const responseMap = new Map(Object.entries(responses ?? {}));

  return {
    responses: responseMap,
    async query(functionReference: string, _args?: Record<string, unknown>): Promise<unknown> {
      if (responseMap.has(functionReference)) {
        return responseMap.get(functionReference);
      }
      throw new Error(`StubConvexClient: no response configured for query \`${functionReference}\``);
    },
    async mutation(functionReference: string, _args?: Record<string, unknown>): Promise<unknown> {
      if (responseMap.has(functionReference)) {
        return responseMap.get(functionReference);
      }
      throw new Error(`StubConvexClient: no response configured for mutation \`${functionReference}\``);
    },
    async action(functionReference: string, _args?: Record<string, unknown>): Promise<unknown> {
      if (responseMap.has(functionReference)) {
        return responseMap.get(functionReference);
      }
      throw new Error(`StubConvexClient: no response configured for action \`${functionReference}\``);
    },
  };
}

/**
 * Create a stub Convex runtime for deterministic testing.
 *
 * @param responses - Optional initial response map (functionReference -> result)
 * @returns A stub runtime and client for test assertions
 *
 * @example
 * ```ts
 * import { createStubConvexRuntime } from '@fancyrobot/fred-convex/testing';
 * const { runtime, client } = createStubConvexRuntime({ 'api/tasks:list': [{ _id: '1', title: 'Test' }] });
 * ```
 */
export function createStubConvexRuntime(
  responses?: Record<string, unknown>,
): { runtime: FredConvexRuntime; client: ReturnType<typeof createStubConvexClient> } {
  const client = createStubConvexClient(responses);
  const config: ConvexRuntimeConfig = { url: 'https://test.convex.cloud' };
  const loadClient: ConvexClientLoader = () => client;

  // Inline runtime construction (avoids importing initFredConvexRuntime which requires options)
  const runtime: FredConvexRuntime = {
    config,
    loadClient,
  };

  return { runtime, client };
}
