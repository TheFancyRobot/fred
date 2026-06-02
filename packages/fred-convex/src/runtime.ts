/**
 * Configuration for initializing a Fred Convex runtime.
 *
 * Consuming apps provide their deployment URL and optional auth token;
 * the generated `convex/_generated/api` module reference is owned by the app.
 */
export interface ConvexRuntimeConfig {
  /** Convex deployment URL, e.g. `https://cool-cat-123.convex.cloud` */
  url: string;
  /** Optional auth token for the Convex client */
  authToken?: string;
}

/**
 * Opaque handle returned by `initFredConvexRuntime`.
 * Holds the configured Convex client and deployment info.
 */
export interface ConvexRuntime {
  readonly config: ConvexRuntimeConfig;
}

/**
 * Initialize a Fred Convex runtime with the given deployment configuration.
 *
 * @param config - Deployment URL and optional auth token
 * @returns A `ConvexRuntime` handle used by all call/tool helpers
 *
 * @example
 * ```ts
 * import { initFredConvexRuntime } from '@fancyrobot/fred-convex';
 * const runtime = initFredConvexRuntime({ url: process.env.CONVEX_URL! });
 * ```
 */
export function initFredConvexRuntime(config: ConvexRuntimeConfig): ConvexRuntime {
  return { config };
}
