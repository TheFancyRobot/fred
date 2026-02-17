/**
 * JSON Channel Contract Utility
 *
 * Centralized output contract for `fred run` command.
 * Ensures strict JSON-only output when --json mode is active:
 * - Exactly one JSON document emitted per execution (success or error)
 * - No plain-text stderr leakage in JSON mode
 * - Startup warnings folded into meta.warnings
 * - Downstream stderr captured under meta.stderr
 * - Dedicated exit code for channel-contract violations
 */

import type { RunCommandIO } from '../commands/run.js';

/**
 * Dedicated exit code for channel-contract violations.
 *
 * Returned when the JSON channel contract cannot be upheld
 * (e.g., output was already emitted and a second emission is attempted,
 * or an unexpected internal failure prevents structured output).
 *
 * Distinct from:
 * - 0: success
 * - 1: runtime/application error
 * - 2: validation/usage error
 */
export const RUN_JSON_CHANNEL_VIOLATION_EXIT_CODE = 78;

/**
 * Structured success payload for JSON mode.
 */
export interface RunJsonSuccessPayload {
  ok: true;
  agent: string;
  content: string;
  toolCalls: Array<{ toolId: string; args: Record<string, unknown>; result?: unknown }>;
  meta?: {
    warnings?: string[];
    stderr?: string[];
    verbose?: Record<string, unknown>;
  };
}

/**
 * Structured error payload for JSON mode.
 */
export interface RunJsonErrorPayload {
  ok: false;
  error: string;
  exitCode?: number;
  meta?: {
    warnings?: string[];
    stderr?: string[];
    details?: unknown;
  };
}

export type RunJsonPayload = RunJsonSuccessPayload | RunJsonErrorPayload;

/**
 * JSON Channel — accumulates warnings and stderr lines,
 * then emits exactly one JSON document via stdout.
 *
 * In text mode, delegates directly to the underlying IO
 * with no structural constraints.
 */
export class RunJsonChannel {
  private readonly io: RunCommandIO;
  private readonly jsonMode: boolean;
  private readonly warnings: string[] = [];
  private readonly stderrLines: string[] = [];
  private emitted = false;

  constructor(io: RunCommandIO, jsonMode: boolean) {
    this.io = io;
    this.jsonMode = jsonMode;
  }

  /**
   * Record a startup or non-fatal warning.
   *
   * - JSON mode: accumulated into meta.warnings (emitted with final payload)
   * - Text mode: written to stderr immediately
   */
  warn(message: string): void {
    if (this.jsonMode) {
      this.warnings.push(message);
    } else {
      this.io.stderr(message);
    }
  }

  /**
   * Record a stderr diagnostic line (e.g., verbose tool-call output).
   *
   * - JSON mode: accumulated into meta.stderr or meta.verbose
   * - Text mode: written to stderr immediately
   */
  diagnostic(message: string): void {
    if (this.jsonMode) {
      this.stderrLines.push(message);
    } else {
      this.io.stderr(message);
    }
  }

  /**
   * Emit a structured success result.
   *
   * - JSON mode: writes one JSON document to stdout; returns 0
   * - Text mode: writes plain content to stdout; returns 0
   */
  emitSuccess(payload: {
    agent: string;
    content: string;
    toolCalls?: Array<{ toolId: string; args: Record<string, unknown>; result?: unknown }>;
    verbose?: Record<string, unknown>;
  }): number {
    if (this.jsonMode) {
      return this.emitJson({
        ok: true as const,
        agent: payload.agent,
        content: payload.content,
        toolCalls: payload.toolCalls ?? [],
        meta: this.buildMeta(payload.verbose),
      });
    }

    this.io.stdout(payload.content);
    return 0;
  }

  /**
   * Emit a structured error result.
   *
   * - JSON mode: writes one JSON error document to stdout; returns exitCode
   * - Text mode: writes plain error to stderr; returns exitCode
   */
  emitError(message: string, exitCode: number = 1, details?: unknown): number {
    if (this.jsonMode) {
      return this.emitJson({
        ok: false as const,
        error: message,
        exitCode,
        meta: this.buildMeta(undefined, details),
      });
    }

    this.io.stderr(`Error: ${message}`);
    return exitCode;
  }

  /**
   * Internal: emit exactly one JSON document to stdout.
   *
   * If a document has already been emitted (contract violation),
   * returns the violation exit code without emitting again.
   */
  private emitJson(payload: RunJsonPayload): number {
    if (this.emitted) {
      // Contract violation: attempted to emit a second JSON document.
      // Do not emit anything further — the first document is the authoritative one.
      return RUN_JSON_CHANNEL_VIOLATION_EXIT_CODE;
    }

    this.emitted = true;
    this.io.stdout(JSON.stringify(payload, null, 2));

    if ('exitCode' in payload && payload.exitCode !== undefined) {
      return payload.exitCode;
    }
    return payload.ok ? 0 : 1;
  }

  /**
   * Build the meta object from accumulated warnings, stderr, and optional extras.
   * Returns undefined if there's nothing to include (keeps payloads lean).
   */
  private buildMeta(
    verbose?: Record<string, unknown>,
    details?: unknown,
  ): { warnings?: string[]; stderr?: string[]; verbose?: Record<string, unknown>; details?: unknown } | undefined {
    const hasWarnings = this.warnings.length > 0;
    const hasStderr = this.stderrLines.length > 0;
    const hasVerbose = verbose !== undefined;
    const hasDetails = details !== undefined;

    if (!hasWarnings && !hasStderr && !hasVerbose && !hasDetails) {
      return undefined;
    }

    return {
      ...(hasWarnings ? { warnings: [...this.warnings] } : {}),
      ...(hasStderr ? { stderr: [...this.stderrLines] } : {}),
      ...(hasVerbose ? { verbose } : {}),
      ...(hasDetails ? { details } : {}),
    };
  }
}
