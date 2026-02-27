/**
 * Core tracing types and interfaces
 */

/** Span status codes */
export enum SpanStatus {
  OK = 'ok',
  ERROR = 'error',
  UNSET = 'unset',
}

/** Span kind */
export enum SpanKind {
  INTERNAL = 'internal',
  SERVER = 'server',
  CLIENT = 'client',
  PRODUCER = 'producer',
  CONSUMER = 'consumer',
}

/** Span attributes (key-value pairs) */
export type SpanAttributes = Record<string, string | number | boolean | string[] | number[] | boolean[]>;

/** Span event */
export interface SpanEvent {
  name: string;
  time: number;
  attributes?: SpanAttributes;
}

/** Span options for creating a new span */
export interface SpanOptions {
  kind?: SpanKind;
  attributes?: SpanAttributes;
  startTime?: number;
}

/** Span context for propagation */
export interface SpanContext {
  spanId: string;
  traceId: string;
  isRemote?: boolean;
}

/** Core tracer interface — lightweight abstraction without hard OpenTelemetry dependency */
export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span;
  getActiveSpan(): Span | undefined;
  setActiveSpan(span: Span | undefined): void;
  getTraceId(): string | undefined;
}

/** Span interface representing a single operation */
export interface Span {
  readonly name: string;
  readonly context: SpanContext;
  setAttribute(key: string, value: string | number | boolean | string[] | number[] | boolean[]): void;
  setAttributes(attributes: Record<string, string | number | boolean | string[] | number[] | boolean[]>): void;
  addEvent(name: string, attributes?: Record<string, string | number | boolean | string[] | number[] | boolean[]>): void;
  recordException(error: Error, attributes?: Record<string, string | number | boolean | string[] | number[] | boolean[]>): void;
  setStatus(status: 'ok' | 'error' | 'unset', message?: string): void;
  updateName(name: string): void;
  end(endTime?: number): void;
  isEnded(): boolean;
  getStartTime(): number;
  getEndTime(): number | undefined;
  getDuration(): number | undefined;
}
