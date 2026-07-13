/**
 * Compile a validated framework config into Effect Layers (Phase 61,
 * STEP-61-04).
 *
 * Phase 60 made the Fred runtime eager and single: it is built once and never
 * invalidated, and most config sections (providers, tools, intents, agents,
 * pipelines, policies, MCP servers, persistence) are applied as live service
 * mutations by the config initializer — not by rebuilding layers.
 *
 * The two concerns that genuinely *are* baked into the runtime layer at build
 * time are routing and observability (`FredLayerOptions`). This module turns a
 * config into those options and into a ready-to-run Fred runtime layer, giving
 * Effect-native consumers a direct `config -> Layer` path (the friendly
 * Promise facade keeps applying the live-mutation sections through the
 * initializer).
 */
import { Layer } from 'effect';
import type { FrameworkConfig } from './types';
import { extractObservability } from './loader';
import { buildObservabilityLayers } from '../observability/otel';
import {
  makeFredRuntimeLayer,
  type FredLayerOptions,
  type FredServices,
} from '../services';

/**
 * Map a validated config to the build-time runtime-layer options.
 *
 * By default, observability layers are always built (an empty config yields
 * the default tracer/logger), while routing is set only when declared. A
 * facade that has explicit overrides can omit either output to avoid creating
 * unused runtime resources.
 */
export function configToLayerOptions(
  config: FrameworkConfig,
  selection: {
    readonly includeRouting?: boolean;
    readonly includeObservability?: boolean;
  } = {},
): FredLayerOptions {
  const options: FredLayerOptions = {};
  if (selection.includeObservability ?? true) {
    options.observabilityLayers = buildObservabilityLayers(extractObservability(config));
  }
  if ((selection.includeRouting ?? true) && config.routing) {
    // Guarantee `rules` is an array even for an unvalidated config —
    // MessageRouterService spreads it at dispatch and would crash on undefined.
    options.routingConfig = { ...config.routing, rules: config.routing.rules ?? [] };
  }
  return options;
}

/**
 * Compile a validated config into a complete Fred runtime layer: the base
 * Fred services composed with the config's routing and observability. Convert
 * it to a runtime with `ManagedRuntime.make` / `Layer.toRuntime`.
 */
export function configToLayers(config: FrameworkConfig): Layer.Layer<FredServices> {
  return makeFredRuntimeLayer(configToLayerOptions(config));
}
