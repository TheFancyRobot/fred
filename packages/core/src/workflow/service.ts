import { Context, Effect, Layer, Ref } from 'effect';
import { AgentService } from '../agent/service';
import type { Workflow } from './manager';

export interface WorkflowService {
  addWorkflow(name: string, config: Omit<Workflow, 'name'>): Effect.Effect<void>;
  getWorkflow(name: string): Effect.Effect<Workflow | undefined>;
  listWorkflows(): Effect.Effect<string[]>;
  hasWorkflow(name: string): Effect.Effect<boolean>;
  clear(): Effect.Effect<void>;
}

export const WorkflowService = Context.GenericTag<WorkflowService>('WorkflowService');

export const WorkflowServiceLive = Layer.effect(
  WorkflowService,
  Effect.gen(function* () {
    const workflowsRef = yield* Ref.make(new Map<string, Workflow>());
    const agentService = yield* AgentService;

    const validateWorkflowAgents = (name: string, workflow: Workflow): Effect.Effect<void> =>
      Effect.gen(function* () {
        const defaultAgent = yield* agentService.getAgentOptional(workflow.defaultAgent);
        if (!defaultAgent) {
          yield* Effect.sync(() => {
            console.warn(
              `[Workflow] Default agent "${workflow.defaultAgent}" not found in workflow "${name}"`
            );
          });
        }

        yield* Effect.forEach(workflow.agents, (agentId) =>
          Effect.gen(function* () {
            const agent = yield* agentService.getAgentOptional(agentId);
            if (!agent) {
              yield* Effect.sync(() => {
                console.warn(
                  `[Workflow] Agent "${agentId}" referenced in workflow "${name}" not found`
                );
              });
            }
          })
        );
      });

    const service: WorkflowService = {
      addWorkflow: (name, config) =>
        Effect.gen(function* () {
          const workflow: Workflow = { name, ...config };
          yield* Ref.update(workflowsRef, (workflows) => {
            const next = new Map(workflows);
            next.set(name, workflow);
            return next;
          });
          yield* validateWorkflowAgents(name, workflow);
        }),

      getWorkflow: (name) =>
        Effect.map(Ref.get(workflowsRef), (workflows) => workflows.get(name)),

      listWorkflows: () =>
        Effect.map(Ref.get(workflowsRef), (workflows) => Array.from(workflows.keys())),

      hasWorkflow: (name) =>
        Effect.map(Ref.get(workflowsRef), (workflows) => workflows.has(name)),

      clear: () => Ref.set(workflowsRef, new Map<string, Workflow>()),
    };

    return service;
  })
);

export type { Workflow } from './manager';
