import type { ConvexRuntime, ConvexRuntimeConfig } from './runtime';

/**
 * A deterministic stub Convex client for testing.
 * All calls return configurable values without hitting a real Convex deployment.
 */
export interface StubConvexClient {
  /** Config used to create the stub (url is typically a sentinel like `https://test.convex.cloud`) */
  readonly config: ConvexRuntimeConfig;
  /** Pre-configured response map: functionReference -> result */
  responses: Map<string, unknown>;
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
 * const stub = createStubConvexRuntime({ 'api.tasks.list': [{ _id: '1', title: 'Test' }] });
 * ```
 */
export function createStubConvexRuntime(
  responses?: Record<string, unknown>
): { runtime: ConvexRuntime; client: StubConvexClient } {
  const config: ConvexRuntimeConfig = { url: 'https://test.convex.cloud' };
  const responseMap = new Map(Object.entries(responses ?? {}));
  const runtime: ConvexRuntime = { config };
  const client: StubConvexClient = { config, responses: responseMap };
  return { runtime, client };
}
