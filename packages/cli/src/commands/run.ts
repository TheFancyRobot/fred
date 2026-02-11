/**
 * Run command handler
 *
 * Headless agent execution for CI/scripting use cases.
 * Sends a single message to an agent and prints the response to stdout.
 */

import { Fred } from '@fancyrobot/fred';
import {
  ensureDefaultChatAgent,
} from '@fancyrobot/fred-dev/chat-defaults';
import { resolveProjectConfig } from '../project/resolve-config.js';

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
async function initializeFred(agentId: string, io: RunCommandIO): Promise<Fred> {
  const fred = new Fred();
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.config && configResult.configPath) {
    try {
      await fred.initializeFromConfig(configResult.configPath);
    } catch (error) {
      io.stderr(`Warning: Failed to initialize from config: ${error instanceof Error ? error.message : String(error)}`);
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
 * @returns exit code: 0 on success, 1 on error
 */
export async function handleRunCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: RunCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;

  // --- Validate --agent ---
  const agentId = options.agent as string | undefined;
  if (!agentId) {
    io.stderr('Error: --agent <name> is required.');
    return 1;
  }

  // --- Resolve input ---
  let input: string | undefined = options.input as string | undefined;

  if (!input) {
    // Try stdin if not a TTY
    const isTTY = process.stdin.isTTY ?? false;
    if (!isTTY) {
      try {
        const stdinFn = deps.stdin ?? readStdin;
        input = await stdinFn();
      } catch {
        // stdin read failed — fall through to error
      }
    }
  }

  if (!input || input.length === 0) {
    io.stderr("Error: No input provided. Use --input 'message' or pipe via stdin.");
    return 1;
  }

  // --- Initialize Fred ---
  let fred: Fred;
  try {
    fred = deps.fred ?? await initializeFred(agentId, io);
  } catch (error) {
    io.stderr(`Error: Failed to initialize Fred: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  // --- Verify agent exists ---
  const agent = fred.getAgent(agentId);
  if (!agent) {
    const agents = fred.getAgents().map((a) => a.id);
    const available = agents.length > 0 ? ` Available agents: ${agents.join(', ')}` : '';
    io.stderr(`Error: Agent "${agentId}" not found.${available}`);
    return 1;
  }

  // --- Process message ---
  const conversationId = (options['conversation-id'] ?? options.conversationId) as string | undefined;

  try {
    const response = await fred.processMessage(input, { conversationId });

    if (!response) {
      io.stderr('No response from agent.');
      return 1;
    }

    // Verbose: show tool calls on stderr (so stdout stays clean for piping)
    if (options.verbose === true && response.toolCalls && response.toolCalls.length > 0) {
      for (const tc of response.toolCalls) {
        io.stderr(`[tool: ${tc.toolId}] ${JSON.stringify(tc.args)} → ${tc.result !== undefined ? JSON.stringify(tc.result) : '(no result)'}`);
      }
    }

    // Output response
    if (options.json === true) {
      io.stdout(JSON.stringify({
        ok: true,
        agent: agentId,
        content: response.content,
        toolCalls: response.toolCalls ?? [],
      }, null, 2));
    } else {
      io.stdout(response.content);
    }

    return 0;
  } catch (error) {
    io.stderr(`Error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
