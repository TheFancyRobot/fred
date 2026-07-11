import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createFred, defineWorkflow } from '@fancyrobot/fred';
import {
  makeSqliteApiKeyStore,
  withHttp,
  type ApiKeyStoreService,
  type FredWithHttp,
} from '@fancyrobot/fred-http';
import { Schema } from 'effect';

const GreetingInput = Schema.Struct({ name: Schema.String });
const GreetingOutput = Schema.Struct({ message: Schema.String });
const NormalizeInput = Schema.Struct({ text: Schema.String });
const NormalizeOutput = Schema.Struct({ normalized: Schema.String });
const SumInput = Schema.Struct({ values: Schema.Array(Schema.Number) });
const SumOutput = Schema.Struct({ total: Schema.Number });
const ProgressInput = Schema.Struct({ job: Schema.String });
const ProgressOutput = Schema.Struct({ accepted: Schema.Boolean, job: Schema.String });

const decodeGreeting = Schema.decodeUnknownSync(GreetingInput);
const decodeNormalize = Schema.decodeUnknownSync(NormalizeInput);
const decodeSum = Schema.decodeUnknownSync(SumInput);
const decodeProgress = Schema.decodeUnknownSync(ProgressInput);

export interface CreateWorkflowFredOptions {
  readonly apiKeyStore: ApiKeyStoreService;
  readonly rateLimitMaxRequests?: number;
  readonly rateLimitWindowMs?: number;
}

async function registerWorkflows(fred: Awaited<ReturnType<typeof createFred>>): Promise<void> {
  await fred.workflows.define(defineWorkflow({
    id: 'greet',
    entry: 'greet',
    nodes: [{
      id: 'greet',
      kind: 'function',
      fn: (context) => {
        const input = decodeGreeting(context.input);
        return { message: `Hello, ${input.name}!` };
      },
    }],
    edges: [],
    input: GreetingInput,
    output: GreetingOutput,
  }));

  await fred.workflows.define(defineWorkflow({
    id: 'normalize',
    entry: 'normalize',
    nodes: [{
      id: 'normalize',
      kind: 'function',
      fn: (context) => {
        const input = decodeNormalize(context.input);
        return { normalized: input.text.trim().replace(/\s+/g, ' ').toLowerCase() };
      },
    }],
    edges: [],
    input: NormalizeInput,
    output: NormalizeOutput,
  }));

  await fred.workflows.define(defineWorkflow({
    id: 'sum',
    entry: 'sum',
    nodes: [{
      id: 'sum',
      kind: 'function',
      fn: (context) => {
        const input = decodeSum(context.input);
        return { total: input.values.reduce((total, value) => total + value, 0) };
      },
    }],
    edges: [],
    input: SumInput,
    output: SumOutput,
  }));

  await fred.workflows.define(defineWorkflow({
    id: 'progress',
    entry: 'accept',
    nodes: [{
      id: 'accept',
      kind: 'function',
      fn: (context) => {
        const input = decodeProgress(context.input);
        return { accepted: true, job: input.job };
      },
    }],
    edges: [],
    input: ProgressInput,
    output: ProgressOutput,
  }));
}

export async function createWorkflowFred(
  options: CreateWorkflowFredOptions,
): Promise<FredWithHttp> {
  const core = await createFred();
  try {
    await registerWorkflows(core);
    return withHttp(core, {
      apiKeyStore: options.apiKeyStore,
      security: {
        corsAllowedOrigins: ['http://localhost:*', 'http://127.0.0.1:*'],
        maxRequestBodySize: 64 * 1024,
        requestTimeoutSeconds: 10,
        rateLimitMaxRequests: options.rateLimitMaxRequests ?? 60,
        rateLimitWindowMs: options.rateLimitWindowMs ?? 60_000,
      },
      workflowEndpoints: {
        // Omitted `path` uses POST /workflows/greet. Omitted `auth` inherits
        // authenticated server access and accepts any valid, unrevoked key.
        greet: {},
        // Public exposure must be an explicit opt-out. Keep public workflows
        // side-effect free and treat all input as untrusted.
        normalize: { path: '/public/normalize', auth: false },
        // Every listed scope is required.
        sum: { path: '/workflows/secure-sum', auth: { scopes: ['workflows:run'] } },
        // Streaming returns ordered lifecycle events over SSE.
        progress: { stream: true, auth: { scopes: ['workflows:stream'] } },
      },
    });
  } catch (error) {
    await core.shutdown();
    throw error;
  }
}

const envValue = (name: string): string | undefined => {
  const value = Bun.env[name]?.trim();
  return value ? value : undefined;
};

const parsePort = (value: string | undefined): number => {
  if (value === undefined) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error(`PORT must be an integer between 0 and 65535; received ${value}`);
  }
  return port;
};

async function main(): Promise<void> {
  const sqlitePath = envValue('FRED_HTTP_SQLITE_PATH') ?? '.fred/http.sqlite';
  mkdirSync(dirname(sqlitePath), { recursive: true });
  const fred = await createWorkflowFred({ apiKeyStore: makeSqliteApiKeyStore(sqlitePath) });
  const server = await fred.server.listen({
    hostname: '127.0.0.1',
    port: parsePort(envValue('PORT')),
  });

  console.log(`Fred workflow server listening at ${server.url}`);
  console.log(`OpenAPI: ${server.url}/docs/openapi.json`);
  console.log('API-key authentication is enabled; no raw key is logged by the server.');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${signal} received; shutting down.`);
    await fred.shutdown();
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
