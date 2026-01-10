import { Span } from './tracer';

/**
 * Span context propagation using async-local storage
 * This allows spans to be accessed across async boundaries
 */
class SpanContextStore {
  private store: Map<number, Span | undefined> = new Map();

  /**
   * Get the current async context ID
   * In Bun/Node.js, we use a simple counter-based approach
   * For production, consider using AsyncLocalStorage
   */
  private getContextId(): number {
    // Use a simple approach: store by async context
    // In a real implementation, you'd use AsyncLocalStorage
    return 0; // Single context for now
  }

  /**
   * Get the active span for the current context
   */
  getActiveSpan(): Span | undefined {
    const contextId = this.getContextId();
    return this.store.get(contextId);
  }

  /**
   * Set the active span for the current context
   */
  setActiveSpan(span: Span | undefined): void {
    const contextId = this.getContextId();
    if (span) {
      this.store.set(contextId, span);
    } else {
      this.store.delete(contextId);
    }
  }

  /**
   * Clear all contexts (useful for testing)
   */
  clear(): void {
    this.store.clear();
  }
}

// Global context store instance
const contextStore = new SpanContextStore();

/**
 * Get the active span from context
 */
export function getActiveSpan(): Span | undefined {
  return contextStore.getActiveSpan();
}

/**
 * Set the active span in context
 */
export function setActiveSpan(span: Span | undefined): void {
  contextStore.setActiveSpan(span);
}

/**
 * Clear all span contexts (for testing)
 */
export function clearSpanContext(): void {
  contextStore.clear();
}
