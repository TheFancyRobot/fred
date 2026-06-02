import { initFredBamlRuntime, type BamlClientModule, type FredBamlRuntime } from './runtime';

export function createStubBamlRuntime(client: BamlClientModule = { __stub: true }): FredBamlRuntime {
  return initFredBamlRuntime({
    moduleId: 'stub:baml_client',
    loadClient: async () => client,
  });
}

/**
 * Convenience async loader for tests that want to exercise the lazy runtime contract
 * without importing a generated `baml_client` module.
 */
export async function loadStubBamlClient(client: BamlClientModule = { __stub: true }): Promise<BamlClientModule> {
  return client;
}
