import { Cause, Effect, Exit } from 'effect';
import { describe, expect, it } from 'bun:test';
import {
  MissingPromptSourceAdapterError,
  PromptResolutionError,
} from '../../../../packages/core/src/agent/errors';
import {
  isAgentBamlPrompt,
  isAgentTemplatePrompt,
  resolveDefaultPromptSource,
  type PromptSourceContext,
} from '../../../../packages/core/src/agent/prompt-source';

describe('default prompt source resolution', () => {
  it('routes string prompts through the template renderer with no source variables', async () => {
    const calls: Array<{
      template: string;
      variables: Readonly<Record<string, string | number | boolean>>;
      source: 'string' | 'template';
    }> = [];
    const context: PromptSourceContext = {
      agentId: 'plain-agent',
      input: 'hello',
      renderTemplate: (template, variables, source) =>
        Effect.sync(() => {
          calls.push({ template, variables, source });
          return `rendered:${template}`;
        }),
    };

    const prompt = await Effect.runPromise(
      resolveDefaultPromptSource('You are helpful.', context),
    );

    expect(prompt).toBe('rendered:You are helpful.');
    expect(calls).toEqual([
      { template: 'You are helpful.', variables: {}, source: 'string' },
    ]);
  });

  it('routes template prompts with their declared variables', async () => {
    const calls: Array<{
      template: string;
      variables: Readonly<Record<string, string | number | boolean>>;
      source: 'string' | 'template';
    }> = [];
    const context: PromptSourceContext = {
      agentId: 'template-agent',
      input: { topic: 'Effect' },
      renderTemplate: (template, variables, source) =>
        Effect.sync(() => {
          calls.push({ template, variables, source });
          return 'rendered template';
        }),
    };
    const variables = { role: 'tutor', attempts: 2, verbose: true } as const;

    const prompt = await Effect.runPromise(
      resolveDefaultPromptSource(
        { template: 'Act as <%= vars.role %>.', variables },
        context,
      ),
    );

    expect(prompt).toBe('rendered template');
    expect(calls).toEqual([
      {
        template: 'Act as <%= vars.role %>.',
        variables,
        source: 'template',
      },
    ]);
  });

  it('defaults variable-free template prompts to an empty variable record', async () => {
    const calls: Array<Readonly<Record<string, string | number | boolean>>> = [];
    const context: PromptSourceContext = {
      agentId: 'variable-free-template-agent',
      input: 'hello',
      renderTemplate: (_template, variables) =>
        Effect.sync(() => {
          calls.push(variables);
          return 'rendered template';
        }),
    };

    const prompt = await Effect.runPromise(
      resolveDefaultPromptSource({ template: 'You are helpful.' }, context),
    );

    expect(prompt).toBe('rendered template');
    expect(calls).toEqual([{}]);
  });

  it('rejects malformed runtime prompt shapes in type guards', async () => {
    expect(isAgentTemplatePrompt({ template: 42 })).toBe(false);
    expect(isAgentTemplatePrompt({ template: 'Valid', variables: { nested: {} } })).toBe(false);
    expect(isAgentTemplatePrompt({ template: 'Ambiguous', baml: { function: 'Build' } })).toBe(false);
    expect(isAgentBamlPrompt({ baml: {} })).toBe(false);
    expect(isAgentBamlPrompt({ baml: { function: 42 } })).toBe(false);
    expect(isAgentBamlPrompt({ baml: { function: 'Build' }, template: 'Ambiguous' })).toBe(false);

    const context: PromptSourceContext = {
      agentId: 'invalid-runtime-prompt-agent',
      input: 'hello',
      renderTemplate: () => Effect.succeed('unexpected'),
    };
    const exit = await Effect.runPromiseExit(
      resolveDefaultPromptSource({ baml: {} }, context),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(PromptResolutionError);
    }
  });

  it('fails BAML prompts with actionable adapter remediation', async () => {
    let renderCalls = 0;
    const context: PromptSourceContext = {
      agentId: 'baml-agent',
      input: 'hello',
      renderTemplate: () => {
        renderCalls += 1;
        return Effect.succeed('unexpected');
      },
    };

    const exit = await Effect.runPromiseExit(
      resolveDefaultPromptSource(
        { baml: { function: 'BuildAgentPrompt' } },
        context,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(MissingPromptSourceAdapterError);
      if (error instanceof MissingPromptSourceAdapterError) {
        expect(error.agentId).toBe('baml-agent');
        expect(error.functionName).toBe('BuildAgentPrompt');
        expect(error.message).toContain('Install @fancyrobot/fred-baml');
        expect(error.message).toContain('BamlPromptSourceLayer');
      }
    }
    expect(renderCalls).toBe(0);
  });
});
