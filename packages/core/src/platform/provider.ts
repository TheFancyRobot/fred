import { Context, Effect, Layer } from 'effect';
import type * as AiModel from '@effect/ai/Model';
import type { ProviderCapabilityKey } from './provider-capabilities';
import type {
  ProviderConnectionCapabilities,
  ProviderConnectionPrepare,
  ProviderConnectionCredentials,
  ProviderConnectionTestHook,
} from './connections';
import type { EffectProviderFactory } from './base';

export type ProviderAlias = string;

export interface ProviderModelDefaults {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ProviderConfig {
  /** Legacy compatibility input, resolved by core before provider construction. */
  apiKeyEnvVar?: string;
  /** Runtime-only credentials, resolved by core rather than provider packages. */
  credentials?: ProviderConnectionCredentials;
  baseUrl?: string;
  headers?: Record<string, string>;
  modelDefaults?: ProviderModelDefaults;
  aliases?: ProviderAlias[];
  [key: string]: unknown;
}

export interface ProviderRegistration {
  id: string;
  config?: ProviderConfig;
  modelDefaults?: ProviderModelDefaults;
  aliases?: ProviderAlias[];
}

export interface ProviderDefinition {
  id: string;
  aliases: ProviderAlias[];
  config: ProviderConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getModel: (modelId: string, options?: ProviderModelDefaults) => Effect.Effect<AiModel.Model<any, any, any>, Error>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  layer: Layer.Layer<any, any, any>;
  /** Factory retained by core so an agent can bind a fresh connection per call. */
  factory?: EffectProviderFactory;
  /** Resolves an auth-bound runtime immediately before an invocation. */
  resolveRuntime?: () => Effect.Effect<ProviderRuntime, Error>;
  /**
   * Optional set of capability keys this provider supports.
   *
   * When omitted, the provider is treated as language-only for
   * backward compatibility with existing providers.
   *
   * Multi-modality providers (e.g. MiniMax) declare all supported
   * capabilities here so callers can discover and route to them.
   */
  capabilities?: Set<ProviderCapabilityKey>;
  /** Authentication/login capabilities; provider packages own this declaration. */
  connectionCapabilities?: ProviderConnectionCapabilities;
  /** Tests an unsaved connection without coupling a provider to persistence. */
  connectionTest?: ProviderConnectionTestHook;
  /** Refreshes provider-owned credentials immediately before use. */
  connectionPrepare?: ProviderConnectionPrepare;
}

export interface ProviderRuntime {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly getModel: (modelId: string, options?: ProviderModelDefaults) => Effect.Effect<AiModel.Model<any, any, any>, Error>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly layer: Layer.Layer<any, any, any>;
}

export interface ProviderConfigInput {
  defaultModel?: string;
  modelDefaults?: ProviderModelDefaults;
  aliases?: Record<string, string>;
  providers?: ProviderRegistration[];
}

export const ProviderService = Context.GenericTag<ProviderService>('Fred.ProviderService');

export interface ProviderService {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getModel: (providerId: string, modelId?: string, overrides?: ProviderModelDefaults) => Effect.Effect<AiModel.Model<any, any, any>, Error>;
  listProviders: () => string[];
}
