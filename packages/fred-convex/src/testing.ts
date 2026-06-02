import type {
  ConvexClient,
  FredConvexRuntime,
  ConvexRuntimeConfig,
  ConvexClientLoader,
  ConvexFunctionReference,
} from './runtime';

export interface StubConvexResponses<FunctionReference = ConvexFunctionReference> {
  query?: Record<string, unknown>;
  mutation?: Record<string, unknown>;
  action?: Record<string, unknown>;
  aliases?: Map<string, FunctionReference>;
}

function getStubKey(functionReference: unknown): string {
  return typeof functionReference === 'string'
    ? functionReference
    : JSON.stringify(functionReference);
}

/**
 * Create a stub Convex client for deterministic testing.
 * All calls dispatch to type-specific response maps.
 */
export function createStubConvexClient<FunctionReference = ConvexFunctionReference>(
  responses?: StubConvexResponses<FunctionReference>,
): ConvexClient<FunctionReference> & {
  responses: {
    query: Map<string, unknown>;
    mutation: Map<string, unknown>;
    action: Map<string, unknown>;
  };
} {
  const aliasMap = responses?.aliases ?? new Map<string, FunctionReference>();
  const responseMaps = {
    query: new Map(Object.entries(responses?.query ?? {})),
    mutation: new Map(Object.entries(responses?.mutation ?? {})),
    action: new Map(Object.entries(responses?.action ?? {})),
  };

  const lookup = (type: 'query' | 'mutation' | 'action', functionReference: FunctionReference): unknown => {
    const key = getStubKey(functionReference);
    if (responseMaps[type].has(key)) {
      return responseMaps[type].get(key);
    }

    const alias = aliasMap.get(key);
    if (alias !== undefined) {
      const aliasKey = getStubKey(alias);
      if (responseMaps[type].has(aliasKey)) {
        return responseMaps[type].get(aliasKey);
      }
    }

    throw new Error(`StubConvexClient: no response configured for ${type} \`${key}\``);
  };

  return {
    responses: responseMaps,
    async query(functionReference: FunctionReference, _args?: Record<string, unknown>): Promise<unknown> {
      return lookup('query', functionReference);
    },
    async mutation(functionReference: FunctionReference, _args?: Record<string, unknown>): Promise<unknown> {
      return lookup('mutation', functionReference);
    },
    async action(functionReference: FunctionReference, _args?: Record<string, unknown>): Promise<unknown> {
      return lookup('action', functionReference);
    },
  };
}

/**
 * Create a stub Convex runtime for deterministic testing.
 */
export function createStubConvexRuntime<FunctionReference = ConvexFunctionReference>(
  responses?: StubConvexResponses<FunctionReference>,
): { runtime: FredConvexRuntime<FunctionReference>; client: ReturnType<typeof createStubConvexClient<FunctionReference>> } {
  const client = createStubConvexClient(responses);
  const config: ConvexRuntimeConfig = { url: 'https://test.convex.cloud' };
  const loadClient: ConvexClientLoader<FunctionReference> = () => client;

  const runtime: FredConvexRuntime<FunctionReference> = {
    config,
    loadClient,
  };

  return { runtime, client };
}
