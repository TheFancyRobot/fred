/**
 * Hook types for different pipeline stages
 */
export type HookType =
  | 'beforeMessageReceived'
  | 'afterMessageReceived'
  | 'beforeIntentDetermined'
  | 'afterIntentDetermined'
  | 'beforeAgentSelected'
  | 'afterAgentSelected'
  | 'beforeToolCalled'
  | 'afterToolCalled'
  | 'beforeResponseGenerated'
  | 'afterResponseGenerated'
  | 'beforeContextInserted'
  | 'afterContextInserted';

/**
 * Hook event data structure
 */
export interface HookEvent {
  type: HookType;
  data: any;
  conversationId?: string;
  metadata?: Record<string, any>;
}

/**
 * Hook result that can modify the pipeline
 */
export interface HookResult {
  // Context to inject into the conversation
  context?: Record<string, any>;
  // Modified data (message, intent match, agent, tool call, response, etc.)
  data?: any;
  // Whether to skip the next step
  skip?: boolean;
  // Additional metadata
  metadata?: Record<string, any>;
}

/**
 * Hook handler function
 */
export type HookHandler = (event: HookEvent) => Promise<HookResult | void> | HookResult | void;
