/**
 * Phase 63 / STEP-63-02: WorkflowIR — the unified workflow intermediate
 * representation.
 *
 * Fred grew three separate workflow models that duplicate executor logic:
 *   - V1  `PipelineConfig`      — an ordered agent list (message threads through);
 *   - V2  `PipelineConfigV2`    — typed steps with checkpoint/pause/resume;
 *   - graph `GraphWorkflowConfig` — a DAG with conditional edges + fork/join.
 *
 * `WorkflowIR` is the single primitive all three compile down to (see
 * `compile.ts`), executed by one executor (see `execute.ts`). It is a true
 * superset because **control flow lives on edges, not nodes**:
 *
 *   - fan-out (parallel branches) = a node with multiple out-edges;
 *   - join (wait for branches)     = a node with multiple in-edges + a JoinPolicy;
 *   - condition (branching)        = an edge `when` guard;
 *   - handoff                      = an edge added dynamically at runtime.
 *
 * So the only node *kinds* are the executable units — agent, function,
 * subworkflow. Fork/join/conditional are NOT node kinds. This mirrors the graph
 * executor's edge-driven model (the chosen execution base) rather than V2's
 * nested-sequence model.
 *
 * Note: distinct from the existing `Workflow` type in `./manager` (a routing
 * entry point that groups agents by name) — `WorkflowIR` is the execution graph.
 *
 * This module is types + pure structural accessors only. No execution logic and
 * no `Effect.runPromise` — it stays a clean, dependency-light foundation.
 */
import type { Schema } from 'effect';
import type { PipelineContext } from '../pipeline/context';
import type { BranchCondition } from '../pipeline/graph';
import type { RetryConfig } from '../pipeline/steps';
import type { CheckpointConfig, PipelineHooks } from '../pipeline/pipeline';

/**
 * A function node body. Receives the accumulated pipeline context and returns
 * this node's output (recorded under its id). May be sync or async — identical
 * to V2 `FunctionStep.fn` / graph `FunctionGraphNode.fn`.
 */
export type WorkflowFn = (context: PipelineContext) => Promise<unknown> | unknown;

/**
 * How a node with multiple in-edges reconciles its upstream branches before it
 * runs. Absent = the node runs as soon as it is first reached (linear / simple
 * DAG behavior). `all` reproduces the graph `JoinNode` (wait for every source,
 * then merge their outputs).
 */
export type JoinPolicy =
  | {
      readonly type: 'all';
      /** How to combine source outputs, matching graph `JoinNode.mergeStrategy`. */
      readonly merge: 'shallow-merge' | 'array';
      /** Node ids that must all complete before this node runs. */
      readonly sources: readonly string[];
    }
  | { readonly type: 'any' };

/** Which source-level step hooks a lowered node is responsible for emitting. */
export type WorkflowHookPolicy = 'all' | 'before' | 'after' | 'none';

/**
 * A compiler-lowered execution region that must retry as one source step.
 * V2 conditionals use this to keep their condition and selected branch inside
 * the parent step's retry boundary without introducing a conditional node kind.
 */
export interface WorkflowRetryScope {
  readonly id: string;
  readonly entry: string;
  readonly exit: string;
  readonly nodeIds: readonly string[];
  readonly stepName: string;
  readonly sourceIndex: number;
  readonly retry?: RetryConfig;
}

/** Fields common to every executable node. */
export interface IRNodeBase {
  /** Unique node identifier; keys this node's output in `context.outputs`. */
  readonly id: string;
  /** Optional display name for observability (defaults to `id`). */
  readonly name?: string;
  /** Fields of this node's output to expose for downstream edge conditions. */
  readonly expose?: readonly string[];
  /** Retry policy for this node (carried from V2 `BaseStep.retry`). */
  readonly retry?: RetryConfig;
  /** Context visibility when this node runs (carried from V2 `BaseStep.contextView`). */
  readonly contextView?: 'accumulated' | 'isolated';
  /** Join behavior when multiple edges lead into this node. Default: run when reached. */
  readonly join?: JoinPolicy;
  /**
   * Compiler-generated nodes participate in execution but are omitted from the
   * public output map. This is used to lower nested V2 conditionals without
   * leaking their implementation details into `PipelineContext.outputs`.
   */
  readonly internal?: boolean;
  /**
   * Whether the executor records this node's return value. Fork shims are real
   * traversal points (and remain observable in `executedNodes`) but intentionally
   * do not create an output entry, matching the legacy graph contract.
   */
  readonly recordOutput?: boolean;
  /** Source step index for checkpoint/resume compatibility with V2 pipelines. */
  readonly sourceIndex?: number;
  /** Optional semantic role for observability; this is metadata, not a node kind. */
  readonly role?: 'fork' | 'join' | 'condition' | 'condition-result';
  /** Hook lifecycle responsibility for compiler-lowered source steps. */
  readonly hookPolicy?: WorkflowHookPolicy;
  /** Source-level step metadata used when compiler-generated nodes emit hooks. */
  readonly sourceStep?: {
    readonly name: string;
    readonly type: string;
    readonly index: number;
  };
}

/** Executes a registered agent; the agent sees the incoming message + history. */
export interface IRAgentNode extends IRNodeBase {
  readonly kind: 'agent';
  readonly agentId: string;
}

/** Executes a custom function against the pipeline context. */
export interface IRFunctionNode extends IRNodeBase {
  readonly kind: 'function';
  readonly fn: WorkflowFn;
}

/** Executes another registered workflow/pipeline as a nested step. */
export interface IRSubworkflowNode extends IRNodeBase {
  readonly kind: 'subworkflow';
  readonly workflowId: string;
}

/** The executable node kinds. Control flow is expressed by edges, not nodes. */
export type IRNode = IRAgentNode | IRFunctionNode | IRSubworkflowNode;

/**
 * Predicate guard on an edge, evaluated against the live context. This is V2's
 * conditional model (`(context) => boolean`).
 */
export type EdgePredicate = (context: PipelineContext) => boolean | Promise<boolean>;

/**
 * An edge guard. The IR supports both source dialects so compilation is lossless:
 *   - `branch`    — the graph's declarative `BranchCondition` (field/operator/value);
 *   - `predicate` — V2's imperative predicate function.
 */
export type EdgeGuard =
  | { readonly type: 'branch'; readonly condition: BranchCondition }
  | { readonly type: 'predicate'; readonly predicate: EdgePredicate };

/**
 * A directed edge. Taken when `when` is absent (unconditional) or evaluates
 * true. Among conditional out-edges of the same source, an edge marked
 * `default: true` is the fallback when none of the guarded ones match.
 */
export interface IREdge {
  readonly from: string;
  readonly to: string;
  /** Guard controlling whether this edge is taken. Absent = always taken. */
  readonly when?: EdgeGuard;
  /** Fallback edge when no guarded out-edge of `from` matches. */
  readonly default?: boolean;
  /** True for edges introduced at runtime (e.g. agent handoff) rather than authored. */
  readonly dynamic?: boolean;
}

/** Which source architecture an IR was compiled from (observability/debugging). */
export type WorkflowSource = 'v1' | 'v2' | 'graph' | 'native';

/**
 * The unified workflow. `nodes` + `edges` form the execution graph; `entry` is
 * where execution begins. Optional `input`/`output` schemas enable typed I/O
 * (Phase 64) and per-workflow OpenAPI (Phase 67).
 */
export interface WorkflowIR {
  readonly id: string;
  readonly nodes: readonly IRNode[];
  readonly edges: readonly IREdge[];
  /** Entry node id — must reference a node in `nodes`. */
  readonly entry: string;
  /** Optional typed input schema. */
  readonly input?: Schema.Schema.Any;
  /** Optional typed output schema. */
  readonly output?: Schema.Schema.Any;
  /** Checkpoint/resume policy (carried from V2 `PipelineConfigV2.checkpoint`). */
  readonly checkpoint?: CheckpointConfig;
  /** Lifecycle hooks (carried from pipeline/graph `hooks`). */
  readonly hooks?: PipelineHooks;
  /** V2 error policy. Defaults to true, matching `PipelineConfigV2.failFast`. */
  readonly failFast?: boolean;
  /** Source-level retry regions introduced while lowering structured control flow. */
  readonly retryScopes?: readonly WorkflowRetryScope[];
  /** Agent handoff constraints (source agent id -> allowed target agent ids). */
  readonly handoffs?: Readonly<Record<string, readonly string[]>>;
  /** Source architecture this IR was compiled from. */
  readonly source?: WorkflowSource;
}

// ---------------------------------------------------------------------------
// Pure structural accessors — shared by compile.ts, execute.ts, and the
// validator so graph traversal is defined in exactly one place.
// ---------------------------------------------------------------------------

export const isAgentNode = (node: IRNode): node is IRAgentNode => node.kind === 'agent';
export const isFunctionNode = (node: IRNode): node is IRFunctionNode => node.kind === 'function';
export const isSubworkflowNode = (node: IRNode): node is IRSubworkflowNode =>
  node.kind === 'subworkflow';

/** Find a node by id, or `undefined` if absent. */
export const findNode = (ir: WorkflowIR, nodeId: string): IRNode | undefined =>
  ir.nodes.find((node) => node.id === nodeId);

/** Edges leaving `nodeId`, in declaration order. */
export const outEdges = (ir: WorkflowIR, nodeId: string): readonly IREdge[] =>
  ir.edges.filter((edge) => edge.from === nodeId);

/** Edges entering `nodeId`, in declaration order. */
export const inEdges = (ir: WorkflowIR, nodeId: string): readonly IREdge[] =>
  ir.edges.filter((edge) => edge.to === nodeId);
