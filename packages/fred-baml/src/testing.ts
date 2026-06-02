import { initFredBamlRuntime, type BamlClientModule, type FredBamlRuntime } from './runtime';

export function createStubBamlRuntime(client: BamlClientModule = { __stub: true }): FredBamlRuntime {
  return initFredBamlRuntime({
    moduleId: 'stub:baml_client',
    loadClient: async () => client,
  });
}

export async function loadStubBamlClient(client: BamlClientModule = { __stub: true }): Promise<BamlClientModule> {
  return client;
}
