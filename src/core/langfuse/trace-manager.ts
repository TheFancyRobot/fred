/**
 * Conversation trace manager for Langfuse
 * Uses Langfuse SDK to create traces and passes trace ID via experimental_telemetry.metadata
 * Following AI SDK documentation: https://ai-sdk.dev/providers/observability/langfuse
 */

interface ConversationTrace {
  traceId: string;
  conversationId: string;
  startTime: number;
  langfuseTrace?: any; // Langfuse trace object
}

/**
 * Manages conversation-level traces for Langfuse
 * Uses Langfuse SDK to create traces and passes trace ID to AI SDK via experimental_telemetry.metadata.langfuseTraceId
 * This follows the AI SDK documentation pattern for grouping multiple executions in one trace
 */
export class ConversationTraceManager {
  private langfuseClient: any = null;
  private initialized: boolean = false;
  public conversationTraces: Map<string, ConversationTrace> = new Map(); // Made public for debugging

  /**
   * Set the Langfuse client (must be called before using trace manager)
   * IMPORTANT: This does NOT clear existing traces - they persist across client updates
   */
  setLangfuseClient(client: any): void {
    const hadClient = !!this.langfuseClient;
    this.langfuseClient = client;
    this.initialized = !!client;
    
    if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
      if (hadClient && client) {
        console.log(`[Fred] Langfuse client updated, preserving ${this.conversationTraces.size} existing traces`);
      } else if (client) {
        console.log(`[Fred] Langfuse client set for trace manager`);
      }
    }
  }

  /**
   * Get or create a Langfuse trace for a conversation
   * Returns the trace ID to pass to AI SDK via experimental_telemetry.metadata.langfuseTraceId
   * Following AI SDK pattern: create trace ONCE before any AI SDK calls, then pass same trace ID to all calls
   * 
   * Pattern from AI SDK docs:
   * 1. Create trace: langfuse.trace({ id: parentTraceId, name: 'trace-name' })
   * 2. Pass langfuseTraceId: parentTraceId in metadata for all AI SDK calls
   * 3. Each call's functionId becomes the root span name
   */
  private getOrCreateTrace(conversationId: string, message: string): string {
    let conversationTrace = this.conversationTraces.get(conversationId);
    
    if (!conversationTrace && this.langfuseClient) {
      // Create a new Langfuse trace for this conversation
      // Following AI SDK pattern: create trace ONCE before any AI SDK calls
      // Use conversation ID as trace ID to ensure consistency across all calls
      const langfuseTrace = this.langfuseClient.trace({
        id: conversationId, // Use conversation ID as trace ID (must be consistent)
        name: conversationId, // Trace name is the conversation ID
        // Note: We set input on first message, but this is optional
        // The actual spans from AI SDK will have their own inputs/outputs
        input: message || '',
      });
      
      // Get the actual trace ID from the trace object
      // Langfuse should return the ID we provided, but we use what it gives us
      const traceId = langfuseTrace?.id || conversationId;
      
      conversationTrace = {
        traceId, // Use the actual trace ID from Langfuse
        conversationId,
        startTime: Date.now(),
        langfuseTrace,
      };
      
      this.conversationTraces.set(conversationId, conversationTrace);
      
      if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
        console.log(`[Fred] Created Langfuse trace for conversation: ${conversationId}`);
        console.log(`[Fred] Trace ID: ${traceId}`);
        console.log(`[Fred] Trace name: ${conversationId}`);
        console.log(`[Fred] This trace ID will be passed to all AI SDK calls for this conversation`);
      }
    } else if (conversationTrace) {
      // Trace already exists - reuse the same trace ID for this message
      if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
        console.log(`[Fred] Reusing existing Langfuse trace for conversation: ${conversationId}`);
        console.log(`[Fred] Trace ID: ${conversationTrace.traceId}`);
        console.log(`[Fred] This same trace ID will be passed to AI SDK call`);
      }
    } else {
      // No Langfuse client available
      if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
        console.log(`[Fred] No Langfuse client available for conversation: ${conversationId}`);
      }
    }
    
    return conversationTrace?.traceId || conversationId;
  }


  /**
   * Get the Langfuse trace ID for a conversation
   * This trace ID should be passed to AI SDK via experimental_telemetry.metadata.langfuseTraceId
   * Following AI SDK documentation: https://ai-sdk.dev/providers/observability/langfuse
   * 
   * IMPORTANT: The trace must exist BEFORE passing langfuseTraceId to AI SDK.
   * This method ensures the trace is created if it doesn't exist.
   * 
   * @param conversationId - Conversation identifier (must be consistent across all messages)
   * @param message - Current user message (for creating trace if first message)
   * @returns Langfuse trace ID to pass to AI SDK (must be consistent across all calls)
   */
  getTraceId(conversationId: string, message: string): string {
    if (!this.initialized || !this.langfuseClient) {
      if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
        console.log(`[Fred] Langfuse not initialized, returning conversationId: ${conversationId}`);
      }
      return conversationId; // Fallback to conversation ID
    }
    
    // Check if we already have a trace for this conversation
    const existingTrace = this.conversationTraces.get(conversationId);
    if (existingTrace) {
      if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
        console.log(`[Fred] Found existing trace for conversation: ${conversationId}`);
        console.log(`[Fred] Returning existing traceId: ${existingTrace.traceId}`);
        console.log(`[Fred] Total traces in map: ${this.conversationTraces.size}`);
      }
      return existingTrace.traceId;
    }
    
    // Create new trace if it doesn't exist
    const traceId = this.getOrCreateTrace(conversationId, message);
    
    if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
      console.log(`[Fred] getTraceId called for conversation: ${conversationId}`);
      console.log(`[Fred] Created/retrieved traceId: ${traceId}`);
      console.log(`[Fred] Total traces in map: ${this.conversationTraces.size}`);
    }
    
    return traceId;
  }
  
  /**
   * Run code with conversation trace context
   * This is a no-op wrapper - the actual trace grouping is done via langfuseTraceId in metadata
   * @param conversationId - Conversation identifier
   * @param message - Current user message
   * @param messageCount - Number of messages in conversation so far
   * @param fn - Function to run
   */
  async withConversationTrace<T>(
    conversationId: string,
    message: string,
    messageCount: number,
    fn: () => Promise<T>
  ): Promise<T> {
    // Ensure trace exists (creates it if first message)
    if (this.initialized && this.langfuseClient) {
      this.getOrCreateTrace(conversationId, message);
    }
    
    // Just execute the function - trace grouping is handled via langfuseTraceId in metadata
    return fn();
  }

  /**
   * End a conversation trace (called when conversation is cleared)
   * @param conversationId - Conversation identifier
   */
  endConversationTrace(conversationId: string): void {
    const conversationTrace = this.conversationTraces.get(conversationId);
    if (!conversationTrace) {
      return;
    }

    // Update trace with end time if we have the Langfuse trace object
    if (conversationTrace.langfuseTrace) {
      const duration = Date.now() - conversationTrace.startTime;
      conversationTrace.langfuseTrace.update({
        // Trace is automatically finalized when all spans are complete
      });
    }

    // Remove from map
    this.conversationTraces.delete(conversationId);

    if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
      console.log(`[Fred] Ended conversation trace for: ${conversationId}`);
    }
  }

  /**
   * Run an async generator with conversation trace context
   * This is a no-op wrapper - the actual trace grouping is done via langfuseTraceId in metadata
   * @param conversationId - Conversation identifier
   * @param message - Current user message
   * @param messageCount - Number of messages in conversation so far
   * @param generatorFn - Function that returns an async generator
   */
  async *withConversationTraceGenerator<T>(
    conversationId: string,
    message: string,
    messageCount: number,
    generatorFn: () => AsyncGenerator<T>
  ): AsyncGenerator<T> {
    // Ensure trace exists (creates it if first message)
    if (this.initialized && this.langfuseClient) {
      this.getOrCreateTrace(conversationId, message);
    }
    
    // Just yield from the generator - trace grouping is handled via langfuseTraceId in metadata
    yield* generatorFn();
  }
}

// Singleton instance - persists across module reloads
let traceManager: ConversationTraceManager | null = null;

/**
 * Get the global conversation trace manager instance
 * This is a singleton that persists traces across Fred reloads
 */
export function getConversationTraceManager(): ConversationTraceManager {
  if (!traceManager) {
    traceManager = new ConversationTraceManager();
    if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
      console.log(`[Fred] Created new ConversationTraceManager singleton instance`);
    }
  } else if (typeof process !== 'undefined' && process.env.DEBUG_LANGFUSE) {
    console.log(`[Fred] Reusing existing ConversationTraceManager singleton (${traceManager.conversationTraces.size} traces stored)`);
  }
  return traceManager;
}
