/**
 * Lossless compilers from Fred's supported workflow dialects into the
 * unified `WorkflowIR` representation.
 *
 * Compilation is deliberately pure: registration, dependency lookup, and
 * execution remain service concerns. Control flow is always emitted as edges;
 * compiler-generated function nodes only adapt source-level result contracts.
 */
import type { PipelineConfigV2 } from '../pipeline/pipeline';
import type { PipelineStep } from '../pipeline/steps';
import type { AnyGraphNode, GraphWorkflowConfig } from '../pipeline/graph';
import { isGraphWorkflowConfig } from '../pipeline/graph';
import { validateGraphWorkflow } from '../pipeline/graph-validator';
import type { IREdge, IRNode, WorkflowIR, WorkflowRetryScope } from './ir';
import { validateWorkflowIR } from './validate';

interface Fragment {
  readonly entry: string;
  readonly exit: string;
  readonly nodes: IRNode[];
  readonly edges: IREdge[];
}

interface V2CompileState {
  readonly usedIds: Set<string>;
  readonly retryScopes: WorkflowRetryScope[];
  nextInternalId(label: string): string;
}

function createV2CompileState(config: PipelineConfigV2): V2CompileState {
  const usedIds = new Set(config.steps.map((step) => step.name));
  let sequence = 0;
  return {
    usedIds,
    retryScopes: [],
    nextInternalId(label) {
      let id: string;
      do {
        id = `__fred:${config.id}:${label}:${sequence++}`;
      } while (usedIds.has(id));
      usedIds.add(id);
      return id;
    },
  };
}

function compileV2Step(
  step: PipelineStep,
  state: V2CompileState,
  options: { readonly internal: boolean; readonly sourceIndex?: number },
): Fragment {
  const id = options.internal ? state.nextInternalId(step.name) : step.name;
  const common = {
    id,
    name: step.name,
    retry: options.internal ? undefined : step.retry,
    contextView: step.contextView,
    internal: options.internal || undefined,
    sourceIndex: options.sourceIndex,
    hookPolicy: options.internal ? 'none' : undefined,
  } as const;

  switch (step.type) {
    case 'agent':
      return {
        entry: id,
        exit: id,
        nodes: [{ ...common, kind: 'agent', agentId: step.agentId }],
        edges: [],
      };
    case 'function':
      return {
        entry: id,
        exit: id,
        nodes: [{ ...common, kind: 'function', fn: step.fn }],
        edges: [],
      };
    case 'pipeline':
      return {
        entry: id,
        exit: id,
        nodes: [{ ...common, kind: 'subworkflow', workflowId: step.pipelineId }],
        edges: [],
      };
    case 'conditional': {
      const conditionId = state.nextInternalId(`${step.name}:condition`);
      const sourceIndex = options.sourceIndex ?? 0;
      const sourceStep = { name: step.name, type: 'conditional', index: sourceIndex } as const;
      const conditionNode: IRNode = {
        id: conditionId,
        name: step.name,
        kind: 'function',
        role: 'condition',
        internal: true,
        sourceIndex: options.sourceIndex,
        contextView: step.contextView,
        hookPolicy: options.internal ? 'none' : 'before',
        sourceStep,
        fn: step.condition,
      };

      const compileBranch = (branch: readonly PipelineStep[]): Fragment | undefined => {
        if (branch.length === 0) return undefined;
        const fragments = branch.map((nested) =>
          compileV2Step(nested, state, {
            internal: true,
            sourceIndex: options.sourceIndex,
          }),
        );
        const nodes = fragments.flatMap((fragment) => fragment.nodes);
        const edges = fragments.flatMap((fragment) => fragment.edges);
        for (let index = 1; index < fragments.length; index++) {
          edges.push({ from: fragments[index - 1]!.exit, to: fragments[index]!.entry });
        }
        return {
          entry: fragments[0]!.entry,
          exit: fragments[fragments.length - 1]!.exit,
          nodes,
          edges,
        };
      };

      const trueBranch = compileBranch(step.whenTrue);
      const falseBranch = compileBranch(step.whenFalse ?? []);
      const resultNode: IRNode = {
        ...common,
        kind: 'function',
        role: 'condition-result',
        retry: undefined,
        hookPolicy: options.internal ? 'none' : 'after',
        sourceStep,
        fn: (context) => {
          const conditionResult = context.outputs[conditionId] === true;
          const selected = conditionResult ? trueBranch : falseBranch;
          const branchInfo = {
            conditionResult,
            takenPath: conditionResult ? 'whenTrue' : 'whenFalse',
            notTakenPath: conditionResult ? 'whenFalse' : 'whenTrue',
          };
          if (!selected) return { conditionResult, skipped: true, branchInfo };
          return { conditionResult, result: context.outputs[selected.exit], branchInfo };
        },
      };

      const nodes: IRNode[] = [conditionNode];
      const edges: IREdge[] = [];
      if (trueBranch) nodes.push(...trueBranch.nodes);
      if (falseBranch) nodes.push(...falseBranch.nodes);
      nodes.push(resultNode);
      if (trueBranch) edges.push(...trueBranch.edges);
      if (falseBranch) edges.push(...falseBranch.edges);

      const trueEntry = trueBranch?.entry ?? id;
      const falseEntry = falseBranch?.entry ?? id;
      edges.push({
        from: conditionId,
        to: trueEntry,
        when: {
          type: 'predicate',
          predicate: (context) => context.outputs[conditionId] === true,
        },
      });
      edges.push({
        from: conditionId,
        to: falseEntry,
        when: {
          type: 'predicate',
          predicate: (context) => context.outputs[conditionId] === false,
        },
      });
      if (trueBranch) edges.push({ from: trueBranch.exit, to: id });
      if (falseBranch) edges.push({ from: falseBranch.exit, to: id });

      if (!options.internal) {
        state.retryScopes.push({
          id: state.nextInternalId(`${step.name}:retry-scope`),
          entry: conditionId,
          exit: id,
          nodeIds: nodes.map((node) => node.id),
          stepName: step.name,
          sourceIndex,
          retry: step.retry,
        });
      }

      return { entry: conditionId, exit: id, nodes, edges };
    }
  }
}

/** Compile a V2 typed-step pipeline, lowering nested conditions to guarded edges. */
export function compilePipelineV2(config: PipelineConfigV2): WorkflowIR {
  const state = createV2CompileState(config);
  const fragments = config.steps.map((step, sourceIndex) =>
    compileV2Step(step, state, { internal: false, sourceIndex }),
  );
  const nodes = fragments.flatMap((fragment) => fragment.nodes);
  const edges = fragments.flatMap((fragment) => fragment.edges);
  for (let index = 1; index < fragments.length; index++) {
    edges.push({ from: fragments[index - 1]!.exit, to: fragments[index]!.entry });
  }
  const ir: WorkflowIR = {
    id: config.id,
    nodes,
    edges,
    entry: fragments[0]?.entry ?? '',
    hooks: config.hooks,
    checkpoint: config.checkpoint,
    failFast: config.failFast,
    retryScopes: state.retryScopes,
    source: 'v2',
  };
  validateWorkflowIR(ir);
  return ir;
}

function graphNodeToIR(node: AnyGraphNode): IRNode {
  switch (node.type) {
    case 'agent':
      return {
        id: node.id,
        name: node.name,
        expose: node.expose,
        kind: 'agent',
        agentId: node.agentId,
      };
    case 'function':
      return {
        id: node.id,
        name: node.name,
        expose: node.expose,
        kind: 'function',
        fn: node.fn,
      };
    case 'conditional':
      return {
        id: node.id,
        name: node.name,
        expose: node.expose,
        kind: 'function',
        role: 'condition',
        fn: async (context) => ({ conditionResult: await node.condition(context) }),
      };
    case 'pipeline':
      return {
        id: node.id,
        name: node.name,
        expose: node.expose,
        kind: 'subworkflow',
        workflowId: node.pipelineId,
      };
    case 'fork':
      return {
        id: node.id,
        name: node.id,
        kind: 'function',
        role: 'fork',
        recordOutput: false,
        fn: () => undefined,
      };
    case 'join': {
      const join = node;
      return {
        id: join.id,
        name: join.id,
        kind: 'function',
        role: 'join',
        join: { type: 'all', merge: join.mergeStrategy, sources: join.sources },
        fn: (context) => {
          const values = join.sources.map((source) => context.outputs[source]);
          if (join.mergeStrategy === 'array') return values;
          return values.reduce<unknown>((accumulator, value) => {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              const current =
                typeof accumulator === 'object' &&
                accumulator !== null &&
                !Array.isArray(accumulator)
                  ? accumulator
                  : {};
              return { ...current, ...value };
            }
            return value;
          }, {});
        },
      };
    }
  }
}

/** Compile a graph workflow. Fork/join semantics become edges plus node metadata. */
export function compileGraphWorkflow(config: GraphWorkflowConfig): WorkflowIR {
  validateGraphWorkflow(config);
  const nodes = config.nodes.map(graphNodeToIR);
  const edges: IREdge[] = config.edges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    when: edge.condition ? { type: 'branch', condition: edge.condition } : undefined,
    default: edge.default,
  }));
  const edgeKeys = new Set(edges.map((edge) => `${edge.from}\u0000${edge.to}`));
  for (const node of config.nodes) {
    if (node.type === 'fork') {
      for (const branch of node.branches) {
        const key = `${node.id}\u0000${branch}`;
        if (!edgeKeys.has(key)) {
          edges.push({ from: node.id, to: branch });
          edgeKeys.add(key);
        }
      }
    }
    if (node.type === 'join') {
      for (const source of node.sources) {
        const key = `${source}\u0000${node.id}`;
        if (!edgeKeys.has(key)) {
          edges.push({ from: source, to: node.id });
          edgeKeys.add(key);
        }
      }
    }
  }
  const ir: WorkflowIR = {
    id: config.id,
    nodes,
    edges,
    entry: config.entryNode,
    hooks: config.hooks,
    handoffs: config.handoffs,
    source: 'graph',
  };
  validateWorkflowIR(ir);
  return ir;
}

function hasOwn(record: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** Structural guard for already-native workflow definitions. */
export function isWorkflowIR(value: unknown): value is WorkflowIR {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return hasOwn(candidate, 'id') &&
    typeof candidate.id === 'string' &&
    hasOwn(candidate, 'entry') &&
    typeof candidate.entry === 'string' &&
    hasOwn(candidate, 'nodes') &&
    Array.isArray(candidate.nodes) &&
    hasOwn(candidate, 'edges') &&
    Array.isArray(candidate.edges);
}

export type CompilableWorkflow =
  | PipelineConfigV2
  | GraphWorkflowConfig
  | WorkflowIR;

export const UNSUPPORTED_WORKFLOW_DEFINITION_MESSAGE =
  'Unsupported workflow definition. Expected a V2 workflow with a steps array, a graph workflow, or native WorkflowIR. Legacy agent-list pipelines are no longer supported.';

/** Runtime guard for unchecked callers crossing the workflow compilation boundary. */
export function isPipelineV2Definition(value: unknown): value is PipelineConfigV2 {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Readonly<Record<string, unknown>>;
  return hasOwn(candidate, 'id') &&
    typeof candidate.id === 'string' &&
    hasOwn(candidate, 'steps') &&
    Array.isArray(candidate.steps);
}

/** Compile any supported workflow definition, validating native IR unchanged. */
export function compileWorkflow(config: CompilableWorkflow): WorkflowIR {
  if (isGraphWorkflowConfig(config)) return compileGraphWorkflow(config);
  if (isWorkflowIR(config)) {
    const source: unknown = config.source;
    if (
      source !== undefined &&
      source !== 'v2' &&
      source !== 'graph' &&
      source !== 'native'
    ) {
      throw new TypeError(
        `Unsupported WorkflowIR source "${String(source)}". Expected "v2", "graph", or "native".`,
      );
    }
    const native: WorkflowIR = source === undefined ? { ...config, source: 'native' } : config;
    validateWorkflowIR(native);
    return native;
  }
  if (isPipelineV2Definition(config)) return compilePipelineV2(config);
  throw new TypeError(UNSUPPORTED_WORKFLOW_DEFINITION_MESSAGE);
}

/** Define a native workflow with validation and an explicit native source tag. */
export function defineWorkflow(workflow: WorkflowIR): WorkflowIR {
  return compileWorkflow({ ...workflow, source: workflow.source ?? 'native' });
}
