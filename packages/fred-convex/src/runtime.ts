import { MissingConvexClientError, ConvexRuntimeLoadError } from './errors';

/**
 * Structural interface for a Convex HTTP client.
 * Matches the public shape of `ConvexHttpClient` without importing app-generated types.
 * Consuming apps pass their own `ConvexHttpClient` instance.
 */
export interface ConvexClient {
  readonly query: (functionReference: string, args?: Record<string, unknown>) => Promise<unknown>;
  readonly mutation: (functionReference: string, args?: Record<string, unknown>) => Promise<unknown>;
  readonly action: (functionReference: string, args?: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Loader function that provides a ConvexClient instance.
 * Typically wraps `() => new ConvexHttpClient(url)`.
 */
export type ConvexClientLoader = () => Promise<ConvexClient> | ConvexClient;

/**
 * Configuration for initializing a Fred Convex runtime.
 */
export interface ConvexRuntimeConfig {
  /** Convex deployment URL, e.g. `https://cool-cat-123.convex.cloud` */
  url: string;
  /** Optional auth token for the Convex client */
  authToken?: string;
}

/**
 * Opaque handle returned by `initFredConvexRuntime`.
 * Holds the configured client loader and deployment info.
 */
export interface FredConvexRuntime {
  readonly config: ConvexRuntimeConfig;
  loadClient(): Promise<ConvexClient> | ConvexClient;
}

/**
 * Options for initializing a Fred Convex runtime.
 */
export interface InitFredConvexRuntimeOptions {
  /** Deployment URL and optional auth token */
  config: ConvexRuntimeConfig;
  /** Loader that provides a ConvexClient instance */
  loadClient?: ConvexClientLoader;
}

/**
 * Initialize a Fred Convex runtime with the given configuration and client loader.
 *
 * @param options - Deployment config and optional client loader
 * @returns A `FredConvexRuntime` handle used by all call/tool helpers
 *
 * @example
 * ```ts
 * import { ConvexHttpClient } from 'convex/browser';
 * import { initFredConvexRuntime } from '@fancyrobot/fred-convex';
 *
 * const runtime = initFredConvexRuntime({
 *   config: { url: process.env.CONVEX_URL! },
 *   loadClient: () => {
 *     const client = new ConvexHttpClient(process.env.CONVEX_URL!);
 *     if (process.env.CONVEX_AUTH_TOKEN) client.setAuth(process.env.CONVEX_AUTH_TOKEN);
 *     return client;
 *   },
 * });
 * ```
 */
export function initFredConvexRuntime(options: InitFredConvexRuntimeOptions): FredConvexRuntime {
  return {
    config: options.config,
    async loadClient(): Promise<ConvexClient> {
      if (!options.loadClient) {
        throw new MissingConvexClientError({
          message:
            `No Convex client loader configured for url \`${options.config.url}\`. ` +
            'Pass loadClient when wiring @fancyrobot/fred-convex.',
        });
      }

      try {
        return await options.loadClient();
      } catch (cause) {
        throw new ConvexRuntimeLoadError({
          message: `Failed to load Convex client for url \`${options.config.url}\`.`,
          cause,
        });
      }
    },
  };
}
