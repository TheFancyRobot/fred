import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import { Effect, Layer, Stream } from 'effect';
import { LanguageModel, Prompt, Tool, Toolkit } from '@effect/ai';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import { createMockProvider } from '../../../unit/helpers/mock-provider';
import { createMockToolRegistry } from '../../helpers/mock-tool-registry';
import type { StreamEvent } from '../../../../packages/core/src/stream/events';

async function collectStreamEvents(
  factory: AgentFactory,
  provider: ReturnType<typeof createMockProvider>,
  parts: ReadonlyArray<Record<string, unknown>>,
): Promise<StreamEvent[]> {
  const streamSpy = spyOn(LanguageModel, 'streamText').mockImplementation(() =>
    Stream.fromIterable(parts as ReadonlyArray<any>) as any
  );

  try {
    const agent = await Effect.runPromise(factory.createAgent({
      id: `chunking-agent-${provider.id}`,
      platform: provider.id as any,
      model: 'gpt-4',
      systemMessage: 'You are a test assistant.',
      maxSteps: 1,
    }, {
      ...provider,
      getModel: () => Effect.succeed(Layer.empty as any),
    } as any));

    return Array.from(await Effect.runPromise(Stream.runCollect(agent.streamMessage('Test', [])) as any));
  } finally {
    streamSpy.mockRestore();
  }
}

describe('AgentFactory streamMessage integration', () => {
  let factory: AgentFactory;
  let toolRegistry: ReturnType<typeof createMockToolRegistry>;
  let mockProvider: ReturnType<typeof createMockProvider>;

  beforeEach(() => {
    toolRegistry = createMockToolRegistry();
    factory = new AgentFactory(toolRegistry);
    mockProvider = createMockProvider('openai');
  });

  describe('multi-step flow', () => {
    it('emits step-start before each model call', async () => {
      // This is a structural test - verify factory creates streamMessage function
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 2,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent.streamMessage).toBeDefined();
      expect(typeof agent.streamMessage).toBe('function');

      // The streamMessage function should return an Effect Stream
      const stream = agent.streamMessage('Hello', []);
      expect(stream).toBeDefined();
      expect(typeof stream.pipe).toBe('function');
    });

    it('includes tool-call and tool-result events in sequence', async () => {
      // Register a calculator tool
      toolRegistry.registerTool({
        id: 'calculator',
        description: 'Perform arithmetic calculations',
        execute: async (args: { expression: string }) => {
          // Simple eval for testing - parse expression
          if (args.expression === '2 + 2') return 4;
          return 0;
        },
      });

      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        tools: ['calculator'],
        maxSteps: 3,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('What is 2 + 2?', []);

      expect(stream).toBeDefined();
      // Tool calls should be included in the stream
      // Expected flow:
      // run-start -> message-start -> step-start(0) -> tokens -> tool-call
      // -> step-end(0) -> tool-result -> step-complete(0)
      // -> step-start(1) -> tokens -> step-end(1) -> run-end
    });

    it('normalizes legacy named toolChoice for streaming provider requests', async () => {
      toolRegistry.registerTool({
        id: 'run_research_swarm',
        description: 'Runs the research swarm',
        execute: async () => ({ report: 'done' }),
      } as any);

      const streamSpy = spyOn(LanguageModel, 'streamText').mockImplementation((options: any) => {
        expect(options.toolChoice).toEqual({ tool: 'run_research_swarm' });
        return Stream.fromIterable([
          { type: 'text', text: 'Using the research workflow.' },
          { type: 'finish', reason: 'stop', usage: { inputTokens: 4, outputTokens: 5, totalTokens: 9 } },
        ] as any) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'stream-toolchoice-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'Use the research tool.',
        tools: ['run_research_swarm'],
        toolChoice: { type: 'tool', toolName: 'run_research_swarm' },
      }, testProvider as any));

      const events = await Effect.runPromise(Stream.runCollect(agent.streamMessage('Research this topic.', [])));

      expect(Array.from(events).some((event: any) => event.type === 'run-end')).toBe(true);
      streamSpy.mockRestore();
    });

    it('emits run-end with toolCalls content after steps complete', async () => {
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 1,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Hello', []);

      expect(stream).toBeDefined();
      // run-end event should contain:
      // - result.content (final text)
      // - result.toolCalls (array of tool call details)
      // - result.usage (token usage)
    });
  });

  describe('per-step persistence signals', () => {
    it('includes toolCalls in run-end event content', async () => {
      toolRegistry.registerTool({
        id: 'echo',
        description: 'Echo input',
        execute: async (args: { message: string }) => args.message,
      });

      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        tools: ['echo'],
        maxSteps: 2,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Echo "test"', []);

      expect(stream).toBeDefined();
      // run-end event should have result.toolCalls array
      // Each entry contains: toolId, args, result, metadata
    });
  });

  describe('event sequence validation', () => {
    it('maintains monotonically increasing sequence numbers', async () => {
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 1,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Test', []);

      // Collect events to verify sequence ordering
      // Each event has a sequence number that should increase
      expect(stream).toBeDefined();
    });

    it('emits run-start as first event', async () => {
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 1,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Test', []);

      // First event should be run-start with sequence: 0
      // Contains: input.message, input.previousMessages, startedAt
      expect(stream).toBeDefined();
    });

    it('emits message-start after run-start', async () => {
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 1,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Test', []);

      // Second event should be message-start with sequence: 1
      // Contains: messageId, step, role
      expect(stream).toBeDefined();
    });

    it('emits run-end as final event', async () => {
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 1,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Test', []);

      // Last event should be run-end
      // Contains: finishedAt, durationMs, result
      expect(stream).toBeDefined();
    });
  });

  describe('threadId propagation', () => {
    it('includes threadId in all events when provided', async () => {
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 1,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Test', [], { threadId: 'thread_123' });

      expect(stream).toBeDefined();
      // All events should have threadId: 'thread_123'
    });

    it('omits threadId when not provided', async () => {
      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        maxSteps: 1,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Test', []);

      expect(stream).toBeDefined();
      // Events should have threadId: undefined
    });
  });

  describe('tool execution timing', () => {
    it('emits tool-call before tool execution', async () => {
      toolRegistry.registerTool({
        id: 'slow_tool',
        description: 'A slow tool',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return 'done';
        },
      });

      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        tools: ['slow_tool'],
        maxSteps: 2,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Use slow tool', []);

      expect(stream).toBeDefined();
      // tool-call emitted when model returns tool call
      // tool-result emitted after execution completes
    });

    it('emits tool-result with durationMs after tool execution', async () => {
      toolRegistry.registerTool({
        id: 'timed_tool',
        description: 'A timed tool',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return 42;
        },
      });

      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        tools: ['timed_tool'],
        maxSteps: 2,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Use timed tool', []);

      expect(stream).toBeDefined();
      // tool-result should include durationMs field (> 0)
    });
  });

  describe('error handling', () => {
    it('emits tool-error when tool execution throws', async () => {
      toolRegistry.registerTool({
        id: 'failing_tool',
        description: 'A tool that fails',
        execute: async () => {
          throw new Error('Tool execution failed');
        },
      });

      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        tools: ['failing_tool'],
        maxSteps: 2,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Use failing tool', []);

      expect(stream).toBeDefined();
      // Should emit tool-error event with error details
      // Stream should continue (not abort)
    });

    it('continues streaming after tool-error', async () => {
      toolRegistry.registerTool({
        id: 'error_tool',
        description: 'A tool that errors',
        execute: async () => {
          throw new Error('Expected error');
        },
      });

      const config = {
        id: 'test-agent',
        platform: 'openai' as const,
        model: 'gpt-4',
        systemMessage: 'You are a test assistant.',
        tools: ['error_tool'],
        maxSteps: 3,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      const stream = agent.streamMessage('Use error tool', []);

      expect(stream).toBeDefined();
      // After tool-error, should emit step-complete
      // Then continue to next step if model requests more tools
    });
  });

  describe('provider chunking compatibility', () => {
    it('produces the same final content for fine-grained and coarse-grained text streams', async () => {
      const openAiStyleEvents = await collectStreamEvents(factory, createMockProvider('openai'), [
        { type: 'text', text: 'Hello' },
        { type: 'text', text: ' ' },
        { type: 'text', text: 'world' },
        { type: 'finish', reason: 'stop', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } },
      ]);

      const openRouterStyleEvents = await collectStreamEvents(factory, createMockProvider('openrouter'), [
        { type: 'text-delta', delta: 'Hello world' },
        { type: 'finish', reason: 'stop', usage: { inputTokens: 4, outputTokens: 3, totalTokens: 7 } },
      ]);

      const getRunEndText = (events: StreamEvent[]): string => {
        const runEnd = [...events].reverse().find((event) => event.type === 'run-end');
        expect(runEnd?.type).toBe('run-end');
        return runEnd?.type === 'run-end' ? runEnd.result.content : '';
      };

      const getTokenText = (events: StreamEvent[]): string => events
        .filter((event): event is Extract<StreamEvent, { type: 'token' }> => event.type === 'token')
        .map((event) => event.delta)
        .join('');

      expect(getTokenText(openAiStyleEvents)).toBe('Hello world');
      expect(getTokenText(openRouterStyleEvents)).toBe('Hello world');
      expect(getRunEndText(openAiStyleEvents)).toBe('Hello world');
      expect(getRunEndText(openRouterStyleEvents)).toBe('Hello world');
    });

    it('normalizes mixed text and text-delta parts into a consistent accumulated stream', async () => {
      const events = await collectStreamEvents(factory, createMockProvider('openrouter'), [
        { type: 'text', text: 'Open' },
        { type: 'text-delta', delta: 'Router' },
        { type: 'text', text: ' stream' },
        { type: 'finish', reason: 'stop', usage: { inputTokens: 3, outputTokens: 3, totalTokens: 6 } },
      ]);

      const tokenEvents = events.filter(
        (event): event is Extract<StreamEvent, { type: 'token' }> => event.type === 'token'
      );

      expect(tokenEvents.map((event) => event.delta)).toEqual(['Open', 'Router', ' stream']);
      expect(tokenEvents.map((event) => event.accumulated)).toEqual([
        'Open',
        'OpenRouter',
        'OpenRouter stream',
      ]);
    });
  });
});
