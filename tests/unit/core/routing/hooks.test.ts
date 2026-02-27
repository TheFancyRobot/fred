/**
 * Tests for conditional afterRoutingDecision hook emission
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { MessageRouter } from '../../../../packages/core/src/routing/router';
import { AgentManager } from '../../../../packages/core/src/agent/manager';
import { HookManager } from '../../../../packages/core/src/hooks/manager';
import { ToolRegistry } from '../../../../packages/core/src/tool/registry';
import { Effect } from 'effect';
import type { HookEvent } from '../../../../packages/core/src/hooks/types';

describe('Conditional afterRoutingDecision Hook Emission', () => {
  let agentManager: AgentManager;
  let hookManager: HookManager;
  let router: MessageRouter;
  let hookEvents: HookEvent[];

  beforeEach(() => {
    const toolRegistry = new ToolRegistry();
    agentManager = new AgentManager(toolRegistry);
    hookManager = new HookManager();
    hookEvents = [];

    // Register hook to capture events
    hookManager.registerHook('afterRoutingDecision', async (event) => {
      hookEvents.push(event);
    });

    // Manually add agents to the internal map for testing
    const agentsMap = (agentManager as any).agents as Map<string, import('../../../../packages/core/src/agent/agent').AgentInstance>;
    agentsMap.set('agent-a', {
      id: 'agent-a',
      config: {
        id: 'agent-a',
        platform: 'openai',
        model: 'gpt-4',
      },
      processMessage: async () => ({ content: 'test' }),
    });

    agentsMap.set('agent-b', {
      id: 'agent-b',
      config: {
        id: 'agent-b',
        platform: 'openai',
        model: 'gpt-4',
      },
      processMessage: async () => ({ content: 'test' }),
    });
  });

  it('afterRoutingDecision hook emits when concerns exist (low confidence via fallback)', async () => {
    // No rules match "unmatched message", so the router falls back with confidence=0.5
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-a',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-a',
            patterns: ['^something else entirely$'],
          },
        ],
      },
    );

    const decision = await Effect.runPromise(
      router.route('unmatched message', {})
    );

    // Fallback confidence is 0.5 < 0.6 threshold -> low-confidence concern
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation!.concerns.length).toBeGreaterThan(0);
    expect(decision.explanation!.concerns[0].type).toBe('low-confidence');

    // Hook should have been emitted
    expect(hookEvents.length).toBe(1);
    expect(hookEvents[0].type).toBe('afterRoutingDecision');
    expect(hookEvents[0].data.concerns).toBeDefined();
    expect(hookEvents[0].data.concerns.length).toBeGreaterThan(0);
  });

  it('afterRoutingDecision hook emits when concerns exist (close alternatives)', async () => {
    // Two regex rules both match "test" with confidence=0.8, gap=0.0 < 0.1
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-a',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-a',
            patterns: ['test'],
            priority: 100,
          },
          {
            id: 'rule-2',
            agent: 'agent-b',
            patterns: ['test'],
            priority: 90,
          },
        ],
      },
    );

    const decision = await Effect.runPromise(
      router.route('test close alternatives', {})
    );

    // Both rules match at 0.8 confidence, gap < 0.1 -> close-alternatives concern
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation!.concerns.length).toBeGreaterThan(0);

    // Hook should have been emitted
    expect(hookEvents.length).toBe(1);
    expect(hookEvents[0].type).toBe('afterRoutingDecision');
  });

  it('afterRoutingDecision hook does NOT emit when confidence is high', async () => {
    // Exact match with anchored pattern -> confidence=1.0, no alternatives
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-a',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-a',
            patterns: ['^test high confidence$'],
          },
        ],
      },
    );

    const decision = await Effect.runPromise(
      router.route('test high confidence', {})
    );

    // Exact match confidence is 1.0 -> no concerns
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation!.concerns.length).toBe(0);

    // Hook should NOT have been emitted
    expect(hookEvents.length).toBe(0);
  });

  it('afterRoutingDecision hook failure does not crash routing', async () => {
    // Register hook that throws
    hookManager.registerHook('afterRoutingDecision', async () => {
      throw new Error('Hook failed');
    });

    // Fallback scenario to trigger concerns and thus the hook
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-a',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-a',
            patterns: ['^no match$'],
          },
        ],
      },
    );

    // Should not throw despite hook failure
    const decision = await Effect.runPromise(
      router.route('trigger fallback', {})
    );

    expect(decision).toBeDefined();
    expect(decision.agent).toBe('agent-a');
  });

  it('does not generate clarificationNeeded signal on low-confidence fallback', async () => {
    // Fallback scenario -> confidence=0.5 < 0.6
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-a',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-a',
            patterns: ['^no match here$'],
          },
        ],
      },
    );

    const decision = await Effect.runPromise(
      router.route('unmatched', {})
    );

    // Fallback path does not set clarificationNeeded (only the match path does)
    // But it does produce low-confidence concerns
    expect(decision.fallback).toBe(true);
    expect(decision.explanation).toBeDefined();
    expect(decision.explanation!.concerns.length).toBeGreaterThan(0);
    expect(decision.explanation!.concerns[0].type).toBe('low-confidence');
    expect(decision.clarificationNeeded).toBeUndefined();
  });

  it('clarificationNeeded PauseSignal generated when top-2 gap < 0.1', async () => {
    // Two regex rules both match with confidence=0.8, gap=0.0 < 0.1
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-a',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-a',
            patterns: ['test'],
            priority: 100,
          },
          {
            id: 'rule-2',
            agent: 'agent-b',
            patterns: ['test'],
            priority: 90,
          },
        ],
      },
    );

    const decision = await Effect.runPromise(
      router.route('test', {})
    );

    // Both match at 0.8 confidence, gap=0.0 < 0.1 -> clarification needed
    expect(decision.clarificationNeeded).toBeDefined();
    expect(decision.clarificationNeeded!.__pause).toBe(true);
    expect(decision.clarificationNeeded!.prompt).toContain('Close alternatives');
  });

  it('no clarificationNeeded when confidence is high', async () => {
    // Exact match -> confidence=1.0, no close alternatives
    router = new MessageRouter(
      agentManager,
      hookManager,
      {
        defaultAgent: 'agent-a',
        rules: [
          {
            id: 'rule-1',
            agent: 'agent-a',
            patterns: ['^test$'],
          },
        ],
      },
    );

    const decision = await Effect.runPromise(
      router.route('test', {})
    );

    // 1.0 confidence, single match -> no clarification needed
    expect(decision.clarificationNeeded).toBeUndefined();
  });
});
