/**
 * Workflow context for tracking active workflow and thread state.
 * Each workflow switch generates a fresh thread ID to prevent context carryover.
 */
export class WorkflowContext {
  private currentWorkflow: string;
  private threadId: string;

  constructor(initialWorkflow: string) {
    this.currentWorkflow = initialWorkflow;
    this.threadId = this.generateThreadId();
  }

  switchWorkflow(name: string): void {
    this.currentWorkflow = name;
    this.threadId = this.generateThreadId();
  }

  getCurrentWorkflow(): string {
    return this.currentWorkflow;
  }

  getThreadId(): string {
    return this.threadId;
  }

  private generateThreadId(): string {
    return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}
