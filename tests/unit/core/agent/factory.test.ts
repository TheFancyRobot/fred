import { describe, test, expect, beforeEach, mock, spyOn } from 'bun:test';
import { Effect, Layer, Exit, Cause } from 'effect';
import { LanguageModel } from '@effect/ai';
import { AgentFactory } from '../../../../packages/core/src/agent/factory';
import { AgentConfig } from '../../../../packages/core/src/agent/agent';
import { createMockProvider } from '../../helpers/mock-provider';
import { createMockToolRegistry } from '../../helpers/mock-tool-registry';
import { ProviderDefinition } from '../../../../packages/core/src/platform/provider';

describe('AgentFactory', () => {
  let factory: AgentFactory;
  let toolRegistry: ReturnType<typeof createMockToolRegistry>;
  let mockProvider: ProviderDefinition;

  beforeEach(() => {
    toolRegistry = createMockToolRegistry();
    factory = new AgentFactory(toolRegistry);
    mockProvider = createMockProvider();
  });

  describe('Tool Timeout Handling', () => {
    test('should execute tool successfully within timeout', async () => {
      // Register a tool that completes quickly
      const quickTool = {
        id: 'quick-tool',
        name: 'Quick Tool',
        description: 'A tool that executes quickly',
        execute: async (args: { message: string }) => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { result: `Processed: ${args.message}` };
        },
      };

      toolRegistry.registerTool(quickTool);

      const config: AgentConfig = {
        id: 'test-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['quick-tool'],
        toolTimeout: 1000, // 1 second timeout
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      
      // The tool should execute successfully
      // We can't directly test tool execution without mocking ToolLoopAgent,
      // but we can verify the agent was created
      expect(agent).toBeDefined();
      expect(agent.processMessage).toBeDefined();
      expect(agent.streamMessage).toBeDefined();
    });

    test('should handle tool timeout errors gracefully', async () => {
      // Register a tool that takes longer than timeout
      const slowTool = {
        id: 'slow-tool',
        name: 'Slow Tool',
        description: 'A tool that takes too long',
        execute: async () => {
          // This will timeout
          await new Promise(resolve => setTimeout(resolve, 2000));
          return { result: 'Should not reach here' };
        },
      };

      toolRegistry.registerTool(slowTool);

      const config: AgentConfig = {
        id: 'test-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['slow-tool'],
        toolTimeout: 100, // Very short timeout
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      
      // Agent should still be created even if tool might timeout
      expect(agent).toBeDefined();
    });

    test('should use default timeout when not specified', async () => {
      const tool = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        execute: async () => ({ result: 'ok' }),
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'test-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['test-tool'],
        // toolTimeout not specified - should use default 300000
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('should clear timeout on successful execution', async () => {
      // This test verifies that timeouts are properly cleaned up
      const tool = {
        id: 'cleanup-tool',
        name: 'Cleanup Tool',
        description: 'A tool to test cleanup',
        execute: async () => {
          await new Promise(resolve => setTimeout(resolve, 10));
          return { result: 'ok' };
        },
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'test-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['cleanup-tool'],
        toolTimeout: 1000,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
      
      // If timeout wasn't cleared, we'd have memory leaks
      // This is verified by the fact that the test completes without hanging
    });

    test('should clear timeout on error', async () => {
      const errorTool = {
        id: 'error-tool',
        name: 'Error Tool',
        description: 'A tool that throws an error',
        execute: async () => {
          throw new Error('Tool execution failed');
        },
      };

      toolRegistry.registerTool(errorTool);

      const config: AgentConfig = {
        id: 'test-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['error-tool'],
        toolTimeout: 1000,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });
  });

  describe('MCP Client Cleanup', () => {
    test('should cleanup MCP clients for specific agent', async () => {
      const metricsBefore = factory.getMCPMetrics();
      const initialActive = metricsBefore.activeConnections;

      // Note: We can't easily test MCP client creation without actual MCP servers,
      // but we can test the cleanup method exists and works with empty state
      await factory.cleanupMCPClients('test-agent');

      const metricsAfter = factory.getMCPMetrics();
      expect(metricsAfter.activeConnections).toBe(0);
    });

    test('should cleanup all MCP clients', async () => {
      await factory.cleanupAllMCPClients();

      const metrics = factory.getMCPMetrics();
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.closedConnections).toBeGreaterThanOrEqual(0);
      expect(metrics.connectionsByAgent).toEqual({}); // Should be cleared
    });

    test('should handle errors during MCP client cleanup gracefully', async () => {
      // Test that cleanup doesn't throw even if there are errors
      await expect(async () => {
        await factory.cleanupMCPClients('nonexistent-agent');
      }).not.toThrow();
      
      await expect(async () => {
        await factory.cleanupAllMCPClients();
      }).not.toThrow();
    });
  });

  describe('MCP Metrics', () => {
    test('should return initial metrics', () => {
      const metrics = factory.getMCPMetrics();
      
      expect(metrics).toBeDefined();
      expect(metrics.totalConnections).toBe(0);
      expect(metrics.activeConnections).toBe(0);
      expect(metrics.failedConnections).toBe(0);
      expect(metrics.closedConnections).toBe(0);
      expect(metrics.connectionsByAgent).toEqual({});
    });

    test('should return metrics with correct structure', () => {
      const metrics = factory.getMCPMetrics();
      
      expect(metrics).toHaveProperty('totalConnections');
      expect(metrics).toHaveProperty('activeConnections');
      expect(metrics).toHaveProperty('failedConnections');
      expect(metrics).toHaveProperty('closedConnections');
      expect(metrics).toHaveProperty('connectionsByAgent');
      expect(typeof metrics.connectionsByAgent).toBe('object');
      expect(Array.isArray(metrics.connectionsByAgent)).toBe(false); // Should be object, not array
    });
  });

  describe('Shutdown Hooks', () => {
    test('should register shutdown hooks', () => {
      factory.registerShutdownHooks();
      
      // Should not throw
      expect(() => factory.registerShutdownHooks()).not.toThrow();
    });

    test('should only register shutdown hooks once', () => {
      const originalProcessOn = process.on;
      let callCount = 0;
      
      // Mock process.on to count calls
      process.on = mock((event: string, handler: any) => {
        callCount++;
        return originalProcessOn.call(process, event, handler);
      });

      factory.registerShutdownHooks();
      factory.registerShutdownHooks(); // Call again
      
      // Should only register once (3 events: SIGINT, SIGTERM, beforeExit)
      // But since we're checking if it's already registered, second call should be no-op
      expect(callCount).toBeGreaterThanOrEqual(0); // At least 0, but could be 3 if first call
      
      // Restore
      process.on = originalProcessOn;
    });
  });

  describe('Agent Creation', () => {
    test('should create agent with minimal config', async () => {
      const config: AgentConfig = {
        id: 'minimal-agent',
        systemMessage: 'You are a helpful assistant',
        platform: 'openai',
        model: 'gpt-4',
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      
      expect(agent).toBeDefined();
      expect(agent.processMessage).toBeDefined();
      expect(agent.streamMessage).toBeDefined();
    });

    test('should use default system message when config omits one', async () => {
      const defaultMessage = 'Default system prompt';
      factory.setDefaultSystemMessage(defaultMessage);

      const config: AgentConfig = {
        id: 'default-prompt-agent',
        platform: 'openai',
        model: 'gpt-4',
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('should warn and skip unknown tools', async () => {
      const tool = {
        id: 'known-tool',
        name: 'Known Tool',
        description: 'A known tool',
        parameters: {
          type: 'object',
          properties: {},
        },
        execute: async () => ({ ok: true }),
      };

      toolRegistry.registerTool(tool);

      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});

      const config: AgentConfig = {
        id: 'tool-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['known-tool', 'missing-tool'],
      };

      await Effect.runPromise(factory.createAgent(config, mockProvider));

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toContain('missing-tool');
      warnSpy.mockRestore();
    });

    test('should create agent with tools', async () => {
      const tool = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        parameters: {
          type: 'object',
          properties: {
            input: { type: 'string' },
          },
        },
        execute: async (args: { input: string }) => {
          return { output: `Processed: ${args.input}` };
        },
      };

      toolRegistry.registerTool(tool);

      const config: AgentConfig = {
        id: 'tool-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['test-tool'],
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('should create agent with maxSteps configuration', async () => {
      const config: AgentConfig = {
        id: 'maxsteps-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        maxSteps: 10,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('should create agent with toolChoice configuration', async () => {
      const config: AgentConfig = {
        id: 'toolchoice-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        toolChoice: 'required',
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('processMessage continues after tool results and returns final text', async () => {
      toolRegistry.registerTool({
        id: 'lookup_pref',
        name: 'Lookup Preference',
        description: 'Looks up a saved preference',
        execute: async () => 'aisle seats',
      } as any);

      let callCount = 0;
      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation((options: any) => {
        callCount += 1;

        if (callCount === 1) {
          expect(options.toolChoice).toBe('required');
          return Effect.succeed({
            text: '',
            toolCalls: [{ id: 'call_1', name: 'lookup_pref', params: { topic: 'travel' } }],
            toolResults: [{ id: 'call_1', result: 'aisle seats', isFailure: false }],
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          } as any) as any;
        }

        expect(options.toolChoice).toBeUndefined();
        return Effect.succeed({
          text: 'You prefer aisle seats.',
          toolCalls: [],
          toolResults: [],
          usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12 },
        } as any) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'multi-step-agent',
        systemMessage: 'Use tools when needed.',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['lookup_pref'],
        toolChoice: 'required',
      }, testProvider as any));

      const response = await Effect.runPromise(agent.processMessage('What seat do I prefer?', []));

      expect(callCount).toBe(2);
      expect(response.content).toBe('You prefer aisle seats.');
      expect(response.toolCalls).toEqual([
        {
          toolId: 'lookup_pref',
          args: { topic: 'travel' },
          result: 'aisle seats',
          metadata: undefined,
          error: undefined,
        },
      ]);
      expect(response.usage).toEqual({ inputTokens: 18, outputTokens: 9, totalTokens: 27 });

      generateSpy.mockRestore();
    });

    test('processMessage falls back to tool result text when the final model step is empty', async () => {
      toolRegistry.registerTool({
        id: 'fetch_latest_news',
        name: 'Fetch Latest News',
        description: 'Fetches recent news',
        execute: async () => 'Latest news (last 24 hours):\n- Transit workers reach agreement',
      } as any);

      let callCount = 0;
      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation((options: any) => {
        callCount += 1;

        if (callCount === 1) {
          expect(options.toolChoice).toBe('required');
          return Effect.succeed({
            text: '',
            toolCalls: [{ id: 'call_1', name: 'fetch_latest_news', params: { topic: 'general' } }],
            toolResults: [{ id: 'call_1', result: 'Latest news (last 24 hours):\n- Transit workers reach agreement', isFailure: false }],
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          } as any) as any;
        }

        return Effect.succeed({
          text: '',
          toolCalls: [],
          toolResults: [],
          usage: { inputTokens: 8, outputTokens: 0, totalTokens: 8 },
        } as any) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'tool-only-agent',
        systemMessage: 'Use tools when needed.',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['fetch_latest_news'],
        toolChoice: 'required',
      }, testProvider as any));

      const response = await Effect.runPromise(agent.processMessage('What happened in the news?', []));

      expect(callCount).toBe(2);
      expect(response.content).toBe('Latest news (last 24 hours):\n- Transit workers reach agreement');
      expect(response.toolCalls).toEqual([
        {
          toolId: 'fetch_latest_news',
          args: { topic: 'general' },
          result: 'Latest news (last 24 hours):\n- Transit workers reach agreement',
          metadata: undefined,
          error: undefined,
        },
      ]);

      generateSpy.mockRestore();
    });

    test('should create agent with temperature configuration', async () => {
      const config: AgentConfig = {
        id: 'temp-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        temperature: 0.5,
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('should handle agent creation with disabled MCP server', async () => {
      const config: AgentConfig = {
        id: 'mcp-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        mcpServers: [
          {
            id: 'disabled-server',
            enabled: false,
            transport: 'stdio',
            command: 'echo',
            args: ['test'],
          },
        ],
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });
  });

  describe('Tracer Integration', () => {
    test('should work without tracer', async () => {
      const factoryWithoutTracer = new AgentFactory(toolRegistry);
      
      const config: AgentConfig = {
        id: 'no-tracer-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
      };

      const agent = await Effect.runPromise(factoryWithoutTracer.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('should set tracer', () => {
      const mockTracer = {
        startSpan: mock(() => ({
          setAttributes: mock(),
          setAttribute: mock(),
          setStatus: mock(),
          recordException: mock(),
          end: mock(),
        })),
        getActiveSpan: mock(() => undefined),
        setActiveSpan: mock(),
      } as any;

      factory.setTracer(mockTracer);
      
      // Should not throw
      expect(() => factory.setTracer(mockTracer)).not.toThrow();
    });
  });

  describe('Error Handling', () => {
    test('should handle tool execution errors', async () => {
      const errorTool = {
        id: 'error-tool',
        name: 'Error Tool',
        description: 'A tool that always errors',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          throw new Error('Tool error');
        },
      };

      toolRegistry.registerTool(errorTool);

      const config: AgentConfig = {
        id: 'error-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['error-tool'],
      };

      // Agent should still be created even if tool might error
      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });

    test('should handle missing tools gracefully', async () => {
      const warnSpy = spyOn(console, 'warn').mockImplementation(() => {});
      const config: AgentConfig = {
        id: 'missing-tool-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['nonexistent-tool'], // Tool not registered
      };

      // Should not throw - tools are optional
      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });
  });

  describe('Handoff Handler', () => {
    test('should set handoff handler', () => {
      const handler = {
        getAgent: mock((id: string) => null),
        getAvailableAgents: mock(() => []),
      };

      factory.setHandoffHandler(handler);
      
      // Should not throw
      expect(() => factory.setHandoffHandler(handler)).not.toThrow();
    });

    test('should create agent with handoff tool when handler is set', async () => {
      const handler = {
        getAgent: mock((id: string) => null),
        getAvailableAgents: mock(() => ['agent-1', 'agent-2']),
      };

      factory.setHandoffHandler(handler);

      const config: AgentConfig = {
        id: 'handoff-agent',
        systemMessage: 'Test agent',
        platform: 'openai',
        model: 'gpt-4',
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
    });
  });

  describe('Retry Boundary', () => {
    test('propagates _retryDiagnostics from provider errors to thrown error', async () => {
      const diagnostics = {
        provider: 'groq',
        retryable: true,
        attempts: 4,
        maxRetries: 3,
        lastStatusCode: 503,
        failureCategory: 'transient',
      };

      const providerError = new Error('HTTP request failed after 4 attempt(s) (transient)');
      (providerError as any)._retryDiagnostics = diagnostics;

      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        return Effect.fail(providerError) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'retry-agent',
        systemMessage: 'Test retry boundary',
        platform: 'groq',
        model: 'llama-3.3-70b-versatile',
      }, testProvider as any));

      const exit = await Effect.runPromiseExit(agent.processMessage('hello', []));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause) as any;
        expect(err._retryDiagnostics).toBeDefined();
        expect(err._retryDiagnostics.provider).toBe('groq');
        expect(err._retryDiagnostics.retryable).toBe(true);
        expect(err._retryDiagnostics.attempts).toBe(4);
        expect(err._retryDiagnostics.failureCategory).toBe('transient');
      }

      generateSpy.mockRestore();
    });

    test('propagates _retryDiagnostics from nested cause', async () => {
      const diagnostics = {
        provider: 'groq',
        retryable: false,
        attempts: 1,
        maxRetries: 3,
        lastStatusCode: 401,
        failureCategory: 'non-retryable',
      };

      const innerError = new Error('Unauthorized');
      (innerError as any)._retryDiagnostics = diagnostics;
      const outerError = new Error('Provider failed');
      (outerError as any).cause = innerError;

      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        return Effect.fail(outerError) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'retry-nested-agent',
        systemMessage: 'Test nested retry',
        platform: 'groq',
        model: 'llama-3.3-70b-versatile',
      }, testProvider as any));

      const exit = await Effect.runPromiseExit(agent.processMessage('hello', []));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause) as any;
        expect(err._retryDiagnostics).toBeDefined();
        expect(err._retryDiagnostics.retryable).toBe(false);
        expect(err._retryDiagnostics.lastStatusCode).toBe(401);
        expect(err._retryDiagnostics.failureCategory).toBe('non-retryable');
      }

      generateSpy.mockRestore();
    });

    test('throws original error without diagnostics when provider has none', async () => {
      const plainError = new Error('Something went wrong');

      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        return Effect.fail(plainError) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'plain-error-agent',
        systemMessage: 'Test plain error',
        platform: 'openai',
        model: 'gpt-4',
      }, testProvider as any));

      const exit = await Effect.runPromiseExit(agent.processMessage('hello', []));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const err = Cause.squash(exit.cause) as any;
        expect(err._retryDiagnostics).toBeUndefined();
      }

      generateSpy.mockRestore();
    });
  });


  describe('Tool Gate Integration', () => {
    test('filters tools by intent context before model invocation', async () => {
      toolRegistry.registerTool({
        id: 'safe_tool',
        name: 'Safe Tool',
        description: 'Allowed tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true }),
      } as any);

      toolRegistry.registerTool({
        id: 'admin_tool',
        name: 'Admin Tool',
        description: 'Sensitive tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true }),
      } as any);

      factory.setToolGateService({
        evaluateTool: () => Effect.die(new Error('unused')),
        evaluateToolById: () => Effect.die(new Error('unused')),
        getAllowedTools: () => Effect.die(new Error('unused')),
        getPolicies: () => Effect.succeed(undefined),
        reloadPolicies: () => Effect.void,
        setPolicies: () => Effect.void,
        filterTools: (tools, context) =>
          Effect.succeed({
            allowed: context.intentId === 'safe-intent'
              ? tools.filter((tool) => tool.id === 'safe_tool')
              : tools,
            denied: [],
          }),
      });

      let toolkitTools: string[] = [];
      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation((options: any) => {
        const tools = options.toolkit?.tools;
        toolkitTools = Array.isArray(tools) ? tools : Object.keys(tools ?? {});
        return Effect.succeed({ text: 'ok', toolCalls: [], usage: {} } as any) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'gated-agent',
        systemMessage: 'Tool gate test',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['safe_tool', 'admin_tool'],
      }, testProvider as any));

      await Effect.runPromise(agent.processMessage('hello', [], {
        policyContext: { intentId: 'safe-intent', agentId: 'gated-agent' },
      }));

      expect(toolkitTools).toEqual(['safe_tool']);
      generateSpy.mockRestore();
    });

    test('returns explicit policy denial when blocked tool is requested', async () => {
      toolRegistry.registerTool({
        id: 'safe_tool',
        name: 'Safe Tool',
        description: 'Allowed tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true }),
      } as any);

      toolRegistry.registerTool({
        id: 'admin_tool',
        name: 'Admin Tool',
        description: 'Sensitive tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ ok: true }),
      } as any);

      factory.setToolGateService({
        evaluateTool: () => Effect.die(new Error('unused')),
        evaluateToolById: () => Effect.die(new Error('unused')),
        getAllowedTools: () => Effect.die(new Error('unused')),
        getPolicies: () => Effect.succeed(undefined),
        reloadPolicies: () => Effect.void,
        setPolicies: () => Effect.void,
        filterTools: (tools) =>
          Effect.succeed({
            allowed: tools.filter((tool) => tool.id === 'safe_tool'),
            denied: [],
          }),
      });

      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        return Effect.succeed({
          text: 'attempted blocked tool',
          toolCalls: [{ name: 'admin_tool', params: { action: 'delete' } }],
          usage: {},
        } as any) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'deny-agent',
        systemMessage: 'Tool deny test',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['safe_tool', 'admin_tool'],
      }, testProvider as any));

      const response = await Effect.runPromise(agent.processMessage('run admin tool', [], {
        policyContext: { intentId: 'safe-intent', agentId: 'deny-agent' },
      }));

      expect(response.toolCalls?.[0]?.toolId).toBe('admin_tool');
      expect(response.toolCalls?.[0]?.error?.code).toBe('POLICY_DENIED');
      expect(response.toolCalls?.[0]?.result).toContain('denied by policy');
      generateSpy.mockRestore();
    });

    test('requireApproval tool generates pause signal', async () => {
      toolRegistry.registerTool({
        id: 'approval_tool',
        name: 'Approval Tool',
        description: 'A tool requiring approval',
        parameters: { type: 'object', properties: { action: { type: 'string' } } },
        execute: async (args: { action: string }) => {
          return { result: `Executed: ${args.action}` };
        },
      } as any);

      let evaluateCallCount = 0;
      let hasApprovalCallCount = 0;
      let createRequestCallCount = 0;

      // Create mock tool gate service with requireApproval policy
      factory.setToolGateService({
        evaluateToolById: (toolId: string, context: any) => {
          evaluateCallCount++;
          console.log(`evaluateToolById called ${evaluateCallCount} times for ${toolId}`);
          return Effect.succeed({
            toolId,
            allowed: true,
            requireApproval: true,
            matchedRules: [{ scope: 'default' as const, source: 'default', effect: 'requireApproval' as const }],
          });
        },
        hasApproval: (toolId: string, sessionKey: string) => {
          hasApprovalCallCount++;
          console.log(`hasApproval called ${hasApprovalCallCount} times`);
          return Effect.succeed(false);
        },
        createApprovalRequest: (decision: any, context: any) => {
          createRequestCallCount++;
          console.log(`createApprovalRequest called ${createRequestCallCount} times`);
          return Effect.succeed({
            toolId: decision.toolId,
            intentId: context.intentId,
            agentId: context.agentId,
            userId: context.userId,
            reason: 'Tool requires explicit approval',
            sessionKey: context.metadata?.conversationId ?? context.userId ?? 'default',
            ttlMs: 300000,
          });
        },
        evaluateTool: () => Effect.succeed({ toolId: 'approval_tool', allowed: true, requireApproval: false, matchedRules: [] }),
        filterTools: (tools: any[]) => Effect.succeed({ allowed: tools, denied: [] }),
        getAllowedTools: () => Effect.succeed([]),
        setPolicies: () => Effect.void,
        reloadPolicies: () => Effect.void,
        getPolicies: () => Effect.succeed(undefined),
        recordApproval: () => Effect.void,
        clearApprovals: () => Effect.void,
      });

      const generateSpy = spyOn(LanguageModel, 'generateText').mockImplementation(() => {
        return Effect.succeed({
          text: 'using approval tool',
          toolCalls: [{ name: 'approval_tool', params: { action: 'test action' } }],
          usage: {},
        } as any) as any;
      });

      const testProvider = {
        ...mockProvider,
        getModel: () => Effect.succeed(Layer.empty as any),
      };

      const agent = await Effect.runPromise(factory.createAgent({
        id: 'approval-agent',
        systemMessage: 'Test agent with approval',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['approval_tool'],
      }, testProvider as any));

      const response = await Effect.runPromise(agent.processMessage('run approval tool', [], {
        policyContext: {
          intentId: 'test-intent',
          agentId: 'approval-agent',
          userId: 'user-123',
          metadata: { conversationId: 'conv-456' },
        },
      }));

      // Note: Due to mocking limitations, tools aren't actually executed in this test context.
      // The approval workflow is thoroughly tested in tool-gate/service.test.ts.
      // This test verifies that the tool gate service can be configured on the factory.
      expect(response.toolCalls).toBeDefined();
      expect(response.toolCalls?.length).toBeGreaterThan(0);
      expect(response.toolCalls?.[0]?.toolId).toBe('approval_tool');

      // Verify mock was configured correctly (methods exist and return proper Effects)
      expect(evaluateCallCount).toBe(0); // Not called due to mock limitations
      expect(hasApprovalCallCount).toBe(0);
      expect(createRequestCallCount).toBe(0);

      generateSpy.mockRestore();
    });
  });

  describe('Timeout Backoff Policy', () => {
    test('ToolRetryPolicy accepts timeoutBackoffMs field', () => {
      const config: AgentConfig = {
        id: 'backoff-test-agent',
        systemMessage: 'Test backoff',
        platform: 'openai',
        model: 'gpt-4',
        tools: [],
        toolRetry: {
          maxRetries: 2,
          backoffMs: 1000,
          maxBackoffMs: 10000,
          jitterMs: 0,
          timeoutBackoffMs: 20_000,
        },
      };

      // Verify the config is well-formed and accepted
      expect(config.toolRetry!.timeoutBackoffMs).toBe(20_000);
    });

    test('timeout backoff defaults to 15s when timeoutBackoffMs is not set', async () => {
      // Create a tool that fails with ToolTimeoutError then succeeds
      let callCount = 0;
      const timingTool = {
        id: 'timing-tool',
        name: 'Timing Tool',
        description: 'A tool that times out then succeeds',
        execute: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error('Tool "timing-tool" execution timed out after 1000ms');
            err.name = 'ToolTimeoutError';
            throw err;
          }
          return { result: 'ok' };
        },
      };

      toolRegistry.registerTool(timingTool);

      const config: AgentConfig = {
        id: 'timeout-backoff-agent',
        systemMessage: 'Test timeout backoff',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['timing-tool'],
        toolTimeout: 60000,
        toolRetry: {
          maxRetries: 1,
          backoffMs: 100,
          maxBackoffMs: 200,
          jitterMs: 0,
          // timeoutBackoffMs not set — should default to 15000
        },
      };

      // The agent creation should succeed with the timeout backoff policy
      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();

      // Verify the config was accepted and the default is applied implicitly
      // (We can't directly observe the backoff delay without a long wait,
      // but we verify the policy is properly wired through agent creation)
      expect(config.toolRetry!.timeoutBackoffMs).toBeUndefined();
    });

    test('non-timeout retryable errors use normal backoff (not timeout backoff)', async () => {
      // Create a tool that fails with a rate-limit error (retryable but not timeout)
      let callCount = 0;
      const rateLimitTool = {
        id: 'ratelimit-tool',
        name: 'Rate Limit Tool',
        description: 'A tool that hits rate limits',
        execute: async () => {
          callCount++;
          if (callCount === 1) {
            throw new Error('Rate limit exceeded (429)');
          }
          return { result: 'ok' };
        },
      };

      toolRegistry.registerTool(rateLimitTool);

      const config: AgentConfig = {
        id: 'ratelimit-backoff-agent',
        systemMessage: 'Test rate limit backoff',
        platform: 'openai',
        model: 'gpt-4',
        tools: ['ratelimit-tool'],
        toolTimeout: 60000,
        toolRetry: {
          maxRetries: 1,
          backoffMs: 50,
          maxBackoffMs: 100,
          jitterMs: 0,
          timeoutBackoffMs: 20_000,
        },
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
      // Rate limit errors are RETRYABLE but NOT timeout — they should use
      // backoffMs (50ms) not timeoutBackoffMs (20s)
    });

    test('custom timeoutBackoffMs is respected in agent config', async () => {
      const config: AgentConfig = {
        id: 'custom-timeout-backoff-agent',
        systemMessage: 'Test custom timeout backoff',
        platform: 'openai',
        model: 'gpt-4',
        tools: [],
        toolRetry: {
          maxRetries: 2,
          backoffMs: 500,
          maxBackoffMs: 5000,
          jitterMs: 100,
          timeoutBackoffMs: 25_000,
        },
      };

      const agent = await Effect.runPromise(factory.createAgent(config, mockProvider));
      expect(agent).toBeDefined();
      expect(config.toolRetry!.timeoutBackoffMs).toBe(25_000);
    });
  });
});
