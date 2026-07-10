import { describe, expect, test } from 'bun:test';
import { Effect } from 'effect';
import {
  PromptResolutionError,
  PromptSourceService,
  type AgentPrompt,
  type PromptSourceContext,
} from '../../../packages/core/src/index';
import { BamlPromptSourceLayer } from '../../../packages/fred-baml/src/index';

const makeContext = (
  input: unknown = { topic: 'billing' },
): PromptSourceContext => ({
  agentId: 'support',
  input,
  renderTemplate: (template, variables) =>
    Effect.succeed(
      Object.entries(variables).reduce(
        (rendered, [name, value]) =>
          rendered.replaceAll(`{{${name}}}`, String(value)),
        template,
      ),
    ),
});

const resolvePromptEffect = (
  source: AgentPrompt,
  renderer: Parameters<typeof BamlPromptSourceLayer>[0],
  context: PromptSourceContext = makeContext(),
) =>
  Effect.flatMap(PromptSourceService, (service) =>
    service.resolve(source, context),
  ).pipe(Effect.provide(BamlPromptSourceLayer(renderer)));

const resolvePrompt = (
  source: AgentPrompt,
  renderer: Parameters<typeof BamlPromptSourceLayer>[0],
  context: PromptSourceContext = makeContext(),
) => Effect.runPromise(resolvePromptEffect(source, renderer, context));

describe('BamlPromptSourceLayer', () => {
  test('passes the BAML function, agent id, and input to the consumer renderer', async () => {
    const requests: Array<{
      readonly functionName: string;
      readonly agentId: string;
      readonly input: unknown;
    }> = [];
    const input = { topic: 'refunds' };

    const prompt = await resolvePrompt(
      { baml: { function: 'BuildSupportPrompt' } },
      async (request) => {
        requests.push(request);
        if (
          typeof request.input !== 'object' ||
          request.input === null ||
          !('topic' in request.input) ||
          typeof request.input.topic !== 'string'
        ) {
          throw new Error('Expected a topic input');
        }
        return `Help with ${request.input.topic}`;
      },
      makeContext(input),
    );

    expect(prompt).toBe('Help with refunds');
    expect(requests).toEqual([
      {
        functionName: 'BuildSupportPrompt',
        agentId: 'support',
        input,
      },
    ]);
  });

  test('delegates string and template prompts to the core resolver', async () => {
    let renderCalls = 0;
    const renderer = () => {
      renderCalls += 1;
      return 'not used';
    };

    await expect(resolvePrompt('Plain prompt', renderer)).resolves.toBe(
      'Plain prompt',
    );
    await expect(
      resolvePrompt(
        {
          template: 'Help {{customer}}',
          variables: { customer: 'Ada' },
        },
        renderer,
      ),
    ).resolves.toBe('Help Ada');
    expect(renderCalls).toBe(0);
  });

  test('maps renderer failures to PromptResolutionError', async () => {
    const failure = new Error('generated client unavailable');

    const result = await Effect.runPromise(
      Effect.either(
        resolvePromptEffect({ baml: { function: 'BuildSupportPrompt' } }, () => {
          throw failure;
        }),
      ),
    );

    expect(result).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'PromptResolutionError',
        agentId: 'support',
        source: 'baml',
        cause: failure,
      } satisfies Partial<InstanceType<typeof PromptResolutionError>>,
    });
  });

  test('rejects empty renderer output as PromptResolutionError', async () => {
    const result = await Effect.runPromise(
      Effect.either(
        resolvePromptEffect(
          { baml: { function: 'BuildSupportPrompt' } },
          () => '   ',
        ),
      ),
    );

    expect(result).toMatchObject({
      _tag: 'Left',
      left: {
        _tag: 'PromptResolutionError',
        agentId: 'support',
        source: 'baml',
        message: expect.stringContaining('returned an empty prompt'),
      },
    });
  });
});
