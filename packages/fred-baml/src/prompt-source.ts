import { Effect, Layer } from 'effect';
import {
  PromptResolutionError,
  PromptSourceService,
  isAgentBamlPrompt,
  resolveDefaultPromptSource,
  type PromptSourceContext,
} from '@fancyrobot/fred';

/** Values passed to a consumer-owned BAML prompt renderer. */
export interface BamlPromptRenderRequest {
  readonly functionName: string;
  readonly agentId: string;
  readonly input: unknown;
}

/**
 * Render a prompt with the consumer's generated BAML client.
 *
 * fred-baml deliberately accepts a function instead of importing generated
 * output so consumers retain control of their BAML version and module path.
 */
export type BamlPromptRenderer = (
  request: BamlPromptRenderRequest,
) => string | Promise<string>;

const renderBamlPrompt = (
  renderer: BamlPromptRenderer,
  functionName: string,
  context: PromptSourceContext,
): Effect.Effect<string, PromptResolutionError> =>
  Effect.tryPromise({
    try: async () =>
      renderer({
        functionName,
        agentId: context.agentId,
        input: context.input,
      }),
    catch: (cause) =>
      new PromptResolutionError({
        agentId: context.agentId,
        source: 'baml',
        message:
          `BAML prompt function "${functionName}" failed for agent ` +
          `"${context.agentId}".`,
        cause,
      }),
  }).pipe(
    Effect.flatMap((prompt) =>
      typeof prompt === 'string' && prompt.trim().length > 0
        ? Effect.succeed(prompt)
        : Effect.fail(
            new PromptResolutionError({
              agentId: context.agentId,
              source: 'baml',
              message:
                `BAML prompt function "${functionName}" returned an empty prompt ` +
                `for agent "${context.agentId}".`,
            }),
          ),
    ),
  );

/**
 * Supply BAML prompt rendering while preserving core string/template support.
 */
export const BamlPromptSourceLayer = (
  renderer: BamlPromptRenderer,
): Layer.Layer<PromptSourceService> =>
  Layer.succeed(PromptSourceService, {
    resolve: (source, context) =>
      isAgentBamlPrompt(source)
        ? renderBamlPrompt(renderer, source.baml.function, context)
        : resolveDefaultPromptSource(source, context),
  });
