import type { HookHandler } from '../hooks/types';
import type { PipelineStep } from './steps';

/**
 * Checkpoint configuration for pipeline execution.
 */
export interface CheckpointConfig {
  /** Enable/disable checkpointing. Default: true when storage configured */
  enabled?: boolean;

  /** TTL in milliseconds for checkpoints. Default: 7 days */
  ttlMs?: number;
}

/**
 * Per-pipeline hook configuration
 * Hooks fire at deterministic points during pipeline execution
 */
export interface PipelineHooks {
  /** Hooks executed before pipeline starts */
  beforePipeline?: HookHandler[];
  /** Hooks executed after pipeline completes */
  afterPipeline?: HookHandler[];
  /** Hooks executed before each step */
  beforeStep?: HookHandler[];
  /** Hooks executed after each step completes */
  afterStep?: HookHandler[];
  /** Hooks executed when a step errors (after all retries fail) */
  onStepError?: HookHandler[];
}

/**
 * Extended pipeline configuration (Phase 5+)
 * Supports all step types with per-step configuration
 */
export interface PipelineConfigV2 {
  /** Unique pipeline identifier */
  id: string;
  /** Ordered array of pipeline steps */
  steps: PipelineStep[];
  /** Optional description of the pipeline */
  description?: string;
  /** Phrases that trigger this pipeline (for utterance matching) */
  utterances?: string[];
  /** Per-pipeline hook configuration */
  hooks?: PipelineHooks;
  /** Stop on first error (default: true) */
  failFast?: boolean;
  /** Checkpoint configuration for resume support */
  checkpoint?: CheckpointConfig;
}
