type ProgressSink = {
  start: (event: {
    toolCallId: string;
    toolName: string;
    input?: Record<string, unknown>;
    startedAt?: number;
    kind?: 'tool' | 'task';
    depth?: number;
  }) => void;
  complete: (event: {
    toolCallId: string;
    toolName: string;
    output?: unknown;
    completedAt?: number;
    durationMs?: number;
  }) => void;
  fail: (event: {
    toolCallId: string;
    toolName: string;
    error: { message: string };
    completedAt?: number;
    durationMs?: number;
  }) => void;
};

function getSink(): ProgressSink | undefined {
  const globalWithSink = globalThis as typeof globalThis & {
    __FRED_TUI_TOOL_PROGRESS__?: ProgressSink;
  };
  return globalWithSink.__FRED_TUI_TOOL_PROGRESS__;
}

export function emitTuiProgressStart(event: {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  depth?: number;
  kind?: 'tool' | 'task';
}): void {
  getSink()?.start({
    ...event,
    kind: event.kind ?? 'task',
    startedAt: Date.now(),
  });
}

export function emitTuiProgressComplete(event: {
  toolCallId: string;
  toolName: string;
  output?: unknown;
}): void {
  getSink()?.complete({
    ...event,
    completedAt: Date.now(),
  });
}

export function emitTuiProgressError(event: {
  toolCallId: string;
  toolName: string;
  error: { message: string };
}): void {
  getSink()?.fail({
    ...event,
    completedAt: Date.now(),
  });
}

export function emitTuiTaskStart(event: {
  toolCallId: string;
  toolName: string;
  input?: Record<string, unknown>;
  depth?: number;
}): void {
  emitTuiProgressStart({
    ...event,
    kind: 'task',
  });
}

export function emitTuiTaskComplete(event: {
  toolCallId: string;
  toolName: string;
  output?: unknown;
}): void {
  emitTuiProgressComplete(event);
}

export function emitTuiTaskError(event: {
  toolCallId: string;
  toolName: string;
  error: { message: string };
}): void {
  emitTuiProgressError(event);
}
