/**
 * Intent test command handler
 *
 * Tests intent matching against registered intents.
 * Usage: fred intent test "message"
 */

import { Fred } from '@fancyrobot/fred';
import { Effect } from 'effect';
import { resolveProjectConfig } from '../project/resolve-config.js';
import { createColors } from './color.js';

export interface IntentCommandIO {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
}

export interface IntentCommandDependencies {
  fred?: Fred;
  io?: IntentCommandIO;
}

const DEFAULT_IO: IntentCommandIO = {
  stdout: (message) => console.log(message),
  stderr: (message) => console.error(message),
};

/**
 * Initialize Fred instance with config.
 */
async function initializeFred(io: IntentCommandIO): Promise<Fred> {
  const fred = new Fred();
  const configResult = resolveProjectConfig();

  if (configResult.success && configResult.configPath) {
    try {
      await fred.initializeFromConfig(configResult.configPath);
    } catch (error) {
      io.stderr(`Failed to initialize from config: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return fred;
}

/**
 * Handle intent test subcommand.
 */
async function handleIntentTest(
  args: string[],
  options: Record<string, unknown>,
  deps: IntentCommandDependencies,
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const colors = createColors();

  // Validate message argument
  const message = args[1];
  if (!message) {
    io.stderr('Error: Message required. Usage: fred intent test "message"');
    return 2;
  }

  // Initialize Fred and create intent matcher
  let fred: Fred;
  try {
    fred = deps.fred ?? await initializeFred(io);
  } catch (error) {
    io.stderr(`Error: Failed to initialize Fred: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  const intents = fred.getIntents();
  if (intents.length === 0) {
    io.stderr('Error: No intents registered.');
    return 2;
  }

  // Match intent using Fred's internal matcher
  const startTime = Date.now();
  let matchResult;
  try {
    matchResult = await Effect.runPromise((fred as any).intentMatcher.matchIntent(message));
  } catch (error) {
    io.stderr(`Error: Intent matching failed: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }
  const durationMs = Date.now() - startTime;

  // No match found
  if (!matchResult) {
    if (options.json === true) {
      io.stdout(JSON.stringify({ ok: false, matched: false, message }, null, 2));
    } else {
      io.stdout(colors.red(`No match for: "${message}"`));
    }
    return 1;
  }

  // Match found - extract data
  const { intent, confidence, allCandidates } = matchResult;
  const agentTarget = intent.action.target;

  // Filter alternatives by threshold if specified
  const threshold = typeof options.threshold === 'number' ? options.threshold : 0;
  const filteredAlternatives = allCandidates.filter((alt) => alt.confidence >= threshold);

  // JSON output
  if (options.json === true) {
    const result: any = {
      ok: true,
      matched: true,
      intent: intent.id,
      confidence,
      agent: agentTarget,
    };

    if (options.verbose === true) {
      result.alternatives = filteredAlternatives;
      result.durationMs = durationMs;
      const configResult = resolveProjectConfig();
      if (configResult.configPath) {
        result.configPath = configResult.configPath;
      }
    }

    io.stdout(JSON.stringify(result, null, 2));
    return 0;
  }

  // Default compact output
  const confidenceStr = confidence.toFixed(2);
  const confidenceColor = confidence < 0.6 ? colors.yellow : colors.green;
  const compactLine = `${colors.green(intent.id)} ${colors.gray(`(${confidenceStr})`)} -> ${colors.bold(agentTarget)}`;
  io.stdout(compactLine);

  // Verbose output
  if (options.verbose === true) {
    io.stdout('');

    // Alternatives
    if (filteredAlternatives.length > 0) {
      io.stdout(colors.bold('Alternatives:'));
      for (const alt of filteredAlternatives) {
        const altConfStr = alt.confidence.toFixed(2);
        io.stdout(`  ${alt.intentId} (${altConfStr})`);
      }
      io.stdout('');
    }

    // Timing
    io.stdout(`Duration: ${durationMs}ms`);

    // Config path
    const configResult = resolveProjectConfig();
    if (configResult.configPath) {
      io.stdout(`Config: ${configResult.configPath}`);
    }
  }

  return 0;
}

/**
 * Handle the `fred intent` command.
 *
 * @param args - Positional arguments (subcommand and params)
 * @param options - CLI options
 * @param deps - Optional injected dependencies for testing
 * @returns Exit code (0 = match, 1 = no match, 2 = error)
 */
export async function handleIntentCommand(
  args: string[],
  options: Record<string, unknown>,
  deps: IntentCommandDependencies = {},
): Promise<number> {
  const io = deps.io ?? DEFAULT_IO;
  const subcommand = args[0];

  if (subcommand === 'test') {
    return handleIntentTest(args, options, deps);
  }

  io.stderr(`Error: Unknown subcommand "${subcommand}". Available: test`);
  return 2;
}
