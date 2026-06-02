import { BamlRuntimeLoadError, MissingBamlClientError } from './errors';

export type BamlClientModule = unknown;
export type BamlClientLoader = () => Promise<BamlClientModule>;

export interface FredBamlRuntime {
  readonly moduleId: string;
  loadClient(): Promise<BamlClientModule>;
}

export interface InitFredBamlRuntimeOptions {
  readonly moduleId?: string;
  readonly loadClient?: BamlClientLoader;
}

const DEFAULT_MODULE_ID = 'baml_client';

export function initFredBamlRuntime(options: InitFredBamlRuntimeOptions = {}): FredBamlRuntime {
  const moduleId = options.moduleId ?? DEFAULT_MODULE_ID;

  return {
    moduleId,
    async loadClient(): Promise<BamlClientModule> {
      if (!options.loadClient) {
        throw new MissingBamlClientError({
          moduleId,
          message:
            `No BAML client loader configured for module \`${moduleId}\`. ` +
            'Pass loadClient: () => import("../baml_client") when wiring fred-baml.',
        });
      }

      try {
        return await options.loadClient();
      } catch (cause) {
        throw new BamlRuntimeLoadError({
          moduleId,
          message: `Failed to load BAML client module \`${moduleId}\`.`,
          cause,
        });
      }
    },
  };
}
