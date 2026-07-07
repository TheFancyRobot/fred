import { Effect } from 'effect';
import { AgentInstance, AgentMessage, AgentResponse } from '../../../packages/core/src/agent/agent';

/**
 * Create a mock agent instance for testing.
 *
 * processMessage returns an Effect, matching the real AgentInstance
 * contract (packages/core/src/agent/agent.ts) — production code composes
 * it with yield* / Effect.mapError, never awaits it as a Promise.
 */
export function createMockAgent(
  id: string,
  config?: Partial<AgentInstance['config']>
): AgentInstance {
  const defaultConfig = {
    id,
    systemMessage: 'You are a helpful assistant.',
    platform: 'openai',
    model: 'gpt-4',
    ...config,
  };

  return {
    id,
    config: defaultConfig as AgentInstance['config'],
    processMessage: (message: string, previousMessages?: AgentMessage[]): Effect.Effect<AgentResponse, Error> =>
      Effect.succeed({
        content: `Mock response to: ${message}`,
        toolCalls: [],
      }),
  };
}

/**
 * Create a mock agent that returns a specific response
 */
export function createMockAgentWithResponse(
  id: string,
  response: AgentResponse,
  config?: Partial<AgentInstance['config']>
): AgentInstance {
  const agent = createMockAgent(id, config);
  agent.processMessage = () => Effect.succeed(response);
  return agent;
}

/**
 * Create a mock agent that fails with an error
 */
export function createMockAgentWithError(
  id: string,
  error: Error,
  config?: Partial<AgentInstance['config']>
): AgentInstance {
  const agent = createMockAgent(id, config);
  agent.processMessage = () => Effect.fail(error);
  return agent;
}
