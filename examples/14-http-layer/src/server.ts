import { createFred, type AgentConfig } from '@fancyrobot/fred';
import { withHttp, type FredWithHttp } from '@fancyrobot/fred-http';
import '@fancyrobot/fred-openrouter';

const AGENT_ID = 'http-assistant';
const DEFAULT_MODEL = 'openrouter/free';

export interface CreateHttpFredOptions {
  readonly authToken?: string;
  readonly enableModel?: boolean;
  readonly rateLimitMaxRequests?: number;
  readonly rateLimitWindowMs?: number;
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

const registerLiveAgent = async (fred: Awaited<ReturnType<typeof createFred>>): Promise<void> => {
  const model = envValue('FRED_EXAMPLE_MODEL') ?? DEFAULT_MODEL;
  const systemMessage = await Bun.file(
    new URL('./agents/http-assistant.md', import.meta.url),
  ).text();

  await fred.providers.use('openrouter', { modelDefaults: { model } });
  await fred.agents.register({
    id: AGENT_ID,
    platform: 'openrouter',
    model,
    systemMessage,
    utterances: ['http', 'server', 'api'],
  } satisfies AgentConfig);
};

export async function createHttpFred(
  options: CreateHttpFredOptions = {},
): Promise<FredWithHttp> {
  const core = await createFred({
    routing: { defaultAgent: AGENT_ID, rules: [] },
  });

  try {
    if (options.enableModel !== false && envValue('OPENROUTER_API_KEY')) {
      await registerLiveAgent(core);
    }

    return withHttp(core, {
      security: {
        // Authentication is optional in this local example. To require it:
        //   1. Set FRED_HTTP_AUTH_TOKEN to a long random secret.
        //   2. Pass it as authToken (the standalone main function does this).
        //   3. Send `Authorization: Bearer <token>` from every client.
        // Never hard-code or commit a production token.
        requireAuth: options.authToken !== undefined,
        authToken: options.authToken,
        allowLocalRequestsWithoutAuth: false,
        corsAllowedOrigins: [
          'http://localhost:*',
          'http://127.0.0.1:*',
        ],
        maxRequestBodySize: 1_048_576,
        requestTimeoutSeconds: 30,
        rateLimitMaxRequests: options.rateLimitMaxRequests ?? 60,
        rateLimitWindowMs: options.rateLimitWindowMs ?? 60_000,
      },
      // Only trust X-Forwarded-For/X-Real-IP when a trusted reverse proxy is
      // definitely in front of the process.
      trustProxy: false,
    });
  } catch (error) {
    await core.shutdown();
    throw error;
  }
}

async function main(): Promise<void> {
  const authToken = envValue('FRED_HTTP_AUTH_TOKEN');
  const hasProvider = envValue('OPENROUTER_API_KEY') !== undefined;
  const fred = await createHttpFred({ authToken });
  const server = await fred.server.listen({
    hostname: '127.0.0.1',
    port: parsePort(envValue('PORT')),
  });

  console.log(`Fred HTTP server listening at ${server.url}`);
  console.log(`OpenAPI: ${server.url}/docs/openapi.json`);
  console.log(`Docs:    ${server.url}/docs`);
  console.log(authToken ? 'Bearer authentication is enabled.' : 'Bearer authentication is disabled.');
  if (!hasProvider) {
    console.log('OPENROUTER_API_KEY is not set; admin/docs routes work, but chat needs the key.');
  }

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
