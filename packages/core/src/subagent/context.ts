import { AsyncLocalStorage } from 'node:async_hooks';

export interface ActiveSubagentHandle {
  readonly id: string;
  readonly cancel: () => Promise<void>;
}

export interface SubagentExecutionContext {
  readonly deadlineAt: number;
  readonly startedAt: number;
  readonly timeoutMs: number;
  readonly reserveTimeoutMs: number;
  readonly registerActiveSubagent: (handle: ActiveSubagentHandle) => () => void;
  readonly cancelActiveSubagents: () => Promise<void>;
  readonly getRemainingTimeMs: (now?: number) => number;
}

const subagentExecutionBridge = new AsyncLocalStorage<SubagentExecutionContext | undefined>();

export function createSubagentExecutionContext(options: {
  readonly timeoutMs: number;
  readonly reserveTimeoutMs: number;
}): SubagentExecutionContext {
  const startedAt = Date.now();
  const deadlineAt = startedAt + options.timeoutMs;
  const active = new Map<string, ActiveSubagentHandle>();

  return {
    deadlineAt,
    startedAt,
    timeoutMs: options.timeoutMs,
    reserveTimeoutMs: options.reserveTimeoutMs,
    registerActiveSubagent: (handle) => {
      active.set(handle.id, handle);
      return () => {
        active.delete(handle.id);
      };
    },
    cancelActiveSubagents: async () => {
      const snapshot = Array.from(active.values());
      await Promise.allSettled(snapshot.map((handle) => handle.cancel()));
    },
    getRemainingTimeMs: (now = Date.now()) => Math.max(0, deadlineAt - now),
  };
}

export function withSubagentExecutionContext<A>(
  context: SubagentExecutionContext,
  fn: () => Promise<A>,
): Promise<A> {
  return subagentExecutionBridge.run(context, fn);
}

export function getCurrentSubagentExecutionContext(): SubagentExecutionContext | undefined {
  return subagentExecutionBridge.getStore();
}
