import { Tool } from './tool';

/**
 * Handoff result indicating a message should be transferred to another agent
 */
export interface HandoffResult {
  type: 'handoff';
  agentId: string;
  message: string;
  context?: Record<string, any>;
}

/**
 * Create a handoff tool that allows agents to transfer conversations to other agents
 * @param agentManager - Function to get an agent by ID
 * @param availableAgents - Function to get list of available agent IDs
 */
export function createHandoffTool(
  getAgent: (id: string) => any,
  getAvailableAgents: () => string[]
): Tool {
  return {
    id: 'handoff_to_agent',
    name: 'handoff_to_agent',
    description: 'Transfer the conversation to another agent. Use this when the current agent cannot handle the request and another agent would be better suited.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'The ID of the agent to transfer the conversation to',
        },
        message: {
          type: 'string',
          description: 'The message to send to the target agent. If not provided, the original user message will be used.',
        },
        context: {
          type: 'object',
          description: 'Optional context to pass to the target agent',
        },
      },
      required: ['agentId'],
    },
    execute: async (args: { agentId: string; message?: string; context?: Record<string, any> }) => {
      const { agentId, message, context } = args;

      // Validate agent exists
      const agent = getAgent(agentId);
      if (!agent) {
        const availableAgents = getAvailableAgents();
        throw new Error(
          `Agent "${agentId}" not found. Available agents: ${availableAgents.join(', ') || 'none'}`
        );
      }

      // Return handoff result (will be processed by the message pipeline)
      const handoffResult: HandoffResult = {
        type: 'handoff',
        agentId,
        message: message || '', // Will be replaced with original message if not provided
        context,
      };

      return handoffResult;
    },
  };
}
