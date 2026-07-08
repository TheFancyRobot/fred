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
 * Observability layers are always built (mirroring the initializer, which
 * applies `extractObservability(config)` unconditionally — an empty config
 * yields the default tracer/logger). Routing is only set when the config
 * declares it, so an undeclared routing block leaves the runtime's default
 * no-op router in place.
 */
export function configToLayerOptions(config: FrameworkConfig): FredLayerOptions {
  const options: FredLayerOptions = {
    observabilityLayers: buildObservabilityLayers(extractObservability(config)),
  };
  if (config.routing) {
    options.routingConfig = config.routing;
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
