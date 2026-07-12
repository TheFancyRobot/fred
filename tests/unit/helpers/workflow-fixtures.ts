/**
 * Phase 63 / STEP-63-01: differential test corpus.
 *
 * A single, reusable set of deterministic workflow fixtures spanning all three
 * supported compiled architectures (V2 typed steps and graph DAG). Every
 * fixture is fully deterministic — function steps and echo mock agents only, no
 * AI — so its result can be snapshotted and compared byte-for-byte.
 *
 * The differential contract for the phase:
 *   snapshot(legacyExecutor(fixture)) === snapshot(unifiedExecutor(fixture))
 * for every fixture. STEP-63-01 locks the legacy side as golden; later steps
 * flip execution to the compiled-IR path and re-run the same corpus to prove
 * parity, one architecture at a time.
 */
import { Effect, Layer } from 'effect';
import {
  PipelineService,
  PipelineServiceLive,
} from '../../../packages/core/src/pipeline/service';
import { AgentService } from '../../../packages/core/src/agent/service';
import { ExecutorServiceLive } from '../../../packages/core/src/pipeline/executor';
import { GraphExecutorServiceLive } from '../../../packages/core/src/pipeline/graph-executor';
import { HookManagerServiceLive } from '../../../packages/core/src/hooks/service';
import { PauseServiceLive } from '../../../packages/core/src/pipeline/pause/service';
import { CheckpointServiceLive } from '../../../packages/core/src/pipeline/checkpoint/service';
import { ToolGateServiceLive } from '../../../packages/core/src/tool-gate/service';
import { ToolRegistryServiceLive } from '../../../packages/core/src/tool/service';
import { ProviderRegistryServiceLive } from '../../../packages/core/src/platform/service';
import { AgentNotFoundError } from '../../../packages/core/src/agent/errors';
import type { AgentInstance, AgentResponse } from '../../../packages/core/src/agent/agent';
import type { PipelineResult } from '../../../packages/core/src/pipeline/executor';
import type { GraphExecutionResult } from '../../../packages/core/src/pipeline/graph-executor';
import type {
  Checkpoint,
  CheckpointStatus,
  CheckpointStorage,
} from '../../../packages/core/src/pipeline/checkpoint/types';

/** Workflow architecture under test. */
export type WorkflowArch = 'v2' | 'graph';

/**
 * A deterministic echo agent. Its response is a pure function of id + input, so
 * agent chains produce fully predictable, nestable strings (e.g. `b<-a<-hi`).
 */
function createEchoAgent(id: string): AgentInstance {
  return {
    id,
    config: { id, systemMessage: '', platform: 'mock', model: 'mock' } as AgentInstance['config'],
    processMessage: (message: string): Effect.Effect<AgentResponse, Error> =>
      Effect.succeed({ content: `${id}<-${message}`, toolCalls: [] }),
  };
}

/** Minimal in-memory checkpoint storage — enough to satisfy the V2 executor wiring. */
function createInMemoryCheckpointStorage(): CheckpointStorage {
  const checkpoints: Checkpoint[] = [];
  const active = () => checkpoints.filter((c) => !c.expiresAt || c.expiresAt > new Date());
  return {
    async save(checkpoint) {
      const i = checkpoints.findIndex(
        (c) => c.runId === checkpoint.runId && c.step === checkpoint.step,
      );
      if (i >= 0) checkpoints[i] = checkpoint;
      else checkpoints.push(checkpoint);
    },
    async getLatest(runId) {
      return (
        checkpoints
          .filter((c) => c.runId === runId)
          .sort((a, b) => b.step - a.step)[0] ?? null
      );
    },
    async get(runId, step) {
      return checkpoints.find((c) => c.runId === runId && c.step === step) ?? null;
    },
    async updateStatus(runId, step, status: CheckpointStatus) {
      const c = checkpoints.find((x) => x.runId === runId && x.step === step);
      if (c) {
        c.status = status;
        c.updatedAt = new Date();
      }
    },
    async deleteRun(runId) {
      for (let i = checkpoints.length - 1; i >= 0; i--) {
        if (checkpoints[i].runId === runId) checkpoints.splice(i, 1);
      }
    },
    async deleteExpired() {
      const now = new Date();
      const expired = checkpoints.filter((c) => c.expiresAt && c.expiresAt < now);
      for (const cp of expired) checkpoints.splice(checkpoints.indexOf(cp), 1);
      return expired.length;
    },
    async listByStatus(status) {
      return checkpoints.filter((c) => c.status === status);
    },
    async getLatestByPipelineId(pipelineId) {
      return (
        active()
          .filter((c) => c.pipelineId === pipelineId)
          .sort((a, b) =>
            b.step !== a.step ? b.step - a.step : b.createdAt.getTime() - a.createdAt.getTime(),
          )[0] ?? null
      );
    },
    async close() {
      checkpoints.length = 0;
    },
  };
}

/**
 * Build a full PipelineService layer whose AgentService is backed by a fixed set
 * of echo agents. Only the accessors the executors touch (getAgent /
 * getAgentOptional / hasAgent / getAllAgents) do real work; the rest are inert.
 */
export function buildWorkflowTestLayer(agentIds: readonly string[]): Layer.Layer<PipelineService> {
  const agents = new Map(agentIds.map((id) => [id, createEchoAgent(id)]));

  const MockAgentService = Layer.succeed(AgentService, {
    createAgent: () => Effect.die('not implemented'),
    getAgent: (id: string) => {
      const agent = agents.get(id);
      return agent
        ? Effect.succeed(agent)
        : Effect.fail(new AgentNotFoundError({ id, message: `Agent not found: ${id}` }));
    },
    getAgentOptional: (id: string) => Effect.succeed(agents.get(id)),
    hasAgent: (id: string) => Effect.succeed(agents.has(id)),
    removeAgent: () => Effect.succeed(false),
    getAllAgents: () => Effect.succeed([...agents.values()]),
    clear: () => Effect.void,
    setTracer: () => Effect.void,
    setDefaultSystemMessage: () => Effect.void,
    setGlobalVariablesResolver: () => Effect.void,
    matchAgentByUtterance: () => Effect.succeed(null),
    getMCPMetrics: () => Effect.succeed({}),
    registerShutdownHooks: () => Effect.void,
    setTemplateEngine: () => Effect.void,
    setTemplateCustomNamespaces: () => Effect.void,
    setTemplateEnvAllowlist: () => Effect.void,
    setTemplateFredConfig: () => Effect.void,
  } as unknown as AgentService);

  return PipelineServiceLive.pipe(
    Layer.provide(MockAgentService),
    Layer.provide(ExecutorServiceLive),
    Layer.provide(GraphExecutorServiceLive),
    Layer.provide(HookManagerServiceLive),
    Layer.provide(PauseServiceLive),
    Layer.provide(CheckpointServiceLive({ storage: createInMemoryCheckpointStorage() })),
    Layer.provide(ToolGateServiceLive),
    Layer.provide(ToolRegistryServiceLive),
    Layer.provide(ProviderRegistryServiceLive),
  );
}

/**
 * A single differential fixture: the agents it needs, and an effect that
 * registers + executes it through the PipelineService, returning the raw result.
 */
export interface WorkflowFixture {
  readonly name: string;
  readonly arch: WorkflowArch;
  readonly agents: readonly string[];
  readonly run: Effect.Effect<unknown, unknown, PipelineService>;
}

const v2 = (
  name: string,
  agents: readonly string[],
  build: (service: PipelineService) => Effect.Effect<PipelineResult, unknown, never>,
): WorkflowFixture => ({ name, arch: 'v2', agents, run: Effect.flatMap(PipelineService, build) });

const graph = (
  name: string,
  agents: readonly string[],
  build: (service: PipelineService) => Effect.Effect<GraphExecutionResult, unknown, never>,
): WorkflowFixture => ({ name, arch: 'graph', agents, run: Effect.flatMap(PipelineService, build) });

/**
 * The differential corpus. Each fixture exercises a behavior the unified
 * executor must reproduce exactly: output accumulation + conditional branching
 * (V2), and edge routing + execution order (graph).
 */
export const WORKFLOW_FIXTURES: readonly WorkflowFixture[] = [
  // ---- V2: typed-step pipelines ----
  v2('v2-function-single', [], (s) =>
    Effect.gen(function* () {
      yield* s.createPipelineV2({
        id: 'v2-fn',
        steps: [{ name: 'transform', type: 'function', fn: (ctx) => `T:${ctx.input}` }],
      });
      return yield* s.executePipelineV2('v2-fn', 'hi');
    }),
  ),
  v2('v2-function-accumulate', [], (s) =>
    Effect.gen(function* () {
      yield* s.createPipelineV2({
        id: 'v2-acc',
        steps: [
          { name: 'first', type: 'function', fn: (ctx) => `first:${ctx.input}` },
          { name: 'second', type: 'function', fn: (ctx) => `second:${ctx.outputs.first}` },
        ],
      });
      return yield* s.executePipelineV2('v2-acc', 'hi');
    }),
  ),
  v2('v2-agent-step', ['a'], (s) =>
    Effect.gen(function* () {
      yield* s.createPipelineV2({
        id: 'v2-agent',
        steps: [{ name: 'call', type: 'agent', agentId: 'a' }],
      });
      return yield* s.executePipelineV2('v2-agent', 'hi');
    }),
  ),
  v2('v2-conditional-true', [], (s) =>
    Effect.gen(function* () {
      yield* s.createPipelineV2({
        id: 'v2-cond',
        steps: [
          {
            name: 'branch',
            type: 'conditional',
            condition: (ctx) => ctx.input === 'go',
            whenTrue: [{ name: 'yes', type: 'function', fn: () => 'took-true' }],
            whenFalse: [{ name: 'no', type: 'function', fn: () => 'took-false' }],
          },
        ],
      });
      return yield* s.executePipelineV2('v2-cond', 'go');
    }),
  ),

  // ---- Graph: DAG workflows (function nodes for determinism) ----
  graph('graph-single-node', [], (s) =>
    Effect.gen(function* () {
      yield* s.registerGraphWorkflow({
        id: 'g-single',
        type: 'graph',
        entryNode: 'only',
        nodes: [{ id: 'only', type: 'function', fn: (ctx) => `only:${ctx.input}` }],
        edges: [],
      });
      return yield* s.executeGraphWorkflow('g-single', 'hi');
    }),
  ),
  graph('graph-linear', [], (s) =>
    Effect.gen(function* () {
      yield* s.registerGraphWorkflow({
        id: 'g-linear',
        type: 'graph',
        entryNode: 'n1',
        nodes: [
          { id: 'n1', type: 'function', fn: (ctx) => `n1:${ctx.input}` },
          { id: 'n2', type: 'function', fn: (ctx) => `n2:${ctx.outputs.n1}` },
        ],
        edges: [{ from: 'n1', to: 'n2' }],
      });
      return yield* s.executeGraphWorkflow('g-linear', 'hi');
    }),
  ),
  graph('graph-conditional', [], (s) =>
    Effect.gen(function* () {
      yield* s.registerGraphWorkflow({
        id: 'g-cond',
        type: 'graph',
        entryNode: 'router',
        nodes: [
          { id: 'router', type: 'function', expose: ['route'], fn: () => ({ route: 'left' }) },
          { id: 'left', type: 'function', fn: () => 'went-left' },
          { id: 'right', type: 'function', fn: () => 'went-right' },
        ],
        edges: [
          { from: 'router', to: 'left', condition: { field: 'router.route', operator: 'equals', value: 'left' } },
          { from: 'router', to: 'right', default: true },
        ],
      });
      return yield* s.executeGraphWorkflow('g-cond', 'hi');
    }),
  ),
];

/**
 * Project a raw executor result into a stable, serializable snapshot: strip
 * non-deterministic fields (runId, timestamps) and reduce Errors to
 * {name, message}. Two results with equal snapshots are behaviorally identical
 * for differential purposes.
 */
export function snapshotResult(arch: WorkflowArch, raw: unknown): Record<string, unknown> {
  const errShape = (e: unknown) =>
    e instanceof Error ? { name: e.name, message: e.message } : e ?? undefined;

  if (arch === 'v2') {
    const r = raw as PipelineResult;
    return {
      success: r.success,
      status: r.status,
      finalOutput: r.finalOutput,
      outputs: r.context.outputs,
      pipelineId: r.context.pipelineId,
      error: errShape(r.error),
      abortedBy: r.abortedBy,
    };
  }
  const r = raw as GraphExecutionResult;
  return {
    success: r.success,
    outputs: r.outputs,
    executedNodes: r.executedNodes,
    error: errShape(r.error),
    abortedBy: r.abortedBy,
  };
}

/** Run a fixture through the legacy service path and return its snapshot. */
export function runFixtureLegacy(fixture: WorkflowFixture): Promise<Record<string, unknown>> {
  return Effect.runPromise(
    fixture.run.pipe(Effect.provide(buildWorkflowTestLayer(fixture.agents))) as Effect.Effect<unknown>,
  ).then((raw) => snapshotResult(fixture.arch, raw));
}
