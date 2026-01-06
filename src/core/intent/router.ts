import { IntentMatch, Action } from './intent';
import { AgentManager } from '../agent/manager';
import { AgentMessage } from '../agent/agent';

/**
 * Action executor for routing intents to actions
 */
export class IntentRouter {
  private agentManager: AgentManager;
  private actionHandlers: Map<string, (action: Action, payload?: any) => Promise<any>> = new Map();
  private defaultAgentId?: string;

  constructor(agentManager: AgentManager) {
    this.agentManager = agentManager;
    
    // Register default action handlers
    this.registerActionHandler('agent', this.handleAgentAction.bind(this));
    this.registerActionHandler('function', this.handleFunctionAction.bind(this));
  }

  /**
   * Set the default agent ID for fallback routing
   */
  setDefaultAgent(agentId: string): void {
    this.defaultAgentId = agentId;
  }

  /**
   * Register a custom action handler
   */
  registerActionHandler(type: string, handler: (action: Action, payload?: any) => Promise<any>): void {
    this.actionHandlers.set(type, handler);
  }

  /**
   * Route an intent match to its action
   */
  async routeIntent(match: IntentMatch, userMessage: string): Promise<any> {
    const { intent } = match;
    const handler = this.actionHandlers.get(intent.action.type);
    
    if (!handler) {
      throw new Error(`No handler registered for action type: ${intent.action.type}`);
    }

    return handler(intent.action, {
      userMessage,
      match,
      ...intent.action.payload,
    });
  }

  /**
   * Route to default agent when no intent matches
   */
  async routeToDefaultAgent(userMessage: string, previousMessages?: AgentMessage[]): Promise<any> {
    if (!this.defaultAgentId) {
      throw new Error('No default agent configured. Set a default agent or ensure an intent matches.');
    }

    const agent = this.agentManager.getAgent(this.defaultAgentId);
    if (!agent) {
      throw new Error(`Default agent not found: ${this.defaultAgentId}`);
    }

    return agent.processMessage(userMessage, previousMessages);
  }

  /**
   * Handle agent action - route message to an agent
   */
  private async handleAgentAction(action: Action, payload: any): Promise<any> {
    const agent = this.agentManager.getAgent(action.target);
    if (!agent) {
      throw new Error(`Agent not found: ${action.target}`);
    }

    const messages: AgentMessage[] = payload.previousMessages || [];
    const response = await agent.processMessage(payload.userMessage, messages);
    
    return response;
  }

  /**
   * Handle function action - execute a custom function
   */
  private async handleFunctionAction(action: Action, payload: any): Promise<any> {
    // For function actions, we expect the function to be registered
    // This is a placeholder - users can register custom function handlers
    throw new Error(`Function action handler not implemented. Function: ${action.target}`);
  }
}


