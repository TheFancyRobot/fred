import { Tracer, Span } from './tracer';
import { SpanOptions, SpanContext, SpanStatus } from './types';
import { setActiveSpan, getActiveSpan } from './context';

/**
 * No-op span implementation
 * Provides zero overhead when tracing is disabled
 */
class NoOpSpan implements Span {
  readonly name: string;
  readonly context: SpanContext;
  private _startTime: number;
  private _endTime?: number;
  private _attributes: Record<string, any> = {};
  private _events: Array<{ name: string; time: number; attributes?: Record<string, any> }> = [];
  private _status: { code: SpanStatus; message?: string } = { code: SpanStatus.UNSET };

  constructor(name: string, context: SpanContext, startTime?: number) {
    this.name = name;
    this.context = context;
    this._startTime = startTime ?? Date.now();
  }

  setAttribute(key: string, value: any): void {
    this._attributes[key] = value;
  }

  setAttributes(attributes: Record<string, any>): void {
    Object.assign(this._attributes, attributes);
  }

  addEvent(name: string, attributes?: Record<string, any>): void {
    this._events.push({
      name,
      time: Date.now(),
      attributes,
    });
  }

  recordException(error: Error, attributes?: Record<string, any>): void {
    this.addEvent('exception', {
      ...attributes,
      'exception.type': error.name,
      'exception.message': error.message,
      'exception.stack': error.stack,
    });
    this.setStatus('error', error.message);
  }

  setStatus(status: 'ok' | 'error' | 'unset', message?: string): void {
    this._status = {
      code: status as SpanStatus,
      message,
    };
  }

  updateName(name: string): void {
    // No-op - name is readonly in interface but we can track it
    (this as any).name = name;
  }

  end(endTime?: number): void {
    if (this._endTime === undefined) {
      this._endTime = endTime ?? Date.now();
    }
  }

  isEnded(): boolean {
    return this._endTime !== undefined;
  }

  getStartTime(): number {
    return this._startTime;
  }

  getEndTime(): number | undefined {
    return this._endTime;
  }

  getDuration(): number | undefined {
    if (this._endTime === undefined) {
      return undefined;
    }
    return this._endTime - this._startTime;
  }

  /**
   * Get all attributes (for testing/debugging)
   */
  getAttributes(): Record<string, any> {
    return { ...this._attributes };
  }

  /**
   * Get all events (for testing/debugging)
   */
  getEvents(): Array<{ name: string; time: number; attributes?: Record<string, any> }> {
    return [...this._events];
  }
}

/**
 * No-op tracer implementation
 * Provides zero overhead when tracing is disabled (default)
 */
export class NoOpTracer implements Tracer {
  private traceId: string;
  private spanCounter: number = 0;

  constructor() {
    this.traceId = this.generateTraceId();
  }

  private generateTraceId(): string {
    // Generate a simple trace ID (16 hex characters)
    return Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  private generateSpanId(): string {
    // Generate a simple span ID (8 hex characters)
    this.spanCounter++;
    return Array.from({ length: 8 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  }

  startSpan(name: string, options?: SpanOptions): Span {
    const spanId = this.generateSpanId();
    const context: SpanContext = {
      spanId,
      traceId: this.traceId,
      isRemote: false,
    };

    const span = new NoOpSpan(name, context, options?.startTime);
    
    // Set attributes if provided
    if (options?.attributes) {
      span.setAttributes(options.attributes);
    }

    return span;
  }

  getActiveSpan(): Span | undefined {
    return getActiveSpan();
  }

  setActiveSpan(span: Span | undefined): void {
    setActiveSpan(span);
  }

  getTraceId(): string | undefined {
    return this.traceId;
  }

  /**
   * Reset the trace ID (useful for testing)
   */
  resetTraceId(): void {
    this.traceId = this.generateTraceId();
    this.spanCounter = 0;
  }
}
