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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isPromptVariable = (value: unknown): value is AgentPromptVariable =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

const isPromptVariables = (
  value: unknown
): value is Readonly<Record<string, AgentPromptVariable>> | undefined =>
  value === undefined || (isRecord(value) && Object.values(value).every(isPromptVariable));

export const isAgentTemplatePrompt = (source: unknown): source is AgentTemplatePrompt =>
  isRecord(source) &&
  typeof source.template === 'string' &&
  !('baml' in source) &&
  isPromptVariables(source.variables);

export const isAgentBamlPrompt = (source: unknown): source is AgentBamlPrompt =>
  isRecord(source) &&
  isRecord(source.baml) &&
  typeof source.baml.function === 'string' &&
  !('template' in source) &&
  !('variables' in source);

/** Resolve the source forms owned by core. Adapters delegate to this helper. */
export const resolveDefaultPromptSource = (
  source: unknown,
  context: PromptSourceContext
): Effect.Effect<string, PromptSourceError> => {
  if (typeof source === 'string') {
    return context.renderTemplate(source, {}, 'string');
  }

  if (isAgentTemplatePrompt(source)) {
    return context.renderTemplate(source.template, source.variables ?? {}, 'template');
  }

  if (isAgentBamlPrompt(source)) {
    return Effect.fail(new MissingPromptSourceAdapterError({
      agentId: context.agentId,
      functionName: source.baml.function,
      message:
        `Agent "${context.agentId}" uses BAML prompt function "${source.baml.function}", ` +
        'but no BAML prompt adapter is configured. Install @fancyrobot/fred-baml ' +
        'and provide BamlPromptSourceLayer.',
    }));
  }

  const sourceKind = isRecord(source) && 'baml' in source ? 'baml' : 'template';
  return Effect.fail(new PromptResolutionError({
    agentId: context.agentId,
    source: sourceKind,
    message: `Agent "${context.agentId}" has an invalid ${sourceKind} prompt source.`,
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
