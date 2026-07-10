/**
 * Phase 63 / STEP-63-01: differential safety net (golden side).
 *
 * Locks the exact observable behavior of the three legacy executors (V1
 * agent-list, V2 typed steps, graph DAG) as golden snapshots. Later steps in the
 * phase flip execution to the compiled-`WorkflowIR` path one architecture at a
 * time; the parity test re-runs this same corpus through the unified executor
 * and asserts identical snapshots. Any drift here — before or after the flip —
 * is a behavior change that must be justified, not silently absorbed.
 *
 * The golden values below were captured from the current executors, not authored
 * by hand, so they characterize real behavior including the non-obvious bits:
 *   - V2 conditional steps emit a rich {conditionResult, result, branchInfo};
 *   - a V2 agent step's finalOutput is the whole AgentResponse, not its content;
 *   - graph conditional routing skips the untaken branch entirely.
 */
import { describe, expect, it } from 'bun:test';
import {
  WORKFLOW_FIXTURES,
  runFixtureLegacy,
  type WorkflowFixture,
} from '../../helpers/workflow-fixtures';

/** Golden snapshots, keyed by fixture name. Captured from the legacy executors. */
const GOLDEN: Record<string, Record<string, unknown>> = {
  'v1-single-agent': {
    content: 'a<-hi',
    toolCalls: [],
  },
  'v1-agent-chain': {
    content: 'b<-a<-hi',
    toolCalls: [],
  },
  'v2-function-single': {
    success: true,
    status: 'completed',
    finalOutput: 'T:hi',
    outputs: { transform: 'T:hi' },
    pipelineId: 'v2-fn',
    error: undefined,
    abortedBy: undefined,
  },
  'v2-function-accumulate': {
    success: true,
    status: 'completed',
    finalOutput: 'second:first:hi',
    outputs: { first: 'first:hi', second: 'second:first:hi' },
    pipelineId: 'v2-acc',
    error: undefined,
    abortedBy: undefined,
  },
  'v2-agent-step': {
    success: true,
    status: 'completed',
    finalOutput: { content: 'a<-hi', toolCalls: [] },
    outputs: { call: { content: 'a<-hi', toolCalls: [] } },
    pipelineId: 'v2-agent',
    error: undefined,
    abortedBy: undefined,
  },
  'v2-conditional-true': {
    success: true,
    status: 'completed',
    finalOutput: {
      conditionResult: true,
      result: 'took-true',
      branchInfo: { conditionResult: true, takenPath: 'whenTrue', notTakenPath: 'whenFalse' },
    },
    outputs: {
      branch: {
        conditionResult: true,
        result: 'took-true',
        branchInfo: { conditionResult: true, takenPath: 'whenTrue', notTakenPath: 'whenFalse' },
      },
    },
    pipelineId: 'v2-cond',
    error: undefined,
    abortedBy: undefined,
  },
  'graph-single-node': {
    success: true,
    outputs: { only: 'only:hi' },
    executedNodes: ['only'],
    error: undefined,
    abortedBy: undefined,
  },
  'graph-linear': {
    success: true,
    outputs: { n1: 'n1:hi', n2: 'n2:n1:hi' },
    executedNodes: ['n1', 'n2'],
    error: undefined,
    abortedBy: undefined,
  },
  'graph-conditional': {
    success: true,
    outputs: { router: { route: 'left' }, left: 'went-left' },
    executedNodes: ['router', 'left'],
    error: undefined,
    abortedBy: undefined,
  },
};

describe('workflow differential — legacy executors (golden)', () => {
  it('covers all three architectures', () => {
    const archs = new Set(WORKFLOW_FIXTURES.map((f) => f.arch));
    expect([...archs].sort()).toEqual(['graph', 'v1', 'v2']);
  });

  it('has a golden snapshot for every fixture (no orphans on either side)', () => {
    const fixtureNames = WORKFLOW_FIXTURES.map((f) => f.name).sort();
    const goldenNames = Object.keys(GOLDEN).sort();
    expect(fixtureNames).toEqual(goldenNames);
  });

  for (const fixture of WORKFLOW_FIXTURES) {
    it(`${fixture.name} (${fixture.arch}) matches golden`, async () => {
      const snapshot = await runFixtureLegacy(fixture);
      expect(snapshot).toEqual(GOLDEN[fixture.name]);
    });
  }
});

/**
 * Exported so STEP-63-04+ parity tests reuse the exact golden the legacy side is
 * pinned to, instead of re-deriving expectations.
 */
export { GOLDEN as WORKFLOW_GOLDEN };
export type { WorkflowFixture };
