import { Cause, Effect, Exit, Layer, Schema } from 'effect';
import { AiError, LanguageModel } from '@effect/ai';
import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import {
  AgentInputValidationError,
  AgentOutputValidationError,
} from '../../../../packages/core/src/agent/errors';
import type { ProviderDefinition } from '../../../../packages/core/src/platform/provider';
import { createMockProvider } from '../../helpers/mock-provider';
import { createMockToolRegistry } from '../../helpers/mock-tool-registry';

const OutputSchema = Schema.Struct({
  answer: Schema.String,
});

const makeProvider = (): ProviderDefinition => ({
  ...createMockProvider(),
  getModel: () => Effect.succeed(Layer.empty as any),
});

const structuredResponse = (answer: string) => ({
  value: { answer },
  text: JSON.stringify({ answer }),
  usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 },
});

const malformedOutput = () => new AiError.MalformedOutput({
  module: 'TestProvider',
  method: 'generateObject',
  description: 'Response did not match the output schema',
});

type Equal<Left, Right> =
  (<T>() => T extends Left ? 1 : 2) extends
    (<T>() => T extends Right ? 1 : 2)
    ? true
    : false;
type Assert<T extends true> = T;

describe('AgentFactory typed input and output', () => {
  let factory: AgentFactory;
  const activeSpies: Array<{ mockRestore(): void }> = [];

  beforeEach(() => {
    factory = new AgentFactory(createMockToolRegistry());
  });

  afterEach(() => {
    for (const activeSpy of activeSpies.splice(0)) {
      activeSpy.mockRestore();
    }
  });

  it('validates typed run input before making a provider call', async () => {
    let providerCalls = 0;
    activeSpies.push(
      spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        providerCalls += 1;
        return Effect.succeed({
          text: 'unexpected',
          toolCalls: [],
          toolResults: [],
          usage: {},
        } as any) as any;
      }),
    );
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'typed-input-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Validate input first.',
      input: Schema.Struct({
        text: Schema.String.pipe(Schema.minLength(1)),
      }),
    }, makeProvider()));

    const exit = await Effect.runPromiseExit(agent.run({ text: '' }));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBeInstanceOf(AgentInputValidationError);
    }
    expect(providerCalls).toBe(0);
  });

  it('infers the direct run input and decoded response output types', async () => {
    const InputSchema = Schema.Struct({ text: Schema.String });
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'typed-contract-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Expose a typed handle.',
      input: InputSchema,
      output: OutputSchema,
    }, makeProvider()));

    type InputMatches = Assert<Equal<
      Parameters<typeof agent.run>[0],
      { readonly text: string }
    >>;
    type Response = Effect.Effect.Success<ReturnType<typeof agent.run>>;
    type OutputMatches = Assert<Equal<
      Response['output'],
      { readonly answer: string } | undefined
    >>;
    const typeAssertions: [InputMatches, OutputMatches] = [true, true];
    expect(typeAssertions).toEqual([true, true]);
  });

  it('validates direct run input on the schema Type side before encoding it', async () => {
    let providerCalls = 0;
    activeSpies.push(
      spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        providerCalls += 1;
        return Effect.succeed({
          text: 'accepted',
          toolCalls: [],
          toolResults: [],
          usage: {},
        } as any) as any;
      }),
    );
    const InputSchema = Schema.Struct({ requestedAt: Schema.DateFromString });
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'transformed-input-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Accept transformed input.',
      input: InputSchema,
    }, makeProvider()));

    const response = await Effect.runPromise(agent.run({
      requestedAt: new Date('2026-07-10T00:00:00.000Z'),
    }));

    expect(response.content).toBe('accepted');
    expect(providerCalls).toBe(1);
  });

  it('lets string-encoded schemas decode raw processMessage JSON', async () => {
    let providerCalls = 0;
    activeSpies.push(
      spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        providerCalls += 1;
        return Effect.succeed({
          text: 'decoded',
          toolCalls: [],
          toolResults: [],
          usage: {},
        } as any) as any;
      }),
    );
    const InputSchema = Schema.parseJson(Schema.Struct({ value: Schema.String }));
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'json-string-input-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Decode the raw JSON string.',
      input: InputSchema,
    }, makeProvider()));

    const response = await Effect.runPromise(
      agent.processMessage('{"value":"preserved"}'),
    );

    expect(response.content).toBe('decoded');
    expect(providerCalls).toBe(1);
  });

  it('keeps processMessage conversational for object-shaped typed agents', async () => {
    let providerCalls = 0;
    activeSpies.push(
      spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        providerCalls += 1;
        return Effect.succeed({
          text: 'routed',
          toolCalls: [],
          toolResults: [],
          usage: {},
        } as any) as any;
      }),
    );
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'routed-typed-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Handle routed conversational messages.',
      input: Schema.Struct({ requestId: Schema.String }),
    }, makeProvider()));

    const response = await Effect.runPromise(
      agent.processMessage('I need a refund'),
    );

    expect(response.content).toBe('routed');
    expect(providerCalls).toBe(1);
  });

  it('rejects output schemas that do not encode to an object', async () => {
    const exit = await Effect.runPromiseExit(factory.createAgent({
      id: 'scalar-output-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Return a scalar.',
      output: Schema.String,
    }, makeProvider()));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(String(Cause.squash(exit.cause))).toContain(
        'output schema must encode to an object',
      );
    }
  });

  it('returns decoded generateObject output', async () => {
    let providerCalls = 0;
    activeSpies.push(
      spyOn(LanguageModel, 'generateObject').mockImplementation(() => {
        providerCalls += 1;
        return Effect.succeed(structuredResponse('typed answer')) as any;
      }),
    );
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'structured-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Return a structured answer.',
      output: OutputSchema,
    }, makeProvider()));

    const response = await Effect.runPromise(agent.run('hello'));

    expect(providerCalls).toBe(1);
    expect(response.output).toEqual({ answer: 'typed answer' });
    expect(response.content).toBe('{"answer":"typed answer"}');
    expect(response.usage).toEqual({
      inputTokens: 2,
      outputTokens: 3,
      totalTokens: 5,
    });
  });

  it('derives a provider-safe structured object name from namespaced agent ids', async () => {
    let objectName = '';
    activeSpies.push(
      spyOn(LanguageModel, 'generateObject').mockImplementation((options: any) => {
        objectName = options.objectName;
        return Effect.succeed(structuredResponse('safe name')) as any;
      }),
    );
    const agent = await Effect.runPromise(factory.createAgent({
      id: `billing.v1.${'tenant.'.repeat(12)}classifier`,
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Return a structured answer.',
      output: OutputSchema,
    }, makeProvider()));

    await Effect.runPromise(agent.run('hello'));

    expect(objectName).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(objectName.length).toBeLessThanOrEqual(64);
    expect(objectName).toStartWith('billing_v1_');
  });

  it('retries MalformedOutput and succeeds within the configured retry budget', async () => {
    let providerCalls = 0;
    activeSpies.push(
      spyOn(LanguageModel, 'generateObject').mockImplementation(() => {
        providerCalls += 1;
        return providerCalls === 1
          ? Effect.fail(malformedOutput()) as any
          : Effect.succeed(structuredResponse('recovered')) as any;
      }),
    );
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'retry-success-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Return structured output.',
      output: OutputSchema,
      outputRetry: { maxRetries: 1 },
    }, makeProvider()));

    const response = await Effect.runPromise(agent.run('hello'));

    expect(providerCalls).toBe(2);
    expect(response.output).toEqual({ answer: 'recovered' });
  });

  it('maps exhausted MalformedOutput retries to AgentOutputValidationError', async () => {
    let providerCalls = 0;
    activeSpies.push(
      spyOn(LanguageModel, 'generateObject').mockImplementation(() => {
        providerCalls += 1;
        return Effect.fail(malformedOutput()) as any;
      }),
    );
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'retry-exhausted-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Return structured output.',
      output: OutputSchema,
      outputRetry: { maxRetries: 2 },
    }, makeProvider()));

    const exit = await Effect.runPromiseExit(agent.run('hello'));

    expect(providerCalls).toBe(3);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);
      expect(error).toBeInstanceOf(AgentOutputValidationError);
      if (error instanceof AgentOutputValidationError) {
        expect(error.agentId).toBe('retry-exhausted-agent');
        expect(error.attempts).toBe(3);
        expect(error.maxRetries).toBe(2);
      }
    }
  });

  it('does not retry non-malformed provider failures', async () => {
    let providerCalls = 0;
    const providerError = new AiError.UnknownError({
      module: 'TestProvider',
      method: 'generateObject',
      description: 'Provider unavailable',
    });
    activeSpies.push(
      spyOn(LanguageModel, 'generateObject').mockImplementation(() => {
        providerCalls += 1;
        return Effect.fail(providerError) as any;
      }),
    );
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'no-retry-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Return structured output.',
      output: OutputSchema,
      outputRetry: { maxRetries: 5 },
    }, makeProvider()));

    const exit = await Effect.runPromiseExit(agent.run('hello'));

    expect(providerCalls).toBe(1);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(providerError);
    }
  });

  it('does not expose streamMessage when an output schema is configured', async () => {
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'non-streaming-output-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Return structured output.',
      output: OutputSchema,
    }, makeProvider()));

    expect(agent.streamMessage).toBeUndefined();
  });

  it('preserves tool results before the final structured generation pass', async () => {
    const registry = createMockToolRegistry();
    let structuredPrompt: unknown[] = [];
    registry.registerTool({
      id: 'lookup',
      description: 'Look up a value',
      execute: async () => ({ value: 42 }),
    } as any);
    const toolFactory = new AgentFactory(registry);
    activeSpies.push(
      spyOn(LanguageModel, 'generateText').mockImplementation(() =>
        Effect.succeed({
          text: 'Looking it up.',
          toolCalls: [{ id: 'call_1', name: 'lookup', params: { key: 'answer' } }],
          toolResults: [{ id: 'call_1', result: { value: 42 }, isFailure: false }],
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        } as any) as any
      ),
    );
    activeSpies.push(
      spyOn(LanguageModel, 'generateObject').mockImplementation((options: any) => {
        structuredPrompt = options.prompt?.content ?? [];
        return Effect.succeed(structuredResponse('42')) as any;
      }),
    );
    const agent = await Effect.runPromise(toolFactory.createAgent({
      id: 'structured-tool-agent',
      platform: 'openai',
      model: 'gpt-4',
      systemMessage: 'Use tools, then return structured output.',
      tools: ['lookup'],
      maxSteps: 1,
      output: OutputSchema,
    }, makeProvider()));

    const response = await Effect.runPromise(agent.run('look it up'));

    expect(response.toolCalls).toEqual([
      expect.objectContaining({
        toolId: 'lookup',
        result: { value: 42 },
      }),
    ]);
    expect(response.output).toEqual({ answer: '42' });
    expect(JSON.stringify(structuredPrompt).match(/Looking it up\./g)).toHaveLength(1);
    expect(response.usage).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      totalTokens: 7,
    });
  });
});
