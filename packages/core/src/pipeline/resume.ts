/**
 * Resume contracts for PipelineService.
 *
 * These types define the API for resuming V2 pipeline execution from checkpoints.
 * Extracted from manager.ts to allow PipelineService to use them without
 * creating a circular dependency on the imperative manager.
 */

import type { PipelineResult } from './executor';

/**
 * Resume mode for pipeline continuation.
 * - 'skip': Start from the step after the checkpoint (default)
 * - 'retry': Re-execute the checkpointed step
 * - 'restart': Start from the beginning with restored context
 */
export type ResumeMode = 'skip' | 'retry' | 'restart';

/**
 * Options for resuming a pipeline.
 */
export interface ResumeOptions {
  /** Resume mode. Default: 'skip' */
  mode?: ResumeMode;

  /** Optional conversation ID for context management */
  conversationId?: string;
}

/**
 * Result of a resumed pipeline execution.
 */
export interface ResumeResult extends PipelineResult {
  /** The run ID that was resumed */
  runId: string;

  /** The step index from which execution resumed */
  resumedFromStep: number;
}
