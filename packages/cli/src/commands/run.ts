/**
 * Run command handler
 *
 * Headless agent execution for CI/scripting use cases.
 * Sends a single message to an agent and prints the response to stdout.
 *
 * In JSON mode (--json), ALL output is routed through RunJsonChannel
 * to guarantee exactly one parser-safe JSON document on stdout and
 * zero bytes on stderr.
 */

import { Fred, hasRetryDiagnostics } from '@fancyrobot/fred';
import {
  ensureDefaultChatAgent,
} from '@fancyrobot/fred-dev/chat-defaults';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { RunJsonChannel } from '../runtime/json-channel.js';
import { sanitizeErrorForCli } from './error-sanitize.js';
import {
  AgentNotFoundError,
  ConfigInitError,
  FredInitError,
  InvalidArgumentError,
  MessageProcessError,
} from './errors.js';

export interface RunCommandIO {
  stdout: (msg: string) => void;
  stderr: (msg: string) => void;
}

export interface RunCommandDependencies {
  fred?: Fred;
  io?: RunCommandIO;
  stdin?: () => Promise<string>;
}

const DEFAULT_IO: RunCommandIO = {
  stdout: (msg) => console.log(msg),
  stderr: (msg) => console.error(msg),
};

/**
 * Read all data from process.stdin as a UTF-8 string.
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8').trim();
}

/**
 * Initialize Fred instance with config and provider bootstrap, wrapped in Effect.
 */
const initializeFredEffect = (
  agentId: string,
  channel: RunJsonChannel,
): Effect.Effect<Fred, FredInitError> =>
  Effect.gen(function* () {
    const fred = new Fred();
    const configResult = resolveProjectConfig();

    if (configResult.success && configResult.config && configResult.configPath) {
      yield* Effect.tryPromise({
        try: () => fred.initializeFromConfig(configResult.configPath!),
        catch: (error) =>
          new ConfigInitError({ message: `Failed to initialize from config: ${sanitizeErrorForCli(error)}` }),
      }).pipe(
        Effect.catchTag('ConfigInitError', (error) =>
          Effect.sync(() => {
            channel.warn(error.message);
          }),
        ),
      );
    }

    // Bootstrap provider (auto-detection when config doesn't fully specify)
    yield* Effect.tryPromise({
      try: () => ensureDefaultChatAgent(fred, { agentId }),
      catch: (error) =>
        new FredInitError({ message: `Failed to bootstrap provider: ${sanitizeErrorForCli(error)}` }),
    });

    return fred;
  });

/**
 * Internal Effect program for the run command.
 */
const runCommandEffect = (
  _args: string[],
  options: Record<string, unknown>,
  deps: RunCommandDependencies,
  channel: RunJsonChannel,
): Effect.Effect<
  number,
  InvalidArgumentError | FredInitError | AgentNotFoundError | MessageProcessError
> =>
  Effect.gen(function* () {
    // --- Validate --agent ---
    const agentId = options.agent as string | undefined;
    if (!agentId) {
      return yield* Effect.fail(
        new InvalidArgumentError({ message: '--agent <name> is required.' }),
      );
    }

    // --- Resolve input ---
    let input: string | undefined = options.input as string | undefined;

    if (!input) {
      // Try stdin: use injected stdin (for testing) or real stdin if not a TTY
      const isTTY = process.stdin.isTTY ?? false;
      if (deps.stdin || !isTTY) {
        const stdinResult = yield* Effect.tryPromise({
          try: () => (deps.stdin ?? readStdin)(),
          catch: () => new InvalidArgumentError({ message: 'Failed to read stdin.' }),
        }).pipe(
          Effect.catchTag('InvalidArgumentError', () => Effect.succeed(undefined)),
        );
        if (stdinResult) input = stdinResult;
      }
    }

    if (!input || input.length === 0) {
      return yield* Effect.fail(
        new InvalidArgumentError({ message: "No input provided. Use --input 'message' or pipe via stdin." }),
      );
    }

    // --- Initialize Fred ---
    const fred = deps.fred
      ? deps.fred
      : yield* initializeFredEffect(agentId, channel);

    // --- Verify agent exists ---
    const agent = fred.getAgent(agentId);
    if (!agent) {
      const agents = fred.getAgents().map((a) => a.id);
      const available = agents.length > 0 ? ` Available agents: ${agents.join(', ')}` : '';
      return yield* Effect.fail(
        new AgentNotFoundError({
          agentId,
          message: `Agent "${agentId}" not found.${available}`,
        }),
      );
    }

    // --- Process message ---
    const conversationId = (options['conversation-id'] ?? options.conversationId) as string | undefined;

    const response = yield* Effect.tryPromise({
      try: () => fred.processMessage(input!, { conversationId }),
      catch: (error) =>
        new MessageProcessError({
          message: sanitizeErrorForCli(error),
          retryDiagnostics: hasRetryDiagnostics(error) ? error._retryDiagnostics : undefined,
        }),
    });

    if (!response) {
      return yield* Effect.fail(
        new MessageProcessError({ message: 'No response from agent.' }),
      );
    }

    // Verbose: route tool-call diagnostics through the channel
    if (options.verbose === true && response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        channel.diagnostic(
          `[tool: ${tc.toolId}] ${JSON.stringify(tc.args)} → ${tc.result !== undefined ? JSON.stringify(tc.result) : '(no result)'}`,
        );
      }
    }

    // Build verbose tool-call data for JSON payload
    let verboseData: Record<string, unknown> | undefined;
    if (options.verbose === true && response.toolCalls && response.toolCalls.length > 0) {
      verboseData = {
        toolCalls: response.toolCalls.map((tc) => ({
          toolId: tc.toolId,
          args: tc.args,
          result: tc.result,
        })),
      };
    }

    return channel.emitSuccess({
      agent: agentId,
      content: response.content,
      toolCalls: response.toolCalls,
      verbose: verboseData,
    });
  });

/**
 * Handle the `fred run` command.
 *
 * Sends a single message to an agent and prints the response.
 * Uses non-streaming processMessage API for predictable headless output.
 *
 * All output is routed through RunJsonChannel. In JSON mode this guarantees
 * exactly one JSON document on stdout and zero bytes on stderr.
 * In text mode the channel delegates to io directly (unchanged behavior).
 *
 * @returns exit code: 0 on success, 1 on error
 */
export async function handleRunCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: RunCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const jsonMode = options.json === true;
  const channel = new RunJsonChannel(io, jsonMode);

  return Effect.runPromise(
    runCommandEffect(args, options, deps, channel).pipe(
      Effect.catchTags({
        InvalidArgumentError: (error) =>
          Effect.succeed(channel.emitError(error.message, 1)),
        FredInitError: (error) =>
          Effect.succeed(channel.emitError(`Failed to initialize Fred: ${error.message}`, 1)),
        AgentNotFoundError: (error) =>
          Effect.succeed(channel.emitError(error.message, 1)),
        MessageProcessError: (error) => {
          // Extract retry diagnostics for structured error details
          const retryDiagnostics = error.retryDiagnostics as any;
          const details = retryDiagnostics
            ? {
                retryDiagnostics,
                category: retryDiagnostics.retryable ? 'transient' : 'configuration',
                suggestion: retryDiagnostics.retryable
                  ? `Transient ${retryDiagnostics.failureCategory} failure after ${retryDiagnostics.attempts} attempt(s). Retry the request.`
                  : `Non-retryable error (HTTP ${retryDiagnostics.lastStatusCode}). Check API key and provider configuration.`,
              }
            : undefined;

          return Effect.succeed(channel.emitError(error.message, 1, details));
        },
      }),
    ),
  );
}
