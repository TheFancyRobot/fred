/**
 * Phase 61 / STEP-61-04: configToLayers.
 *
 * Verifies the config -> FredLayerOptions mapping and that the compiled layer
 * produces a working Fred runtime whose services reflect the config.
 */
import { afterEach, describe, expect, it } from 'bun:test';
import { Effect, ManagedRuntime } from 'effect';
import { configToLayerOptions, configToLayers } from '../../../../packages/core/src/config/compile';
import { ToolRegistryService } from '../../../../packages/core/src/tool/service';
import { IntentMatcherService } from '../../../../packages/core/src/intent/service';
import type { FrameworkConfig } from '../../../../packages/core/src/config/types';
import { createCalculatorTool } from '../../../../packages/core/src/tool/calculator';

const runtimes: Array<{ dispose: () => Promise<void> }> = [];
const track = <R extends { dispose: () => Promise<void> }>(rt: R): R => {
  runtimes.push(rt);
  return rt;
};

afterEach(async () => {
  while (runtimes.length > 0) {
    await runtimes.pop()!.dispose();
  }
});

describe('configToLayerOptions', () => {
  it('always builds observability layers', () => {
    const options = configToLayerOptions({});
    expect(options.observabilityLayers).toBeDefined();
    expect(options.observabilityLayers?.tracerLayer).toBeDefined();
    expect(options.observabilityLayers?.loggerLayer).toBeDefined();
  });

  it('passes routing config through when declared', () => {
    const config: FrameworkConfig = { routing: { defaultAgent: 'concierge', rules: [] } };
    const options = configToLayerOptions(config);
    expect(options.routingConfig).toEqual({ defaultAgent: 'concierge', rules: [] });
  });

  it('leaves routingConfig unset when the config omits routing', () => {
    expect(configToLayerOptions({}).routingConfig).toBeUndefined();
  });
});

describe('configToLayers', () => {
  it('compiles into a runnable Fred runtime with the full service set present', async () => {
    // The compiled layer provides services; runtime initialization (calculator
    // registration etc.) is a separate concern owned by createFred/the client.
    // Here we only assert the layer composes a complete, runnable service set.
    const runtime = track(ManagedRuntime.make(configToLayers({})));
    const [tools, intents] = await runtime.runPromise(
      Effect.all([
        Effect.flatMap(ToolRegistryService, (s) => s.getAllTools()),
        Effect.flatMap(IntentMatcherService, (s) => s.getIntents()),
      ]),
    );
    expect(Array.isArray(tools)).toBe(true);
    expect(Array.isArray(intents)).toBe(true);
  });

  it('yields a working ToolRegistryService (register + read round-trips)', async () => {
    const runtime = track(ManagedRuntime.make(configToLayers({})));
    const ids = await runtime.runPromise(
      Effect.flatMap(ToolRegistryService, (s) =>
        Effect.gen(function* () {
          yield* s.registerTool(createCalculatorTool());
          const all = yield* s.getAllTools();
          return all.map((t) => t.id);
        }),
      ),
    );
    expect(ids).toContain('calculator');
  });

  it('compiles a routing-configured runtime that still resolves core services', async () => {
    const config: FrameworkConfig = { routing: { defaultAgent: 'assistant', rules: [] } };
    const runtime = track(ManagedRuntime.make(configToLayers(config)));
    const intents = await runtime.runPromise(
      Effect.flatMap(IntentMatcherService, (s) => s.getIntents()),
    );
    expect(Array.isArray(intents)).toBe(true);
  });
});
