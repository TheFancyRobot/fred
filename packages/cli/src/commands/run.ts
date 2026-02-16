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

import { Fred } from '@fancyrobot/fred';
import {
  ensureDefaultChatAgent,
} from '@fancyrobot/fred-dev/chat-defaults';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { RunJsonChannel } from '../runtime/json-channel.js';

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
 * Initialize Fred instance with config and provider bootstrap.
 */
async function initializeFred(agentId: string, channel: RunJsonChannel): Promise<Fred> {
  const fred = new Fred();
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.config && configResult.configPath) {
    try {
      await fred.initializeFromConfig(configResult.configPath);
    } catch (error) {
      channel.warn(`Failed to initialize from config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Bootstrap provider (auto-detection when config doesn't fully specify)
  await ensureDefaultChatAgent(fred, { agentId });

  return fred;
}

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

  // --- Validate --agent ---
  const agentId = options.agent as string | undefined;
  if (!agentId) {
    return channel.emitError('--agent <name> is required.', 1);
  }

  // --- Resolve input ---
  let input: string | undefined = options.input as string | undefined;

  if (!input) {
    // Try stdin: use injected stdin (for testing) or real stdin if not a TTY
    const isTTY = process.stdin.isTTY ?? false;
    if (deps.stdin || !isTTY) {
      try {
        const stdinFn = deps.stdin ?? readStdin;
        input = await stdinFn();
      } catch {
        // stdin read failed — fall through to error
      }
    }
  }

  if (!input || input.length === 0) {
    return channel.emitError("No input provided. Use --input 'message' or pipe via stdin.", 1);
  }

  // --- Initialize Fred ---
  let fred: Fred;
  try {
    fred = deps.fred ?? await initializeFred(agentId, channel);
  } catch (error) {
    return channel.emitError(
      `Failed to initialize Fred: ${error instanceof Error ? error.message : String(error)}`,
      1,
    );
  }

  // --- Verify agent exists ---
  const agent = fred.getAgent(agentId);
  if (!agent) {
    const agents = fred.getAgents().map((a) => a.id);
    const available = agents.length > 0 ? ` Available agents: ${agents.join(', ')}` : '';
    return channel.emitError(`Agent "${agentId}" not found.${available}`, 1);
  }

  // --- Process message ---
  const conversationId = (options['conversation-id'] ?? options.conversationId) as string | undefined;

  try {
    const response = await fred.processMessage(input, { conversationId });

    if (!response) {
      return channel.emitError('No response from agent.', 1);
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
  } catch (error) {
    return channel.emitError(
      error instanceof Error ? error.message : String(error),
      1,
    );
  }
}
