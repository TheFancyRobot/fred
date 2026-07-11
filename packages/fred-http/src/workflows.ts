import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpServerResponse,
  OpenApi,
} from '@effect/platform';
import {
  WorkflowInputValidationError,
  WorkflowOutputValidationError,
  type FredClient,
  type WorkflowDescriptor,
  type WorkflowRunResult,
} from '@fancyrobot/fred';
import { Effect, Layer, Schema, Stream } from 'effect';
import { FredHttpApi } from './api';
import { encodeSseData } from './handlers/sse';

export interface WorkflowHttpConfig {
  /** Absolute endpoint path. Defaults to `/workflows/<encoded workflow id>`. */
  readonly path?: string;
  /** Emit lifecycle events over SSE instead of a single JSON envelope. */
  readonly stream?: boolean;
  /** Omitted inherits server auth; `false` is public. Scope checks are supplied by the auth layer. */
  readonly auth?: false | { readonly scopes?: readonly string[] };
}

export type WorkflowEndpointsConfig = true | Readonly<Record<string, WorkflowHttpConfig>>;

export class WorkflowEndpointConfigurationError extends Schema.TaggedError<WorkflowEndpointConfigurationError>()(
  'WorkflowEndpointConfigurationError',
  {
    workflowId: Schema.optional(Schema.String),
    path: Schema.optional(Schema.String),
    message: Schema.String,
  },
) {}

class WorkflowHttpExecutionError extends Schema.TaggedError<WorkflowHttpExecutionError>()(
  'WorkflowHttpExecutionError',
  { workflowId: Schema.String, message: Schema.String },
) {}

export interface ResolvedWorkflowEndpoint {
  readonly descriptor: WorkflowDescriptor;
  readonly path: `/${string}`;
  readonly stream: boolean;
  readonly auth: WorkflowHttpConfig['auth'];
  readonly endpointName: string;
}

const RESERVED_PATHS = new Set([
  '/agents',
  '/chat',
  '/docs',
  '/docs/openapi.json',
  '/health',
  '/intents',
  '/message',
  '/status',
  '/tools',
  '/v1/chat/completions',
]);

const isValidPath = (path: string): path is `/${string}` =>
  path.startsWith('/')
  && path !== '/'
  && !path.includes('?')
  && !path.includes('#')
  && !path.includes('//')
  && !path.includes(':')
  && !path.includes('*')
  && !/\s/.test(path);

const endpointName = (index: number, id: string): string =>
  `run_${index}_${id.replace(/[^A-Za-z0-9_]/g, '_')}`;

export const resolveWorkflowEndpoints = (
  descriptors: readonly WorkflowDescriptor[],
  selection: WorkflowEndpointsConfig | undefined,
): readonly ResolvedWorkflowEndpoint[] => {
  if (selection === undefined) return [];
  const byId = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const selected: Array<readonly [string, WorkflowHttpConfig]> = selection === true
    ? [...descriptors].map((descriptor) => [descriptor.id, {}] as const)
    : Object.entries(selection);
  selected.sort(([left], [right]) => left.localeCompare(right));

  const occupied = new Set(RESERVED_PATHS);
  return selected.map(([id, config], index) => {
    const descriptor = byId.get(id);
    if (!descriptor) {
      throw new WorkflowEndpointConfigurationError({
        workflowId: id,
        message: `Workflow endpoint references unknown workflow "${id}"`,
      });
    }
    const path = config.path ?? `/workflows/${encodeURIComponent(id)}`;
    if (!isValidPath(path)) {
      throw new WorkflowEndpointConfigurationError({
        workflowId: id,
        path,
        message: `Workflow "${id}" has invalid HTTP path "${path}"`,
      });
    }
    if (occupied.has(path)) {
      throw new WorkflowEndpointConfigurationError({
        workflowId: id,
        path,
        message: `Workflow HTTP path "${path}" is reserved or duplicated`,
      });
    }
    occupied.add(path);
    return {
      descriptor,
      path,
      stream: config.stream ?? false,
      auth: config.auth,
      endpointName: endpointName(index, id),
    };
  });
};

const executionEnvelopeSchema = (endpoint: ResolvedWorkflowEndpoint) => {
  const suffix = endpoint.endpointName.replace(/^run_/, '');
  const completed = Schema.Struct({
    success: Schema.Literal(true),
    status: Schema.Literal('completed'),
    workflowId: Schema.String,
    runId: Schema.optional(Schema.String),
    output: endpoint.descriptor.output,
  }).annotations({ identifier: `WorkflowCompleted_${suffix}` });
  const paused = Schema.Struct({
    success: Schema.Literal(true),
    status: Schema.Literal('paused'),
    workflowId: Schema.String,
    runId: Schema.optional(Schema.String),
    pause: Schema.optional(Schema.Unknown),
  }).annotations({ identifier: `WorkflowPaused_${suffix}` });
  const failed = Schema.Struct({
    success: Schema.Literal(false),
    status: Schema.Literal('failed'),
    workflowId: Schema.String,
    error: Schema.String,
    issues: Schema.optional(Schema.Array(Schema.String)),
  }).annotations({ identifier: `WorkflowFailed_${suffix}` });
  return Schema.Union(completed, paused, failed).annotations({
    identifier: `WorkflowExecution_${suffix}`,
  });
};

const operationTransform = (endpoint: ResolvedWorkflowEndpoint) =>
  (operation: Record<string, any>): Record<string, any> => {
    const success = operation.responses[200];
    return {
      ...operation,
      security: endpoint.auth === false
        ? []
        : [{ bearerAuth: endpoint.auth?.scopes ? [...endpoint.auth.scopes] : [] }],
      responses: endpoint.stream
        ? {
            ...operation.responses,
            200: {
              ...success,
              content: {
                'text/event-stream': {
                  schema: {
                    type: 'string',
                    description: 'Workflow lifecycle events: started, node-completed, and one terminal event.',
                  },
                },
              },
            },
          }
        : operation.responses,
    };
  };

export const buildWorkflowHttpApi = (endpoints: readonly ResolvedWorkflowEndpoint[]) => {
  // The endpoint set is created from runtime registry data, so its union cannot
  // be represented statically. Keep the escape hatch confined to this builder.
  let group = HttpApiGroup.make('workflows') as any;
  for (const endpoint of endpoints) {
    group = group.add(
      HttpApiEndpoint.post(endpoint.endpointName, endpoint.path)
        .setPayload(endpoint.descriptor.input)
        .addSuccess(executionEnvelopeSchema(endpoint))
        .annotate(OpenApi.Transform, operationTransform(endpoint)),
    );
  }
  return HttpApi.make('FredWorkflowApi').add(group);
};

export const buildFredHttpApi = (endpoints: readonly ResolvedWorkflowEndpoint[]) => {
  if (endpoints.length === 0) return FredHttpApi;
  return FredHttpApi.add(buildWorkflowHttpApi(endpoints).groups.workflows!);
};

type RecordValue = Readonly<Record<string, unknown>>;

const isRecord = (value: unknown): value is RecordValue =>
  typeof value === 'object' && value !== null;

const runIdOf = (result: WorkflowRunResult): string | undefined =>
  isRecord(result) && typeof result.runId === 'string' ? result.runId : undefined;

const executedNodesOf = (result: WorkflowRunResult): readonly string[] =>
  isRecord(result) && Array.isArray(result.executedNodes)
    ? result.executedNodes.filter((node): node is string => typeof node === 'string')
    : [];

const completedOutput = (result: WorkflowRunResult): unknown => {
  if (!isRecord(result)) return result;
  if ('finalOutput' in result && result.finalOutput !== undefined) return result.finalOutput;
  if ('output' in result && result.output !== undefined) return result.output;
  if ('content' in result && typeof result.content === 'string') return result.content;
  if ('outputs' in result) return result.outputs;
  return result;
};

export const workflowExecutionEnvelope = (
  workflowId: string,
  result: WorkflowRunResult,
): RecordValue => {
  const runId = runIdOf(result);
  if (isRecord(result) && result.status === 'paused') {
    return {
      success: true,
      status: 'paused',
      workflowId,
      ...(runId === undefined ? {} : { runId }),
      ...(!('pauseRequest' in result) ? {} : { pause: result.pauseRequest }),
    };
  }
  if (isRecord(result) && (result.success === false || result.status === 'failed' || result.status === 'aborted')) {
    return {
      success: false,
      status: 'failed',
      workflowId,
      error: 'Workflow execution failed',
    };
  }
  return {
    success: true,
    status: 'completed',
    workflowId,
    ...(runId === undefined ? {} : { runId }),
    output: completedOutput(result),
  };
};

const runWorkflow = (fred: FredClient, endpoint: ResolvedWorkflowEndpoint, input: unknown) =>
  Effect.tryPromise({
    try: () => fred.workflows.run(endpoint.descriptor.id, input),
    catch: (cause) => {
      if (cause instanceof WorkflowInputValidationError) return cause;
      if (cause instanceof WorkflowOutputValidationError) return cause;
      return new WorkflowHttpExecutionError({
        workflowId: endpoint.descriptor.id,
        message: 'Workflow execution failed',
      });
    },
  }).pipe(Effect.tapError((error) => Effect.logError('Workflow HTTP execution failed', {
    workflowId: endpoint.descriptor.id,
    errorTag: error._tag,
  })));

const jsonResponse = (fred: FredClient, endpoint: ResolvedWorkflowEndpoint, input: unknown) =>
  runWorkflow(fred, endpoint, input).pipe(
    Effect.map((result) => HttpServerResponse.unsafeJson(
      workflowExecutionEnvelope(endpoint.descriptor.id, result),
    )),
    Effect.catchTags({
      WorkflowInputValidationError: (error) => Effect.succeed(HttpServerResponse.unsafeJson({
        success: false,
        status: 'failed',
        workflowId: endpoint.descriptor.id,
        error: 'Workflow input is invalid',
        issues: error.issues,
      }, { status: 400 })),
      WorkflowOutputValidationError: () => Effect.succeed(HttpServerResponse.unsafeJson({
        success: false,
        status: 'failed',
        workflowId: endpoint.descriptor.id,
        error: 'Workflow output is invalid',
      }, { status: 500 })),
    }),
    Effect.catchTag('WorkflowHttpExecutionError', () => Effect.succeed(HttpServerResponse.unsafeJson({
        success: false,
        status: 'failed',
        workflowId: endpoint.descriptor.id,
        error: 'Workflow execution failed',
      }, { status: 500 }))),
  );

const sseEvent = (event: string, data: RecordValue): Uint8Array =>
  encodeSseData(JSON.stringify({ event, data }));

const sseResponse = (fred: FredClient, endpoint: ResolvedWorkflowEndpoint, input: unknown) => {
  const started = Stream.succeed(sseEvent('started', { workflowId: endpoint.descriptor.id }));
  const execution = Stream.unwrap(
    runWorkflow(fred, endpoint, input).pipe(
      Effect.map((result) => {
        const nodeEvents = executedNodesOf(result).map((_, index) =>
          sseEvent('node-completed', { workflowId: endpoint.descriptor.id, index }),
        );
        const envelope = workflowExecutionEnvelope(endpoint.descriptor.id, result);
        const terminal = envelope.status === 'failed' ? 'failed' : 'completed';
        return Stream.fromIterable([...nodeEvents, sseEvent(terminal, envelope)]);
      }),
      Effect.catchTags({
        WorkflowInputValidationError: () => Effect.succeed(Stream.succeed(sseEvent('failed', {
          workflowId: endpoint.descriptor.id,
          error: 'Workflow input is invalid',
        }))),
        WorkflowOutputValidationError: () => Effect.succeed(Stream.succeed(sseEvent('failed', {
          workflowId: endpoint.descriptor.id,
          error: 'Workflow output is invalid',
        }))),
        WorkflowHttpExecutionError: () => Effect.succeed(Stream.succeed(sseEvent('failed', {
          workflowId: endpoint.descriptor.id,
          error: 'Workflow execution failed',
        }))),
      }),
    ),
  );
  return HttpServerResponse.stream(Stream.concat(started, execution), {
    contentType: 'text/event-stream; charset=utf-8',
    headers: { 'cache-control': 'no-cache', connection: 'keep-alive' },
  });
};

/** Runtime-generated group types are isolated here; concrete Schemas still govern all payloads. */
export const buildWorkflowHandlersLayer = (
  api: ReturnType<typeof buildFredHttpApi>,
  fred: FredClient,
  endpoints: readonly ResolvedWorkflowEndpoint[],
 ) => {
  if (endpoints.length === 0) return Layer.empty;
  const dynamicApi = api as any;
  return (HttpApiBuilder.group as any)(dynamicApi, 'workflows', (initial: any) => {
    let handlers = initial;
    for (const endpoint of endpoints) {
      handlers = handlers.handle(endpoint.endpointName, ({ payload }: { payload: unknown }) =>
        endpoint.stream
          ? Effect.succeed(sseResponse(fred, endpoint, payload))
          : jsonResponse(fred, endpoint, payload));
    }
    return handlers;
  });
};
