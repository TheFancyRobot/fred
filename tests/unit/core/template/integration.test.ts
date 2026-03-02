import { beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { Effect, Layer } from 'effect';
import { LanguageModel } from '@effect/ai';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import type { AgentConfig } from '../../../../packages/core/src/agent/agent';
import { createMockProvider } from '../../helpers/mock-provider';
import { createMockToolRegistry } from '../../helpers/mock-tool-registry';

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
      const agent = await factory.createAgent(config, provider as any);
      await agent.processMessage('hello');
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
      const agent = await factory.createAgent(
        {
          id: 'dynamic-vars',
          platform: 'openai',
          model: 'gpt-4o-mini',
          systemMessage: 'Hello <%= vars.name %>',
        },
        provider as any
      );

      const first = await agent.processMessage('hello');
      currentName = 'Grace';
      const second = await agent.processMessage('hello');

      expect(first.content).toBe('Hello Ada');
      expect(second.content).toBe('Hello Grace');
    } finally {
      generateSpy.mockRestore();
    }
  });
});
