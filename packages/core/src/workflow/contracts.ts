import { Effect, ParseResult, Schema } from 'effect';
import type * as SchemaTypes from 'effect/Schema';
import {
  WorkflowInputValidationError,
  WorkflowOutputValidationError,
} from './errors';
import type { WorkflowIR, WorkflowSource } from './ir';

/** Transport-neutral public metadata for one registered workflow. */
export interface WorkflowDescriptor {
  readonly id: string;
  readonly source: WorkflowSource;
  readonly input: SchemaTypes.Schema.AnyNoContext;
  readonly output: SchemaTypes.Schema.AnyNoContext;
}

/** Legacy workflows accept strings and place no constraint on their output. */
export const workflowInputSchema = (
  workflow: WorkflowIR,
): SchemaTypes.Schema.AnyNoContext => workflow.input ?? Schema.String;

export const workflowOutputSchema = (
  workflow: WorkflowIR,
): SchemaTypes.Schema.AnyNoContext => workflow.output ?? Schema.Unknown;

/** Copy only safe discovery data; executable nodes and mutable IR collections stay private. */
export const describeWorkflow = (workflow: WorkflowIR): WorkflowDescriptor =>
  Object.freeze({
    id: workflow.id,
    source: workflow.source ?? 'native',
    input: workflowInputSchema(workflow),
    output: workflowOutputSchema(workflow),
  });

const formatPath = (path: ReadonlyArray<PropertyKey>): string => {
  if (path.length === 0) return '(root)';
  return path.reduce<string>((result, segment) => {
    if (typeof segment === 'number') return `${result}[${segment}]`;
    return result.length === 0 ? String(segment) : `${result}.${String(segment)}`;
  }, '');
};

/** Report useful field locations without retaining rejected input or output values. */
const issuePaths = (error: ParseResult.ParseError): string[] => {
  const paths = ParseResult.ArrayFormatter.formatErrorSync(error).map((issue) =>
    formatPath(issue.path),
  );
  return [...new Set(paths)];
};

export const decodeWorkflowInput = (
  workflow: WorkflowIR,
  input: unknown,
): Effect.Effect<unknown, WorkflowInputValidationError> =>
  Schema.decodeUnknown(workflowInputSchema(workflow), { errors: 'all' })(input).pipe(
    Effect.mapError((error) => {
      const issues = issuePaths(error);
      return new WorkflowInputValidationError({
        workflowId: workflow.id,
        issues,
        message: `Input validation failed for workflow "${workflow.id}" at ${issues.join(', ')}.`,
      });
    }),
  );

export const validateWorkflowOutput = (
  workflow: WorkflowIR,
  output: unknown,
): Effect.Effect<unknown, WorkflowOutputValidationError> =>
  Schema.validate(workflowOutputSchema(workflow), { errors: 'all' })(output).pipe(
    Effect.mapError((error) => {
      const issues = issuePaths(error);
      return new WorkflowOutputValidationError({
        workflowId: workflow.id,
        issues,
        message: `Output validation failed for workflow "${workflow.id}" at ${issues.join(', ')}.`,
      });
    }),
  );
