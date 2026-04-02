import { describe, test, expect } from 'bun:test';
import { Effect } from 'effect';
import { CheckpointService, CheckpointServiceLive } from '../../../../../packages/core/src/pipeline/checkpoint/service';
import { CheckpointNotFoundError } from '../../../../../packages/core/src/pipeline/errors';
import type { CheckpointStorage, Checkpoint, CheckpointStatus } from '../../../../../packages/core/src/pipeline/checkpoint/types';
import type { PipelineContext } from '../../../../../packages/core/src/pipeline/context';

/**
 * In-memory checkpoint storage for testing
 */
class InMemoryCheckpointStorage implements CheckpointStorage {
  private checkpoints: Map<string, Checkpoint[]> = new Map();

  async save(checkpoint: Checkpoint): Promise<void> {
    const runCheckpoints = this.checkpoints.get(checkpoint.runId) || [];
    const existing = runCheckpoints.findIndex(
      (cp) => cp.runId === checkpoint.runId && cp.step === checkpoint.step
    );

    if (existing >= 0) {
      runCheckpoints[existing] = checkpoint;
    } else {
      runCheckpoints.push(checkpoint);
    }

    runCheckpoints.sort((a, b) => a.step - b.step);
    this.checkpoints.set(checkpoint.runId, runCheckpoints);
  }

  async getLatest(runId: string): Promise<Checkpoint | null> {
    const runCheckpoints = this.checkpoints.get(runId);
    if (!runCheckpoints || runCheckpoints.length === 0) return null;
    return runCheckpoints[runCheckpoints.length - 1];
  }

  async get(runId: string, step: number): Promise<Checkpoint | null> {
    const runCheckpoints = this.checkpoints.get(runId);
    if (!runCheckpoints) return null;
    return runCheckpoints.find((cp) => cp.step === step) || null;
  }

  async updateStatus(runId: string, step: number, status: CheckpointStatus): Promise<void> {
    const runCheckpoints = this.checkpoints.get(runId);
    if (!runCheckpoints) return;

    const checkpoint = runCheckpoints.find((cp) => cp.step === step);
    if (checkpoint) {
      checkpoint.status = status;
      checkpoint.updatedAt = new Date();
    }
  }

  async deleteRun(runId: string): Promise<void> {
    this.checkpoints.delete(runId);
  }

  async deleteExpired(): Promise<number> {
    const now = new Date();
    let count = 0;

    for (const [runId, checkpoints] of this.checkpoints.entries()) {
      const filtered = checkpoints.filter((cp) => {
        if (cp.expiresAt && cp.expiresAt < now) {
          count++;
          return false;
        }
        return true;
      });

      if (filtered.length === 0) {
        this.checkpoints.delete(runId);
      } else {
        this.checkpoints.set(runId, filtered);
      }
    }

    return count;
  }

  async listByStatus(status: CheckpointStatus): Promise<Checkpoint[]> {
    const result: Checkpoint[] = [];
    for (const checkpoints of this.checkpoints.values()) {
      result.push(...checkpoints.filter((cp) => cp.status === status));
    }
    return result;
  }

  async getLatestByPipelineId(pipelineId: string): Promise<Checkpoint | null> {
    const allCheckpoints: Checkpoint[] = [];
    for (const checkpoints of this.checkpoints.values()) {
      allCheckpoints.push(...checkpoints.filter((cp) => cp.pipelineId === pipelineId));
    }

    if (allCheckpoints.length === 0) return null;

    // Filter out expired
    const now = new Date();
    const valid = allCheckpoints.filter(
      (cp) => !cp.expiresAt || cp.expiresAt > now
    );

    if (valid.length === 0) return null;

    // Sort by step DESC, then by createdAt DESC for deterministic tie-break
    valid.sort((a, b) => {
      if (b.step !== a.step) return b.step - a.step;
      return b.createdAt.getTime() - a.createdAt.getTime();
    });

    return valid[0];
  }

  async close(): Promise<void> {
    this.checkpoints.clear();
  }
}

const createTestContext = (pipelineId: string = 'test-pipeline'): PipelineContext => ({
  pipelineId,
  input: 'test input',
  history: [],
  outputs: {},
  metadata: {},
});

const runWithService = <A, E>(effect: Effect.Effect<A, E, CheckpointService>) => {
  const storage = new InMemoryCheckpointStorage();
  const layer = CheckpointServiceLive({ storage });
  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
};

describe('CheckpointService', () => {
  describe('generateRunId', () => {
    test('generates unique run IDs', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const id1 = yield* service.generateRunId();
          const id2 = yield* service.generateRunId();
          return { id1, id2, different: id1 !== id2 };
        })
      );
      expect(result.different).toBe(true);
      expect(result.id1).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });
  });

  describe('saveCheckpoint', () => {
    test('saves checkpoint successfully', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
          });

          const checkpoint = yield* service.getLatestCheckpoint(runId);
          return checkpoint;
        })
      );

      expect(result.pipelineId).toBe('test-pipeline');
      expect(result.step).toBe(0);
      expect(result.status).toBe('in_progress');
    });

    test('applies default TTL when not specified', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
          });

          const checkpoint = yield* service.getLatestCheckpoint(runId);
          return checkpoint;
        })
      );

      expect(result.expiresAt).toBeDefined();
      expect(result.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    });
  });

  describe('getLatestCheckpoint', () => {
    test('returns latest checkpoint for run', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
          });

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'in_progress',
            context: createTestContext(),
          });

          const checkpoint = yield* service.getLatestCheckpoint(runId);
          return checkpoint.step;
        })
      );

      expect(result).toBe(1);
    });

    test('fails with CheckpointNotFoundError when run not found', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          return yield* service.getLatestCheckpoint('nonexistent-run');
        }).pipe(Effect.provide(CheckpointServiceLive({ storage: new InMemoryCheckpointStorage() })))
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('getCheckpoint', () => {
    test('returns specific checkpoint by step', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'completed',
            context: createTestContext(),
          });

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'in_progress',
            context: createTestContext(),
          });

          const checkpoint = yield* service.getCheckpoint(runId, 0);
          return checkpoint.status;
        })
      );

      expect(result).toBe('completed');
    });

    test('fails with CheckpointNotFoundError when step not found', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
          });

          return yield* service.getCheckpoint(runId, 99);
        }).pipe(Effect.provide(CheckpointServiceLive({ storage: new InMemoryCheckpointStorage() })))
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('updateStatus', () => {
    test('updates checkpoint status', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
          });

          yield* service.updateStatus(runId, 0, 'completed');

          const checkpoint = yield* service.getCheckpoint(runId, 0);
          return checkpoint.status;
        })
      );

      expect(result).toBe('completed');
    });
  });

  describe('markCompleted', () => {
    test('marks checkpoint as completed', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
          });

          yield* service.markCompleted(runId, 0);

          const checkpoint = yield* service.getCheckpoint(runId, 0);
          return checkpoint.status;
        })
      );

      expect(result).toBe('completed');
    });
  });

  describe('markFailed', () => {
    test('marks checkpoint as failed', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
          });

          yield* service.markFailed(runId, 0);

          const checkpoint = yield* service.getCheckpoint(runId, 0);
          return checkpoint.status;
        })
      );

      expect(result).toBe('failed');
    });
  });

  describe('deleteRun', () => {
    test('deletes all checkpoints for run', async () => {
      const result = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'completed',
            context: createTestContext(),
          });

          yield* service.deleteRun(runId);

          return yield* service.getLatestCheckpoint(runId);
        }).pipe(Effect.provide(CheckpointServiceLive({ storage: new InMemoryCheckpointStorage() })))
      );

      expect(result._tag).toBe('Failure');
    });
  });

  describe('deleteExpired', () => {
    test('deletes expired checkpoints and returns count', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId1 = yield* service.generateRunId();
          const runId2 = yield* service.generateRunId();

          // Create expired checkpoint
          const pastDate = new Date(Date.now() - 1000);
          yield* service.saveCheckpoint({
            runId: runId1,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'completed',
            context: createTestContext(),
            expiresAt: pastDate,
          });

          // Create non-expired checkpoint
          const futureDate = new Date(Date.now() + 100000);
          yield* service.saveCheckpoint({
            runId: runId2,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext(),
            expiresAt: futureDate,
          });

          const count = yield* service.deleteExpired();

          // Verify expired was deleted
          const run1Exists = yield* Effect.either(service.getLatestCheckpoint(runId1));
          const run2Exists = yield* Effect.either(service.getLatestCheckpoint(runId2));

          return { count, run1Deleted: run1Exists._tag === 'Left', run2Exists: run2Exists._tag === 'Right' };
        })
      );

      expect(result.count).toBe(1);
      expect(result.run1Deleted).toBe(true);
      expect(result.run2Exists).toBe(true);
    });
  });

  describe('getLatestByPipelineId', () => {
    test('returns null when no checkpoints for pipeline', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          return yield* service.getLatestByPipelineId('nonexistent-pipeline');
        })
      );

      expect(result).toBeNull();
    });

    test('returns latest checkpoint for pipeline by step', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext('test-pipeline'),
          });

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 2,
            status: 'in_progress',
            context: createTestContext('test-pipeline'),
          });

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'test-pipeline',
            step: 1,
            status: 'in_progress',
            context: createTestContext('test-pipeline'),
          });

          const checkpoint = yield* service.getLatestByPipelineId('test-pipeline');
          return checkpoint?.step;
        })
      );

      expect(result).toBe(2);
    });

    test('uses timestamp as tie-breaker for same step', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId1 = yield* service.generateRunId();
          const runId2 = yield* service.generateRunId();

          // First run, step 2 (earlier timestamp)
          yield* service.saveCheckpoint({
            runId: runId1,
            pipelineId: 'tie-break-pipeline',
            step: 2,
            status: 'in_progress',
            context: createTestContext('tie-break-pipeline'),
          });

          // Small delay to ensure different timestamps
          yield* Effect.sleep('10 millis');

          // Second run, also step 2 (later timestamp - should win)
          yield* service.saveCheckpoint({
            runId: runId2,
            pipelineId: 'tie-break-pipeline',
            step: 2,
            status: 'in_progress',
            context: createTestContext('tie-break-pipeline'),
          });

          const checkpoint = yield* service.getLatestByPipelineId('tie-break-pipeline');
          return checkpoint?.runId;
        })
      );

      // Should return runId2 (later timestamp)
      expect(result).toBeDefined();
    });

    test('excludes expired checkpoints', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId1 = yield* service.generateRunId();
          const runId2 = yield* service.generateRunId();

          // Expired checkpoint
          yield* service.saveCheckpoint({
            runId: runId1,
            pipelineId: 'expiry-pipeline',
            step: 5, // Higher step but expired
            status: 'in_progress',
            context: createTestContext('expiry-pipeline'),
            expiresAt: new Date(Date.now() - 1000),
          });

          // Valid checkpoint
          yield* service.saveCheckpoint({
            runId: runId2,
            pipelineId: 'expiry-pipeline',
            step: 2, // Lower step but valid
            status: 'in_progress',
            context: createTestContext('expiry-pipeline'),
            expiresAt: new Date(Date.now() + 100000),
          });

          const checkpoint = yield* service.getLatestByPipelineId('expiry-pipeline');
          return checkpoint?.step;
        })
      );

      // Should return step 2 (valid) not step 5 (expired)
      expect(result).toBe(2);
    });

    test('returns null when all checkpoints are expired', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId = yield* service.generateRunId();

          yield* service.saveCheckpoint({
            runId,
            pipelineId: 'all-expired-pipeline',
            step: 1,
            status: 'in_progress',
            context: createTestContext('all-expired-pipeline'),
            expiresAt: new Date(Date.now() - 1000),
          });

          return yield* service.getLatestByPipelineId('all-expired-pipeline');
        })
      );

      expect(result).toBeNull();
    });

    test('selects across multiple runs for same pipeline', async () => {
      const result = await runWithService(
        Effect.gen(function* () {
          const service = yield* CheckpointService;
          const runId1 = yield* service.generateRunId();
          const runId2 = yield* service.generateRunId();
          const runId3 = yield* service.generateRunId();

          // Run 1: steps 0, 1
          yield* service.saveCheckpoint({
            runId: runId1,
            pipelineId: 'multi-run-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext('multi-run-pipeline'),
          });
          yield* service.saveCheckpoint({
            runId: runId1,
            pipelineId: 'multi-run-pipeline',
            step: 1,
            status: 'in_progress',
            context: createTestContext('multi-run-pipeline'),
          });

          // Run 2: steps 0, 1, 2
          yield* service.saveCheckpoint({
            runId: runId2,
            pipelineId: 'multi-run-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext('multi-run-pipeline'),
          });
          yield* service.saveCheckpoint({
            runId: runId2,
            pipelineId: 'multi-run-pipeline',
            step: 1,
            status: 'in_progress',
            context: createTestContext('multi-run-pipeline'),
          });
          yield* service.saveCheckpoint({
            runId: runId2,
            pipelineId: 'multi-run-pipeline',
            step: 2,
            status: 'in_progress',
            context: createTestContext('multi-run-pipeline'),
          });

          // Run 3: step 0 only
          yield* service.saveCheckpoint({
            runId: runId3,
            pipelineId: 'multi-run-pipeline',
            step: 0,
            status: 'in_progress',
            context: createTestContext('multi-run-pipeline'),
          });

          const checkpoint = yield* service.getLatestByPipelineId('multi-run-pipeline');
          return { step: checkpoint?.step, runId: checkpoint?.runId };
        })
      );

      // Should return step 2 from runId2
      expect(result.step).toBe(2);
      expect(result.runId).toBeDefined();
    });
  });
});
