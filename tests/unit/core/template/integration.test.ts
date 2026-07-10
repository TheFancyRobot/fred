import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { LanguageModel } from '@effect/ai';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import { PromptResolutionError } from '../../../../packages/core/src/agent/errors';
import { createMockProvider } from '../../helpers/mock-provider';
import { createMockToolRegistry } from '../../helpers/mock-tool-registry';
import { TemplateEngine, TemplateEngineLive } from '../../../../packages/core/src/template/engine';

const getRealTemplateEngine = (config?: { strict?: boolean }): TemplateEngine =>
  Effect.runSync(
    Effect.gen(function* () {
      return yield* TemplateEngine;
    }).pipe(Effect.provide(TemplateEngineLive({ strict: config?.strict ?? true })))
  );

describe('template integration', () => {
  let factory: AgentFactory;

  const provider = {
    ...createMockProvider(),
    getModel: () => Effect.succeed(Layer.empty as any),
  };

  beforeEach(() => {
    factory = new AgentFactory(createMockToolRegistry());
  });

  const captureSystemPrompt = async (config: AgentConfig): Promise<string> => {
    let capturedSystem = '';
    const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation((options: any) => {
      const messages = options.prompt?.content ?? [];
      const system = messages.find((message: any) => message.role === 'system');
      capturedSystem = system?.content ?? '';
      return Effect.succeed({ text: 'ok', toolCalls: [], usage: {} } as any) as any;
    });

    try {
      const agent = await Effect.runPromise(factory.createAgent(config, provider as any));
      await Effect.runPromise(agent.processMessage('hello'));
      return capturedSystem;
    } finally {
      generateSpy.mockRestore();
    }
  };

  test('passes through plain system messages unchanged', async () => {
    const system = await captureSystemPrompt({
      id: 'plain-agent',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'You are a plain assistant.',
    });

    expect(system).toBe('You are a plain assistant.');
  });

  test('maps prompt file loading failures to PromptResolutionError', async () => {
    const agent = await Effect.runPromise(factory.createAgent({
      id: 'invalid-prompt-path',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: '/outside-the-project/prompt.md',
    }, provider as any));

    const result = await Effect.runPromise(Effect.either(agent.processMessage('hello')));

    expect(result._tag).toBe('Left');
    if (result._tag === 'Right') {
      throw new Error('Expected prompt resolution to fail');
    }
    expect(result.left).toBeInstanceOf(PromptResolutionError);
    expect(result.left.agentId).toBe('invalid-prompt-path');
    expect(result.left.source).toBe('string');
    expect(result.left.message).toContain('Absolute paths are not allowed');
  });

  test('resolves ETA vars namespace in systemMessage', async () => {
    factory.setGlobalVariablesResolver(() => ({ name: 'Ada' }));
    (factory as any).setTemplateEngine?.({
      resolveBody: (template: string, context: any) =>
        Effect.succeed(template.replace('<%= vars.name %>', String(context.vars.name))),
    });

    const system = await captureSystemPrompt({
      id: 'vars-agent',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'Hello <%= vars.name %>',
    });

    expect(system).toBe('Hello Ada');
  });

  test('resolves ETA agent namespace in systemMessage', async () => {
    (factory as any).setTemplateEngine?.({
      resolveBody: (template: string, context: any) =>
        Effect.succeed(template.replace('<%= agent.id %>', String(context.agent.id))),
    });

    const system = await captureSystemPrompt({
      id: 'agent-ctx',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'Agent: <%= agent.id %>',
    });

    expect(system).toBe('Agent: agent-ctx');
  });

  test('resolves ETA env namespace with allowlisted values', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    (factory as any).setTemplateEngine?.({
      resolveBody: (template: string, context: any) =>
        Effect.succeed(template.replace('<%= env.NODE_ENV %>', String(context.env.NODE_ENV))),
    });

    try {
      const system = await captureSystemPrompt({
        id: 'env-agent',
        platform: 'openai',
        model: 'gpt-4o-mini',
        systemMessage: 'Environment: <%= env.NODE_ENV %>',
      });

      expect(system).toBe('Environment: test');
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  test('uses current variable snapshot on each message resolution', async () => {
    let currentName = 'Ada';
    factory.setGlobalVariablesResolver(() => ({ name: currentName }));
    (factory as any).setTemplateEngine?.({
      resolveBody: (template: string, context: any) =>
        Effect.succeed(template.replace('<%= vars.name %>', String(context.vars.name))),
    });

    const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation((options: any) => {
      return Effect.succeed({ text: options.prompt.content[0].content, toolCalls: [], usage: {} } as any) as any;
    });

    try {
      const agent = await Effect.runPromise(factory.createAgent(
        {
          id: 'dynamic-vars',
          platform: 'openai',
          model: 'gpt-4o-mini',
          systemMessage: 'Hello <%= vars.name %>',
        },
        provider as any
      ));

      const first = await Effect.runPromise(agent.processMessage('hello'));
      currentName = 'Grace';
      const second = await Effect.runPromise(agent.processMessage('hello'));

      expect(first.content).toBe('Hello Ada');
      expect(second.content).toBe('Hello Grace');
    } finally {
      generateSpy.mockRestore();
    }
  });
});

describe('template integration (real ETA engine)', () => {
  let factory: AgentFactory;

  const provider = {
    ...createMockProvider(),
    getModel: () => Effect.succeed(Layer.empty as any),
  };

  beforeEach(() => {
    factory = new AgentFactory(createMockToolRegistry());
    factory.setTemplateEngine(getRealTemplateEngine());
  });

  const captureSystemPrompt = async (config: AgentConfig): Promise<string> => {
    let capturedSystem = '';
    const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation((options: any) => {
      const messages = options.prompt?.content ?? [];
      const system = messages.find((message: any) => message.role === 'system');
      capturedSystem = system?.content ?? '';
      return Effect.succeed({ text: 'ok', toolCalls: [], usage: {} } as any) as any;
    });

    try {
      const agent = await Effect.runPromise(factory.createAgent(config, provider as any));
      await Effect.runPromise(agent.processMessage('hello'));
      return capturedSystem;
    } finally {
      generateSpy.mockRestore();
    }
  };

  test('renders vars.name with real ETA engine', async () => {
    factory.setGlobalVariablesResolver(() => ({ name: 'Ada' }));

    const system = await captureSystemPrompt({
      id: 'real-vars',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'Hello <%= vars.name %>',
    });

    expect(system).toBe('Hello Ada');
  });

  test('renders agent.id with real ETA engine', async () => {
    const system = await captureSystemPrompt({
      id: 'my-agent',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'Agent: <%= agent.id %>, model: <%= agent.model %>',
    });

    expect(system).toBe('Agent: my-agent, model: gpt-4o-mini');
  });

  test('renders env namespace with real ETA engine', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'staging';

    try {
      const system = await captureSystemPrompt({
        id: 'env-real',
        platform: 'openai',
        model: 'gpt-4o-mini',
        systemMessage: 'Running in <%= env.NODE_ENV %>',
      });

      expect(system).toBe('Running in staging');
    } finally {
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
    }
  });

  test('renders conditional logic with real ETA engine', async () => {
    factory.setGlobalVariablesResolver(() => ({ verbose: true }));

    const system = await captureSystemPrompt({
      id: 'conditional',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: '<% if (vars.verbose) { %>Be detailed in responses.<% } else { %>Be brief.<% } %>',
    });

    expect(system).toBe('Be detailed in responses.');
  });

  test('renders multi-expression template with real ETA engine', async () => {
    factory.setGlobalVariablesResolver(() => ({ role: 'tutor', subject: 'math' }));

    const system = await captureSystemPrompt({
      id: 'multi-expr',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'You are a <%= vars.role %> specializing in <%= vars.subject %>. Your agent ID is <%= agent.id %>.',
    });

    expect(system).toBe('You are a tutor specializing in math. Your agent ID is multi-expr.');
  });

  test('passes through plain text unchanged with real ETA engine', async () => {
    const system = await captureSystemPrompt({
      id: 'plain',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'No template syntax here.',
    });

    expect(system).toBe('No template syntax here.');
  });

  test('shadows dangerous globals with real ETA engine', async () => {
    const system = await captureSystemPrompt({
      id: 'security',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'require is <%= typeof require %>, process is <%= typeof process %>',
    });

    expect(system).toBe('require is undefined, process is undefined');
  });

  test('updates variable values between messages with real ETA engine', async () => {
    let currentRole = 'assistant';
    factory.setGlobalVariablesResolver(() => ({ role: currentRole }));

    const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation((options: any) => {
      const messages = options.prompt?.content ?? [];
      const system = messages.find((m: any) => m.role === 'system');
      return Effect.succeed({ text: system?.content ?? '', toolCalls: [], usage: {} } as any) as any;
    });

    try {
      const agent = await Effect.runPromise(factory.createAgent(
        {
          id: 'dynamic',
          platform: 'openai',
          model: 'gpt-4o-mini',
          systemMessage: 'You are a <%= vars.role %>.',
        },
        provider as any
      ));

      const first = await Effect.runPromise(agent.processMessage('hello'));
      currentRole = 'expert';
      const second = await Effect.runPromise(agent.processMessage('hello'));

      expect(first.content).toBe('You are a assistant.');
      expect(second.content).toBe('You are a expert.');
    } finally {
      generateSpy.mockRestore();
    }
  });

  test('renders frontmatter vars merged into template context with real ETA engine', async () => {
    factory.setGlobalVariablesResolver(() => ({ global: 'base' }));

    const system = await captureSystemPrompt({
      id: 'frontmatter-vars',
      platform: 'openai',
      model: 'gpt-4o-mini',
      systemMessage: 'Global: <%= vars.global %>, local: <%= vars.tone %>',
      vars: { tone: 'friendly' },
    } as AgentConfig & { vars: Record<string, string> });

    expect(system).toBe('Global: base, local: friendly');
  });

  test('allows FRED_* env vars and filters secrets with real ETA engine', async () => {
    const originalFredVar = process.env.FRED_TEST_VAR;
    process.env.FRED_TEST_VAR = 'allowed';

    try {
      const system = await captureSystemPrompt({
        id: 'env-filter',
        platform: 'openai',
        model: 'gpt-4o-mini',
        systemMessage: 'fred=<%= env.FRED_TEST_VAR %>',
      });

      expect(system).toBe('fred=allowed');
    } finally {
      if (originalFredVar === undefined) {
        delete process.env.FRED_TEST_VAR;
      } else {
        process.env.FRED_TEST_VAR = originalFredVar;
      }
    }
  });

  test('strict mode throws when referencing non-allowlisted env var with real ETA engine', async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-secret';

    try {
      const agent = await Effect.runPromise(
        factory.createAgent(
          {
            id: 'env-secret',
            platform: 'openai',
            model: 'gpt-4o-mini',
            systemMessage: 'key=<%= env.OPENAI_API_KEY %>',
          },
          provider as any,
        ),
      );
      const result = await Effect.runPromise(Effect.either(agent.processMessage('hello')));

      expect(result._tag).toBe('Left');
      if (result._tag === 'Right') {
        throw new Error('Expected prompt resolution to fail');
      }

      expect(result.left).toBeInstanceOf(PromptResolutionError);
      expect(result.left.agentId).toBe('env-secret');
      expect(result.left.source).toBe('string');
      expect(result.left.message).toContain('Undefined template value: env.OPENAI_API_KEY');
    } finally {
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });
});
