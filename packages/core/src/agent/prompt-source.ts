import { Context, Effect, Layer } from 'effect';
import type {
  AgentBamlPrompt,
  AgentPrompt,
  AgentPromptVariable,
  AgentTemplatePrompt,
} from './agent';
import {
  MissingPromptSourceAdapterError,
  PromptResolutionError,
} from './errors';

export type PromptSourceError = MissingPromptSourceAdapterError | PromptResolutionError;

export interface PromptSourceContext {
  readonly agentId: string;
  readonly input: unknown;
  readonly renderTemplate: (
    template: string,
    variables: Readonly<Record<string, AgentPromptVariable>>,
    source: 'string' | 'template'
  ) => Effect.Effect<string, PromptResolutionError>;
}

export interface PromptSourceService {
  readonly resolve: (
    source: AgentPrompt,
    context: PromptSourceContext
  ) => Effect.Effect<string, PromptSourceError>;
}

export const PromptSourceService = Context.GenericTag<PromptSourceService>(
  '@fancyrobot/fred/PromptSourceService'
);

export const isAgentTemplatePrompt = (source: AgentPrompt): source is AgentTemplatePrompt =>
  typeof source === 'object' && source !== null && 'template' in source;

export const isAgentBamlPrompt = (source: AgentPrompt): source is AgentBamlPrompt =>
  typeof source === 'object' && source !== null && 'baml' in source;

/** Resolve the source forms owned by core. Adapters delegate to this helper. */
export const resolveDefaultPromptSource = (
  source: AgentPrompt,
  context: PromptSourceContext
): Effect.Effect<string, PromptSourceError> => {
  if (typeof source === 'string') {
    return context.renderTemplate(source, {}, 'string');
  }

  if (isAgentTemplatePrompt(source)) {
    return context.renderTemplate(source.template, source.variables, 'template');
  }

  return Effect.fail(new MissingPromptSourceAdapterError({
    agentId: context.agentId,
    functionName: source.baml.function,
    message:
      `Agent "${context.agentId}" uses BAML prompt function "${source.baml.function}", ` +
      'but no BAML prompt adapter is configured. Install @fancyrobot/fred-baml ' +
      'and provide BamlPromptSourceLayer.',
  }));
};

export const DefaultPromptSourceService: PromptSourceService = {
  resolve: resolveDefaultPromptSource,
};

export const DefaultPromptSourceLayer = Layer.succeed(
  PromptSourceService,
  DefaultPromptSourceService
);

/** Conventional service-layer alias. */
export const PromptSourceServiceLive = DefaultPromptSourceLayer;
